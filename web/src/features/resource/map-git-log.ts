import type { ResourceEntry } from '@/entities/resource/resource-view';
import type { GitGraphCommit } from '@/entities/resource/git-graph';

type GitRefWire = { name?: string; kind?: string };

export function mapGitLogToGraphCommits(
  entries: ResourceEntry[],
  headOid?: string,
): GitGraphCommit[] {
  return entries.map((entry) => mapGitLogEntry(entry, headOid));
}

function mapGitLogEntry(entry: ResourceEntry, headOid?: string): GitGraphCommit {
  const oid = String(entry.oid ?? entry.id);
  const authorDate = typeof entry.author_date === 'string' ? entry.author_date : '';
  return {
    id: oid,
    hash: oid,
    shortHash: typeof entry.short_oid === 'string' ? entry.short_oid : undefined,
    message: String(entry.message ?? ''),
    author: String(entry.author_name ?? ''),
    date: authorDate,
    time: formatRelativeTime(authorDate),
    parents: parseParents(entry.parents),
    refs: parseRefs(entry.refs),
    isHead: !!headOid && oid === headOid,
    parentsComplete: boolOrUndefined(entry.parents_complete),
    refsComplete: boolOrUndefined(entry.refs_complete),
  };
}

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function gitLogHasIncompleteDag(commits: GitGraphCommit[]): boolean {
  return commits.some((commit) => commit.parentsComplete === false || commit.refsComplete === false);
}

function parseParents(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function parseRefs(value: unknown): GitGraphCommit['refs'] {
  if (!Array.isArray(value)) return undefined;
  const refs: NonNullable<GitGraphCommit['refs']> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const ref = item as GitRefWire;
    if (typeof ref.name !== 'string') continue;
    const tone = ref.kind === 'branch' || ref.kind === 'remote' || ref.kind === 'tag' ? ref.kind : undefined;
    refs.push({ label: ref.name, tone });
  }
  return refs.length > 0 ? refs : undefined;
}

function formatRelativeTime(isoDate: string): string {
  const then = Date.parse(isoDate);
  if (!Number.isFinite(then)) return isoDate || '';
  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
