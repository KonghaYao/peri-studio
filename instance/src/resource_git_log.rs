use peri_studio_proto::resource::{
    GitLogCommit, GitLogPage, GitLogScope, GitRefKind, GitRefLabel, InstanceResourcePayload,
    DEFAULT_GIT_LOG_PAGE_SIZE, MAX_COMMIT_MESSAGE_BYTES, MAX_DIRECTORY_PAGE_SIZE,
    MAX_GIT_LOG_PAGE_BYTES, ResourceErrorCode, ResourceFailure,
};

use super::STATUS_ARGS;
use crate::resource::common::{
    cursor_for, failure, hash_bytes, parse_cursor, relative_path,
};
use crate::resource::ResourceHost;

const LOG_PRETTY_FORMAT: &str = "%H%x00%P%x00%s%x00%an%x00%aI";
const MAX_PARENTS_PER_COMMIT: usize = 8;
const MAX_REFS_PER_COMMIT: usize = 16;
const MAX_REF_NAME_BYTES: usize = 256;
const SHORT_OID_LEN: usize = 8;

impl ResourceHost {
    pub(in crate::resource) async fn git_log(
        &self,
        root: &str,
        expected_repo_id: &str,
        expected_generation: &str,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<InstanceResourcePayload, ResourceFailure> {
        let _permit = self.git_log_permits.try_acquire().map_err(|_| {
            failure(ResourceErrorCode::RateLimited, true)
        })?;

        let limit = if limit == 0 {
            DEFAULT_GIT_LOG_PAGE_SIZE
        } else {
            limit
        };
        if limit > MAX_DIRECTORY_PAGE_SIZE {
            return Err(failure(ResourceErrorCode::ViewTooLarge, false));
        }

        let (workspace_root, repo) = self.resolve_repo(root, expected_repo_id).await?;
        let (scope, path_arg) = if workspace_root == repo {
            (Some(GitLogScope::Full), None)
        } else {
            let relative = relative_path(&repo, &workspace_root)?;
            (Some(GitLogScope::WorkspaceSubtreeReadonly), Some(relative))
        };

        let status = self.git(&repo, STATUS_ARGS).await?;
        let generation = hash_bytes(&status);
        if expected_generation != generation {
            return Err(failure(ResourceErrorCode::StaleCursor, false));
        }
        let offset = parse_cursor(cursor, &generation)?;

        let skip = offset.to_string();
        let max_count = limit.to_string();
        let pretty = format!("--pretty=format:{LOG_PRETTY_FORMAT}");
        let mut log_args = vec![
            "log".to_string(),
            "--skip".to_string(),
            skip,
            "--max-count".to_string(),
            max_count,
            pretty,
        ];
        if let Some(path) = path_arg {
            log_args.push("--".to_string());
            log_args.push(path);
        }
        let log_argv = log_args.iter().map(String::as_str).collect::<Vec<_>>();
        let log_output = self.git(&repo, &log_argv).await?;

        let head_bytes = self.git(&repo, &["rev-parse", "HEAD"]).await?;
        let head_oid = parse_oid(&String::from_utf8(head_bytes).map_err(|_| {
            failure(ResourceErrorCode::Unavailable, false)
        })?)?;

        let mut commits = Vec::new();
        for line in log_output.split(|byte| *byte == b'\n').filter(|line| !line.is_empty()) {
            let mut commit = parse_log_line(line)?;
            let refs = self.collect_refs(&repo, &commit.oid).await?;
            commit.refs = refs.labels;
            commit.refs_complete = refs.complete;
            commits.push(commit);
        }

        let next_offset = offset + commits.len();
        let next_cursor = (commits.len() == limit as usize)
            .then(|| cursor_for(&generation, next_offset));

        let page = GitLogPage {
            repo_id: expected_repo_id.to_string(),
            source_generation: generation,
            commits,
            next_cursor,
            head_oid,
            scope,
        };
        let encoded = serde_json::to_vec(&page).map_err(|_| {
            failure(ResourceErrorCode::Unavailable, false)
        })?;
        if encoded.len() > MAX_GIT_LOG_PAGE_BYTES {
            return Err(view_too_large(limit, encoded.len()));
        }

        Ok(InstanceResourcePayload::GitLogPage(page))
    }

    async fn collect_refs(
        &self,
        repo: &std::path::Path,
        oid: &str,
    ) -> Result<CollectedRefs, ResourceFailure> {
        let output = self
            .git(
                repo,
                &[
                    "for-each-ref",
                    &format!("--points-at={oid}"),
                    "--format=%(refname)",
                ],
            )
            .await?;
        let mut labels = Vec::new();
        let mut complete = true;
        for line in output.split(|byte| *byte == b'\n').filter(|line| !line.is_empty()) {
            if labels.len() >= MAX_REFS_PER_COMMIT {
                complete = false;
                break;
            }
            let name = std::str::from_utf8(line)
                .map_err(|_| failure(ResourceErrorCode::Unavailable, false))?
                .trim()
                .to_string();
            if !is_valid_ref_name(&name) {
                continue;
            }
            if let Some((kind, display)) = classify_ref(&name) {
                labels.push(GitRefLabel { name: display, kind });
            }
        }
        if output
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .count()
            > MAX_REFS_PER_COMMIT
        {
            complete = false;
        }
        Ok(CollectedRefs { labels, complete })
    }
}

struct CollectedRefs {
    labels: Vec<GitRefLabel>,
    complete: bool,
}

fn view_too_large(limit: u32, actual_bytes: usize) -> ResourceFailure {
    let suggested = suggest_lower_limit(limit, actual_bytes);
    ResourceFailure {
        code: ResourceErrorCode::ViewTooLarge,
        message: format!("Requested resource page is too large; try limit {suggested}"),
        retryable: false,
    }
}

fn suggest_lower_limit(limit: u32, actual_bytes: usize) -> u32 {
    if actual_bytes == 0 {
        return limit.saturating_sub(1).max(1);
    }
    let scaled = (limit as u64 * MAX_GIT_LOG_PAGE_BYTES as u64) / actual_bytes as u64;
    scaled.max(1).min(limit.saturating_sub(1).max(1) as u64) as u32
}

fn parse_log_line(line: &[u8]) -> Result<GitLogCommit, ResourceFailure> {
    let text = std::str::from_utf8(line).map_err(|_| failure(ResourceErrorCode::Unavailable, false))?;
    let mut fields = text.split('\0');
    let oid = parse_oid(fields.next().ok_or_else(|| failure(ResourceErrorCode::Unavailable, false))?)?;
    let parents_raw = fields.next().unwrap_or("");
    let message_raw = fields.next().unwrap_or("");
    let author_name = fields
        .next()
        .ok_or_else(|| failure(ResourceErrorCode::Unavailable, false))?
        .to_string();
    let author_date = fields
        .next()
        .ok_or_else(|| failure(ResourceErrorCode::Unavailable, false))?
        .to_string();

    let (message, message_truncated) = truncate_message(message_raw);
    let (parents, parents_complete) = parse_parents(parents_raw)?;

    Ok(GitLogCommit {
        commit_id: oid.clone(),
        oid: oid.clone(),
        short_oid: short_oid(&oid),
        message,
        message_truncated,
        author_name,
        author_date,
        parents,
        parents_complete,
        refs: Vec::new(),
        refs_complete: true,
    })
}

fn parse_oid(value: &str) -> Result<String, ResourceFailure> {
    let oid = value.trim();
    if oid.len() == 40 && oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(oid.to_ascii_lowercase())
    } else {
        Err(failure(ResourceErrorCode::Unavailable, false))
    }
}

fn short_oid(oid: &str) -> String {
    oid.chars().take(SHORT_OID_LEN).collect()
}

fn truncate_message(message: &str) -> (String, Option<bool>) {
    if message.len() <= MAX_COMMIT_MESSAGE_BYTES {
        return (message.to_string(), None);
    }
    let mut end = MAX_COMMIT_MESSAGE_BYTES;
    while end > 0 && !message.is_char_boundary(end) {
        end -= 1;
    }
    (message[..end].to_string(), Some(true))
}

fn parse_parents(parents_raw: &str) -> Result<(Vec<String>, bool), ResourceFailure> {
    if parents_raw.trim().is_empty() {
        return Ok((Vec::new(), true));
    }
    let mut parents = Vec::new();
    let mut complete = true;
    for parent in parents_raw.split_whitespace() {
        if parents.len() >= MAX_PARENTS_PER_COMMIT {
            complete = false;
            break;
        }
        parents.push(parse_oid(parent)?);
    }
    if parents_raw.split_whitespace().count() > MAX_PARENTS_PER_COMMIT {
        complete = false;
    }
    Ok((parents, complete))
}

fn is_valid_ref_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_REF_NAME_BYTES
        && !name.contains('\0')
        && !name.contains("..")
        && !name.starts_with('/')
}

fn classify_ref(name: &str) -> Option<(GitRefKind, String)> {
    if let Some(short) = name.strip_prefix("refs/tags/") {
        return Some((GitRefKind::Tag, short.to_string()));
    }
    if let Some(short) = name.strip_prefix("refs/remotes/") {
        return Some((GitRefKind::Remote, short.to_string()));
    }
    if let Some(short) = name.strip_prefix("refs/heads/") {
        return Some((GitRefKind::Branch, short.to_string()));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_message_marks_overflow() {
        let message = "a".repeat(MAX_COMMIT_MESSAGE_BYTES + 1);
        let (truncated, flag) = truncate_message(&message);
        assert_eq!(truncated.len(), MAX_COMMIT_MESSAGE_BYTES);
        assert_eq!(flag, Some(true));
    }

    #[test]
    fn parse_parents_caps_at_eight() {
        let parents = (0..10)
            .map(|index| format!("{:040x}", index))
            .collect::<Vec<_>>()
            .join(" ");
        let (parsed, complete) = parse_parents(&parents).unwrap();
        assert_eq!(parsed.len(), MAX_PARENTS_PER_COMMIT);
        assert!(!complete);
    }

    #[test]
    fn parse_oid_rejects_invalid_values() {
        assert!(parse_oid("not-a-commit").is_err());
        assert!(parse_oid("abc").is_err());
    }

    #[test]
    fn suggest_lower_limit_scales_with_page_size() {
        assert_eq!(
            suggest_lower_limit(500, MAX_GIT_LOG_PAGE_BYTES * 2),
            250
        );
        assert_eq!(suggest_lower_limit(10, MAX_GIT_LOG_PAGE_BYTES * 2), 5);
    }
}
