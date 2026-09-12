const FENCE = /^\s{0,3}(`{3,}|~{3,})([^`]*)$/;

interface FenceState {
  marker: string;
  size: number;
}

export interface PreparedMarkdownSource {
  source: string;
  inlineMath: ReadonlyMap<string, string>;
}

function nextFenceState(line: string, current: FenceState | undefined) {
  const match = line.match(FENCE);
  if (!match) return { match: null, state: current };
  const marker = match[1][0];
  if (!current) return { match, state: { marker, size: match[1].length } };
  if (marker === current.marker && match[1].length >= current.size) return { match, state: undefined };
  return { match, state: current };
}

function findMathEnd(line: string, start: number, delimiter: '$' | '$$') {
  let cursor = start + delimiter.length;
  while (cursor < line.length) {
    const end = line.indexOf(delimiter, cursor);
    if (end < 0) return -1;
    if (line[end - 1] !== '\\') return end;
    cursor = end + delimiter.length;
  }
  return -1;
}

interface ProtectedRange {
  start: number;
  end: number;
}

function markdownDestinationRanges(line: string) {
  const ranges: ProtectedRange[] = [];
  const reference = line.match(/^\s{0,3}\[[^\]\n]+\]:\s*/);
  if (reference) ranges.push({ start: reference[0].length, end: line.length });

  let search = 0;
  while (search < line.length) {
    const destination = line.indexOf('](', search);
    if (destination < 0) break;
    let cursor = destination + 2;
    let depth = 1;
    while (cursor < line.length && depth > 0) {
      if (line[cursor] === '\\') cursor += 2;
      else {
        if (line[cursor] === '(') depth += 1;
        if (line[cursor] === ')') depth -= 1;
        cursor += 1;
      }
    }
    ranges.push({ start: destination + 2, end: cursor });
    search = cursor;
  }

  for (const pattern of [
    /<(?:https?:\/\/|mailto:)[^>\n]+>/gi,
    /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<]+/gi,
    /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi,
  ]) {
    for (const match of line.matchAll(pattern)) ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  return ranges.reduce<ProtectedRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
    return merged;
  }, []);
}

function replaceInlineMath(line: string, tokenPrefix: string, inlineMath: Map<string, string>) {
  let result = '';
  let plain = '';
  let cursor = 0;
  let codeTicks = 0;
  const protectedRanges = markdownDestinationRanges(line);
  let protectedIndex = 0;
  const flushPlain = () => {
    result += repairCjkDelimiters(plain);
    plain = '';
  };
  while (cursor < line.length) {
    while (protectedRanges[protectedIndex]?.end <= cursor) protectedIndex += 1;
    const protectedRange = protectedRanges[protectedIndex];
    if (protectedRange && protectedRange.start <= cursor && cursor < protectedRange.end) {
      flushPlain();
      result += line.slice(cursor, protectedRange.end);
      cursor = protectedRange.end;
      continue;
    }
    if (line[cursor] === '`') {
      flushPlain();
      let end = cursor;
      while (line[end] === '`') end += 1;
      const count = end - cursor;
      codeTicks = codeTicks === count ? 0 : codeTicks === 0 ? count : codeTicks;
      result += line.slice(cursor, end);
      cursor = end;
      continue;
    }
    if (codeTicks === 0 && line[cursor] === '$' && line[cursor - 1] !== '\\') {
      const delimiter = line.startsWith('$$', cursor) ? '$$' : '$';
      const end = findMathEnd(line, cursor, delimiter);
      const expression = end < 0 ? '' : line.slice(cursor + delimiter.length, end);
      const singleDollarIsValid = delimiter === '$$' || (!/^\s/.test(expression) && !/\s$/.test(expression));
      if (expression && singleDollarIsValid) {
        flushPlain();
        const token = `${tokenPrefix}${inlineMath.size}`;
        inlineMath.set(token, expression.trim());
        result += `\`${token}\``;
        cursor = end + delimiter.length;
        continue;
      }
    }
    if (codeTicks === 0) plain += line[cursor];
    else result += line[cursor];
    cursor += 1;
  }
  flushPlain();
  return result;
}

const CJK_FOLLOW = '(?=[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}])';
const CJK_STRONG = new RegExp('(\\*\\*|__)([^\\n]+?)\\1' + CJK_FOLLOW, 'gu');
const CJK_STRIKE = new RegExp('(~~)([^\\n]+?)\\1' + CJK_FOLLOW, 'gu');
const CJK_ASTERISK_EMPHASIS = new RegExp('(?<!\\*)\\*([^*\\n]+?)\\*' + CJK_FOLLOW, 'gu');
const CJK_UNDERSCORE_EMPHASIS = new RegExp('(?<!_)_([^_\\n]+?)_' + CJK_FOLLOW, 'gu');

function repairCjkText(value: string) {
  return value
    .replace(CJK_STRONG, '$1$2$1&#8203;')
    .replace(CJK_STRIKE, '$1$2$1&#8203;')
    .replace(CJK_ASTERISK_EMPHASIS, '*$1*&#8203;')
    .replace(CJK_UNDERSCORE_EMPHASIS, '_$1_&#8203;');
}

const repairCjkDelimiters = repairCjkText;

function collisionFreeMathPrefix(source: string) {
  let index = 0;
  let prefix = `\uE000peri-math-${index}-`;
  while (source.includes(prefix)) prefix = `\uE000peri-math-${++index}-`;
  return prefix;
}

/** 把扩展语法归一为现有解析器可稳定消费的 Markdown。 */
export function prepareMarkdownSource(source: string): PreparedMarkdownSource {
  const normalized = source.replace(/\r\n?/g, '\n');
  const tokenPrefix = collisionFreeMathPrefix(normalized);
  const inlineMath = new Map<string, string>();
  const output: string[] = [];
  let fence: FenceState | undefined;
  let math = false;

  for (const line of normalized.split('\n')) {
    if (math) {
      if (line.trim() === '$$') {
        output.push('```');
        math = false;
      } else output.push(line);
      continue;
    }

    const scan = nextFenceState(line, fence);
    if (scan.match) {
      fence = scan.state;
      const normalizedInfo = scan.match[2]
        .replace(/([\w-]+)=([^\s"']+)/g, '$1="$2"')
        .replace(/\s+(noLineNumbers)(?=\s|$)/g, ' $1="true"');
      output.push(`${line.slice(0, line.indexOf(scan.match[1]))}${scan.match[1]}${normalizedInfo}`);
      continue;
    }

    if (!fence && line.trim() === '$$') {
      output.push('```math');
      math = true;
      continue;
    }
    output.push(fence ? line : replaceInlineMath(line, tokenPrefix, inlineMath));
  }
  return { source: output.join('\n'), inlineMath };
}

export function endsInsideFence(source: string) {
  let fence: FenceState | undefined;
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) fence = nextFenceState(line, fence).state;
  return !!fence;
}