/** 流式文本分词：保留空白，便于 inline 排版。 */
export function tokenizeStreamingText(text: string): string[] {
  if (!text) return [];
  return text.match(/\S+|\s+/g) ?? [text];
}

export function isWhitespaceToken(token: string): boolean {
  return /^\s+$/.test(token);
}

export function countWordTokens(tokens: readonly string[]): number {
  return tokens.reduce((n, t) => (isWhitespaceToken(t) ? n : n + 1), 0);
}
