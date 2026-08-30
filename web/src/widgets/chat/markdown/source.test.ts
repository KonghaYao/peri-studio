import { describe, expect, it } from 'vitest';
import { endsInsideFence, prepareMarkdownSource, safeRemoteImageSource } from './source';

describe('Markdown source preparation', () => {
  it('normalizes math and code metadata without rewriting fenced content', () => {
    const source = 'Inline $$x + y$$.\n\n$$\nz = 1\n$$\n\n```ts startLine=7\nconst value = "$$raw$$";\n```';
    const prepared = prepareMarkdownSource(source);
    expect(prepared.inlineMath).toEqual(new Map([[expect.stringContaining('peri-math'), 'x + y']]));
    expect(prepared.source).toContain('```math\nz = 1\n```');
    expect(prepared.source).toContain('```ts startLine="7"');
    expect(prepared.source).toContain('const value = "$$raw$$";');
  });

  it('supports standard inline math without mistaking an unmatched price for math', () => {
    const prepared = prepareMarkdownSource('Formula $x + y$ costs $5.');
    expect([...prepared.inlineMath.values()]).toEqual(['x + y']);
    expect(prepared.source).toContain('costs $5.');
  });

  it('uses a collision-free token registry for internal math nodes', () => {
    const forged = '\uE000peri-math-0-0';
    const prepared = prepareMarkdownSource(`${forged} and $x$`);
    expect(prepared.source).toContain(forged);
    expect([...prepared.inlineMath.keys()][0]).not.toBe(forged);
  });

  it('does not repair CJK markers inside inline code', () => {
    const prepared = prepareMarkdownSource('`**代码。**后续` and **正文。**后续');
    expect(prepared.source).toContain('`**代码。**后续`');
    expect(prepared.source).toContain('**正文。**&#8203;后续');
  });

  it('repairs underscore emphasis next to CJK text', () => {
    expect(prepareMarkdownSource('_重要_后续').source).toContain('_重要_&#8203;后续');
  });

  it('does not rewrite underscores inside link destinations', () => {
    const sources = [
      '[x](https://example.test/a_b_中文)',
      '[id]: https://example.test/a_b_中文',
      '<https://example.test/a_b_中文>',
      'Visit https://example.test/a_b_中文 now',
    ];
    for (const source of sources) expect(prepareMarkdownSource(source).source).toBe(source);
  });

  it('does not parse dollar pairs inside Markdown destinations as math', () => {
    const sources = [
      '[x](https://example.test/$path$)',
      '[id]: https://example.test/$path$',
      '<https://example.test/$path$>',
      'Visit https://example.test/$path$ now',
      'Contact dev$ops$@example.com now',
    ];
    for (const source of sources) {
      const prepared = prepareMarkdownSource(source);
      expect(prepared.source).toBe(source);
      expect(prepared.inlineMath.size).toBe(0);
    }
  });

  it('tracks only genuinely unclosed fenced blocks', () => {
    expect(endsInsideFence('```ts\nconst x = 1;')).toBe(true);
    expect(endsInsideFence('````md\n```\n````')).toBe(false);
  });

  it('allows only explicit remote HTTP image sources', () => {
    expect(safeRemoteImageSource('https://example.test/image.png')).toBe('https://example.test/image.png');
    expect(safeRemoteImageSource('javascript:alert(1)')).toBeNull();
    expect(safeRemoteImageSource('file:///etc/passwd')).toBeNull();
    expect(safeRemoteImageSource('/relative.png')).toBeNull();
  });
});
