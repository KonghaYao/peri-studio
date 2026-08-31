import type { ResourceEntry } from '@/entities/resource/resource-view';

type GitGraphRef = { label: string; tone?: 'branch' | 'remote' | 'tag' };

type GitGraphCommit = {
  id: string;
  hash: string;
  shortHash?: string;
  message: string;
  author: string;
  date: string;
  time: string;
  parents: string[];
  refs?: GitGraphRef[];
  isHead?: boolean;
};

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
  };
}

function parseParents(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function parseRefs(value: unknown): GitGraphCommit['refs'] {
  if (!Array.isArray(value)) return undefined;
  const refs = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const ref = item as GitRefWire;
      if (typeof ref.name !== 'string') return null;
      const tone: 'branch' | 'remote' | 'tag' | undefined =
        ref.kind === 'branch' || ref.kind === 'remote' || ref.kind === 'tag' ? ref.kind : undefined;
      return { label: ref.name, tone };
    })
    .filter((ref): ref is NonNullable<typeof ref> => !!ref);
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
