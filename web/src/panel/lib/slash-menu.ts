import type { AgentCommandInfo } from './control-view';

export interface SlashToken {
  start: number;
  end: number;
  query: string;
}

export interface DraftInsertion {
  text: string;
  cursor: number;
}

/** Find the slash token containing the caret without treating file paths as commands. */
export function slashTokenAt(text: string, cursor: number): SlashToken | null {
  const caret = Math.max(0, Math.min(cursor, text.length));
  let start = caret;
  while (start > 0 && !/\s/u.test(text[start - 1])) start -= 1;
  let end = caret;
  while (end < text.length && !/\s/u.test(text[end])) end += 1;
  const token = text.slice(start, end);
  if (!token.startsWith('/') || token.slice(1).includes('/')) return null;
  return { start, end, query: text.slice(start + 1, caret) };
}

export function filterCommandCatalog(
  catalog: AgentCommandInfo[],
  query: string,
  mode: 'all' | 'skills',
  limit = 10,
): AgentCommandInfo[] {
  const needle = query.trim().toLocaleLowerCase();
  const typeRank = (kind: AgentCommandInfo['kind']) => kind === 'skill' ? 0 : kind === 'mcp_skill' ? 1 : 2;
  return catalog
    .filter((item) => mode === 'all' || item.kind !== 'command')
    .filter((item) => {
      if (!needle) return true;
      return item.name.toLocaleLowerCase().includes(needle)
        || item.description.toLocaleLowerCase().includes(needle);
    })
    .sort((left, right) => {
      const leftName = left.name.toLocaleLowerCase();
      const rightName = right.name.toLocaleLowerCase();
      const leftMatch = leftName === needle ? 0 : leftName.startsWith(needle) ? 1 : 2;
      const rightMatch = rightName === needle ? 0 : rightName.startsWith(needle) ? 1 : 2;
      return leftMatch - rightMatch
        || typeRank(left.kind) - typeRank(right.kind)
        || leftName.localeCompare(rightName);
    })
    .slice(0, limit);
}

/** Insert a slash invocation at the active token/caret. Selection never sends. */
export function insertSlashCommand(text: string, cursor: number, name: string): DraftInsertion {
  const caret = Math.max(0, Math.min(cursor, text.length));
  const token = slashTokenAt(text, caret);
  const invocation = `/${name} `;
  if (token) {
    return {
      text: `${text.slice(0, token.start)}${invocation}${text.slice(token.end)}`,
      cursor: token.start + invocation.length,
    };
  }
  const prefix = text.slice(0, caret);
  const suffix = text.slice(caret);
  const lead = prefix && !/\s$/u.test(prefix) ? ' ' : '';
  const command = `/${name}`;
  const suffixHasSpace = /^\s/u.test(suffix);
  const tail = suffixHasSpace ? '' : ' ';
  const inserted = `${lead}${command}${tail}`;
  return {
    text: `${prefix}${inserted}${suffix}`,
    cursor: caret + lead.length + command.length + (suffixHasSpace ? 1 : tail.length),
  };
}
