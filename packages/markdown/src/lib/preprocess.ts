const FENCE = /^\s{0,3}(`{3,}|~{3,})([^`]*)$/;

interface FenceState {
  marker: string;
  size: number;
}

function nextFenceState(line: string, current: FenceState | undefined) {
  const match = line.match(FENCE);
  if (!match) return { state: current };
  const marker = match[1][0];
  if (!current) return { state: { marker, size: match[1].length } };
  if (marker === current.marker && match[1].length >= current.size) return { state: undefined };
  return { state: current };
}

const CJK_FOLLOW = '(?=[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}])';
const CJK_STRONG = new RegExp('(\\*\\*|__)([^\\n]+?)\\1' + CJK_FOLLOW, 'gu');
const CJK_STRIKE = new RegExp('(~~)([^\\n]+?)\\1' + CJK_FOLLOW, 'gu');
const CJK_ASTERISK_EMPHASIS = new RegExp('(?<!\\*)\\*([^*\\n]+?)\\*' + CJK_FOLLOW, 'gu');
const CJK_UNDERSCORE_EMPHASIS = new RegExp('(?<!_)_([^_\\n]+?)_' + CJK_FOLLOW, 'gu');

export function repairCjkAdjacentEmphasis(value: string) {
  return value
    .replace(CJK_STRONG, '$1$2$1&#8203;')
    .replace(CJK_STRIKE, '$1$2$1&#8203;')
    .replace(CJK_ASTERISK_EMPHASIS, '*$1*&#8203;')
    .replace(CJK_UNDERSCORE_EMPHASIS, '_$1_&#8203;');
}

/** 在解析前修复 CJK 邻接强调，并归一化换行。 */
export function preprocessMarkdownSource(source: string) {
  const normalized = source.replace(/\r\n?/g, '\n');
  const output: string[] = [];
  let fence: FenceState | undefined;

  for (const line of normalized.split('\n')) {
    const scan = nextFenceState(line, fence);
    fence = scan.state;
    output.push(fence ? line : repairCjkAdjacentEmphasis(line));
  }

  return output.join('\n');
}
