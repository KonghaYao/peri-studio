export interface DiffRow {
  leftNumber?: number;
  rightNumber?: number;
  leftText?: string;
  rightText?: string;
  kind: 'context' | 'change';
}

export interface DiffHunk {
  header: string;
  rows: DiffRow[];
}

export interface ParsedDiff {
  oldLabel?: string;
  newLabel?: string;
  binary: boolean;
  hunks: DiffHunk[];
  truncated: boolean;
}

export const MAX_RENDERED_DIFF_ROWS = 5_000;

export function parseUnifiedDiff(source: string, maxRows = MAX_RENDERED_DIFF_ROWS): ParsedDiff {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const result: ParsedDiff = {
    binary: lines.some((line) => line.startsWith('Binary files ') || line === 'GIT binary patch'),
    hunks: [],
    truncated: false,
  };
  for (const line of lines) {
    if (line.startsWith('@@ ')) break;
    if (line.startsWith('--- ')) result.oldLabel = line.slice(4);
    else if (line.startsWith('+++ ')) result.newLabel = line.slice(4);
  }
  let index = 0;
  while (index < lines.length) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[index]);
    if (!match) { index += 1; continue; }
    const hunk: DiffHunk = { header: lines[index], rows: [] };
    let left = Number(match[1]);
    let right = Number(match[2]);
    index += 1;
    while (index < lines.length && !lines[index].startsWith('@@ ') && !lines[index].startsWith('diff --git ')) {
      if (lines[index].startsWith(' ')) {
        hunk.rows.push({
          leftNumber: left++, rightNumber: right++,
          leftText: lines[index].slice(1), rightText: lines[index].slice(1), kind: 'context',
        });
        index += 1;
        continue;
      }
      if (lines[index].startsWith('-')) {
        const removed: string[] = [];
        const added: string[] = [];
        while (index < lines.length && lines[index].startsWith('-')) {
          removed.push(lines[index].slice(1)); index += 1;
        }
        while (index < lines.length && lines[index].startsWith('+')) {
          added.push(lines[index].slice(1)); index += 1;
        }
        appendChangeRows(hunk.rows, removed, added, () => left++, () => right++);
        continue;
      }
      if (lines[index].startsWith('+')) {
        const added: string[] = [];
        while (index < lines.length && lines[index].startsWith('+')) {
          added.push(lines[index].slice(1)); index += 1;
        }
        appendChangeRows(hunk.rows, [], added, () => left++, () => right++);
        continue;
      }
      index += 1;
    }
    result.hunks.push(hunk);
  }
  const rowCount = result.hunks.reduce((sum, hunk) => sum + hunk.rows.length, 0);
  if (rowCount > maxRows) {
    let remaining = maxRows;
    result.hunks = result.hunks.flatMap((hunk) => {
      if (remaining <= 0) return [];
      const rows = hunk.rows.slice(0, remaining);
      remaining -= rows.length;
      return [{ ...hunk, rows }];
    });
    result.truncated = true;
  }
  return result;
}

function appendChangeRows(
  rows: DiffRow[],
  removed: string[],
  added: string[],
  nextLeft: () => number,
  nextRight: () => number,
) {
  const length = Math.max(removed.length, added.length);
  for (let index = 0; index < length; index += 1) {
    const row: DiffRow = { kind: 'change' };
    if (index < removed.length) {
      row.leftNumber = nextLeft();
      row.leftText = removed[index];
    }
    if (index < added.length) {
      row.rightNumber = nextRight();
      row.rightText = added[index];
    }
    rows.push(row);
  }
}
