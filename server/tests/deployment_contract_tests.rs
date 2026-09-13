use std::fs;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf()
}

fn read(path: &str) -> String {
    fs::read_to_string(root().join(path)).unwrap_or_else(|error| panic!("read {path}: {error}"))
}

#[test]
fn background_units_fail_closed_without_embedding_credentials() {
    for path in [
        "deploy/systemd/peri-studio-serve.service",
        "deploy/systemd/peri-studio-connect.service",
    ] {
        let unit = read(path);
        assert!(
            unit.contains("UMask=0077"),
            "{path} must create private files"
        );
        assert!(unit.contains("NoNewPrivileges=true"));
        assert!(unit.contains("Restart=on-failure"));
        assert!(
            !unit.contains("--token "),
            "{path} must not embed bearer material"
        );
    }
}

#[test]
fn scripts_directory_only_contains_release_and_runtime_tools() {
    let dir = root().join("scripts");
    let mut names = fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("read {}: {error}", dir.display()))
        .filter_map(|entry| {
            let name = entry
                .unwrap_or_else(|error| panic!("scripts dir entry: {error}"))
                .file_name()
                .into_string()
                .expect("scripts file name");
            if name == "node_modules" || name.starts_with('.') {
                return None;
            }
            Some(name)
        })
        .collect::<Vec<_>>();
    names.sort();
    assert_eq!(
        names,
        [
            "install.sh",
            "package-release-binary.sh",
            "verify-release-binary.sh",
            "verify-unified-runtime.sh",
        ]
    );
}

#[test]
fn dev_sh_keeps_local_assembly_contract() {
    let dev = read("dev.sh");
    for evidence in [
        "LISTEN_PORT=\"${PERI_STUDIO_LISTEN_PORT:-8456}\"",
        "stale_local_listener_pids()",
        "cleanup_stale_local_instance()",
        "kill -TERM \"${pid}\"",
        "lsof -nP -iTCP:\"${LISTEN_PORT}\" -sTCP:LISTEN",
        "仍被其他进程占用",
        "cargo build -q -p peri-studio --no-default-features",
        "./target/debug/peri-studio local",
        "--listen \"${LISTEN_ADDR}\"",
        "--listen-port \"${LISTEN_PORT}\"",
        "--config-dir \"${CONFIG_DIR}\"",
        "--data-dir \"${DATA_DIR}\"",
        "umask 077",
        "peri-studio.${$}.log",
        "CLEANED_UP=1",
        "(cd \"${ROOT}/web\" && bun run build)",
    ] {
        assert!(
            dev.contains(evidence),
            "dev.sh is missing required assembly: {evidence}"
        );
    }
    for forbidden in [
        "pkill -f",
        "peri-studio-server",
        "peri-instance",
        "vite build --watch",
        "if [ ! -f \"${WEB_DIST}/index.html\" ]",
    ] {
        assert!(
            !dev.contains(forbidden),
            "dev.sh must not contain {forbidden}"
        );
    }

    let port_guard = dev
        .find("lsof -nP -iTCP:\"${LISTEN_PORT}\" -sTCP:LISTEN")
        .expect("port guard");
    let web_build = dev
        .find("(cd \"${ROOT}/web\" && bun run build)")
        .expect("web build");
    assert!(
        port_guard < web_build,
        "occupied-port guard must run before the Web build"
    );
}

#[test]
fn ci_is_a_real_required_evidence_chain() {
    let ci = read(".github/workflows/ci.yml");
    for evidence in [
        "bun install --frozen-lockfile",
        "bun run test",
        "bun run build",
        "cargo test --workspace --locked",
        "cargo clippy --workspace --all-targets --locked -- -D warnings",
        "cargo-deny --version 0.20.2",
        "cargo deny check",
        "bun audit",
    ] {
        assert!(
            ci.contains(evidence),
            "CI is missing required evidence: {evidence}"
        );
    }
    assert!(
        ci.contains("needs: web"),
        "Rust must consume a freshly built Web artifact"
    );
}

#[test]
fn release_requires_fresh_sources_and_attests_single_binaries() {
    let package = read("scripts/package-release-binary.sh");
    assert!(package.contains("source_revision="));
    assert!(package.contains("sha256"));

    let release = read(".github/workflows/release.yml");
    assert!(release.contains("scripts/package-release-binary.sh"));
    assert!(release.contains("scripts/verify-release-binary.sh --require-clean"));
    assert!(release.contains("actions/download-artifact@v4"));
    assert!(release.contains("attest-build-provenance"));
    assert!(release.contains("sbom-action"));
    assert!(release.contains("tags: ['peri-studio-v*']"));
    assert!(release.contains("peri-studio-v${version}"));
    assert!(release.contains("macos-14"));
    assert!(!release.contains("windows-latest"));
    assert!(!release.contains("install.ps1"));
    assert!(release.contains("cmp \"$first\" \"$second\""));
}

#[test]
fn deployment_runbook_keeps_readiness_and_non_destructive_rollback_explicit() {
    let runbook = read("deploy/README.md");
    assert!(runbook.contains("peri-studio status --ready"));
    assert!(runbook.contains("SQLite"));
    assert!(runbook.contains("回滚"));
    assert!(runbook.contains("instance/ACP"));
}
