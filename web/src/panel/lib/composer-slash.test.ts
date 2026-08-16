import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentCommandInfo } from './control-view';
import { useComposerSlash, type ComposerSlashController } from './composer-slash';

const catalog: AgentCommandInfo[] = [
  { name: 'compact', description: 'Compress context', kind: 'command' },
  { name: 'auto-issue-fixer', description: 'Fix an issue', kind: 'skill' },
  { name: 'mcp__docs__search', description: 'Search docs', kind: 'mcp_skill' },
];

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); });

function setup(overrides: {
  draft?: string;
  enabled?: boolean;
  catalog?: AgentCommandInfo[];
  canBrowseSkills?: boolean;
} = {}) {
  let draft = overrides.draft ?? '';
  const inserted: Array<{ text: string; caret: number }> = [];
  let controller!: ComposerSlashController;
  createRoot((dispose) => {
    controller = useComposerSlash({
      draft: () => draft,
      catalog: () => overrides.catalog ?? catalog,
      enabled: () => overrides.enabled ?? true,
      canBrowseSkills: () => overrides.canBrowseSkills ?? true,
      onInsert: (text, caret) => {
        inserted.push({ text, caret });
        draft = text;
      },
    });
    disposers.push(dispose);
  });
  return {
    controller,
    inserted,
    setDraft: (value: string) => { draft = value; },
  };
}

const caret = (text: string) => ({ selectionStart: text.length, value: text } as HTMLTextAreaElement);

describe('useComposerSlash', () => {
  it('filters the catalog by the slash token query', () => {
    const { controller, setDraft } = setup();
    setDraft('/aut');
    controller.onCaret(caret('/aut'));
    expect(controller.slashMenuOpen()).toBe(true);
    expect(controller.slashItems().map((item) => item.name)).toEqual(['auto-issue-fixer']);
  });

  it('stays closed without a slash token even with a full catalog', () => {
    const { controller } = setup({ draft: 'plain text' });
    controller.onCaret(caret('plain text'));
    expect(controller.slashMenuOpen()).toBe(false);
  });

  it('navigates with arrows and inserts on Enter through onInsert', () => {
    const { controller, inserted } = setup({ draft: '/' });
    controller.onCaret(caret('/'));
    expect(controller.slashMenuOpen()).toBe(true);

    // 空查询排序：skill 优先（auto-issue-fixer, mcp__docs__search, compact）
    expect(controller.slashItems().map((item) => item.name)).toEqual(['auto-issue-fixer', 'mcp__docs__search', 'compact']);
    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(controller.boundedActiveIndex()).toBe(1);
    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(inserted).toEqual([{ text: '/mcp__docs__search ', caret: 19 }]);
    expect(controller.slashMenuOpen()).toBe(false);
  });

  it('inserts on Tab and wraps the arrow index cyclically', () => {
    const { controller, inserted } = setup({ draft: '/' });
    controller.onCaret(caret('/'));

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(controller.boundedActiveIndex()).toBe(2);
    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Tab' }));

    expect(inserted).toEqual([{ text: '/compact ', caret: 9 }]);
    expect(controller.slashMenuOpen()).toBe(false);
  });

  it('closes on Escape without touching the draft', () => {
    const { controller, inserted } = setup({ draft: '/' });
    controller.onCaret(caret('/'));
    expect(controller.slashMenuOpen()).toBe(true);

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(controller.slashMenuOpen()).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(controller.browseSkills()).toBe(false);
  });

  it('leaves unrelated keys for the host to handle', () => {
    const { controller } = setup({ draft: '/' });
    controller.onCaret(caret('/'));
    expect(controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'x' }))).toBe(false);
    expect(controller.slashMenuOpen()).toBe(true);
  });

  it('browses only skills when the Skills button toggles the mode', () => {
    const { controller, inserted } = setup({ draft: '' });
    controller.toggleBrowse(undefined);
    expect(controller.browseSkills()).toBe(true);
    expect(controller.slashMenuOpen()).toBe(true);
    expect(controller.slashItems().map((item) => item.name)).toEqual(['auto-issue-fixer', 'mcp__docs__search']);

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(controller.slashMenuOpen()).toBe(false);
    expect(inserted).toEqual([{ text: '/auto-issue-fixer ', caret: 18 }]);
  });

  it('dismisses the menu when focus leaves the composer wrap', async () => {
    const { controller, setDraft } = setup({ draft: '/' });
    controller.onCaret(caret('/'));
    setDraft('/x');
    controller.onCaret(caret('/x'));
    expect(controller.slashMenuOpen()).toBe(true);

    controller.onBlur();
    await Promise.resolve();
    expect(controller.slashMenuOpen()).toBe(false);
  });

  it('reopens after dismiss once the user types again', () => {
    const { controller } = setup({ draft: '/' });
    controller.onCaret(caret('/'));
    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(controller.slashMenuOpen()).toBe(false);

    controller.onInputValue(caret('/c'));
    expect(controller.slashMenuOpen()).toBe(true);
  });

  it('never opens while input is disabled', () => {
    const { controller } = setup({ draft: '/', enabled: false });
    controller.onCaret(caret('/'));
    expect(controller.slashMenuOpen()).toBe(false);
  });
});
