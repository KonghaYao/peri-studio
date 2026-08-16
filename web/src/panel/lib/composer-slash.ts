// Composer 的 slash 菜单交互（P4 从 Composer 拆出）。
//
// 职责：caret / browseSkills / menuDismissed / activeCommandIndex 四组
// 交互信号的持有者，负责菜单项计算（filterCommandCatalog）、菜单开合
// 决策、键盘导航（↑↓/Enter/Tab/Esc）与命令插入。draft 与 textarea
// focus 通过 `onInsert` 回调交给宿主编排，保持本模块无 store/DOM 依赖。
// `handleKeyDown` 返回是否已消费事件，宿主按需继续处理 prediction 与
// 提交键。

import { createMemo, createSignal } from 'solid-js';
import type { AgentCommandInfo } from './control-view';
import { filterCommandCatalog, insertSlashCommand, slashTokenAt } from './slash-menu';

export interface ComposerSlashOptions {
  /** 当前会话草稿（宿主从 composerDraft(selectedSessionId()) 取）。 */
  draft: () => string;
  /** 协商到的命令目录（chatHead().agent.commandCatalog）。 */
  catalog: () => AgentCommandInfo[];
  /** 输入是否可用（inputDisabled 的取反）。 */
  enabled: () => boolean;
  /** 是否展示 Skills 浏览入口（协商了 peri.skillNames 且有 skill）。 */
  canBrowseSkills: () => boolean;
  /** 插入文本后回调（宿主写 draft、更新 caret 并 focus textarea）。 */
  onInsert: (text: string, caret: number) => void;
}

export function useComposerSlash(options: ComposerSlashOptions) {
  const [caret, setCaret] = createSignal(0);
  const [browseSkills, setBrowseSkills] = createSignal(false);
  const [menuDismissed, setMenuDismissed] = createSignal(false);
  const [activeCommandIndex, setActiveCommandIndex] = createSignal(0);

  const activeSlashToken = () => slashTokenAt(options.draft(), caret());
  const slashItems = createMemo(() => filterCommandCatalog(
    options.catalog(),
    browseSkills() ? '' : activeSlashToken()?.query ?? '',
    browseSkills() ? 'skills' : 'all',
  ));
  const slashMenuOpen = () => options.enabled()
    && !menuDismissed()
    && slashItems().length > 0
    && (browseSkills() || activeSlashToken() !== null);
  const boundedActiveIndex = () => Math.min(activeCommandIndex(), Math.max(0, slashItems().length - 1));

  function selectCommand(name: string) {
    const draft = options.draft();
    const insertion = insertSlashCommand(draft, caret(), name);
    options.onInsert(insertion.text, insertion.cursor);
    setBrowseSkills(false);
    setMenuDismissed(true);
  }

  /** textarea 输入：跟踪 caret 并重置菜单导航态。 */
  function onInputValue(element: HTMLTextAreaElement) {
    setCaret(element.selectionStart ?? element.value.length);
    setBrowseSkills(false);
    setMenuDismissed(false);
    setActiveCommandIndex(0);
  }

  /** 光标移动/选择变化。 */
  function onCaret(element: HTMLTextAreaElement) {
    setCaret(element.selectionStart ?? element.value.length);
  }

  /** 失焦：焦点离开 composer-wrap 才收起菜单。 */
  function onBlur() {
    queueMicrotask(() => {
      if (!document.activeElement?.closest('.composer-wrap')) {
        setBrowseSkills(false);
        setMenuDismissed(true);
      }
    });
  }

  /** Skills 浏览按钮：以当前光标位置展开全量 skill 列表。 */
  function toggleBrowse(element: HTMLTextAreaElement | undefined) {
    setCaret(element?.selectionStart ?? options.draft().length);
    setBrowseSkills((open) => !open);
    setMenuDismissed(false);
    setActiveCommandIndex(0);
  }

  /** 菜单打开时的键盘导航；返回 true 表示事件已被消费。 */
  function handleKeyDown(event: KeyboardEvent): boolean {
    if (!slashMenuOpen()) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const length = slashItems().length;
      setActiveCommandIndex((boundedActiveIndex() + delta + length) % length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const item = slashItems()[boundedActiveIndex()];
      if (item) selectCommand(item.name);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setBrowseSkills(false);
      setMenuDismissed(true);
      return true;
    }
    return false;
  }

  /** SlashMenu 的 onPointerMove 上报：切换高亮项。 */
  function onMenuActiveIndex(index: number) {
    setActiveCommandIndex(index);
  }

  return {
    caret,
    setCaret,
    browseSkills,
    slashMenuOpen,
    slashItems,
    boundedActiveIndex,
    selectCommand,
    onMenuActiveIndex,
    onInputValue,
    onCaret,
    onBlur,
    toggleBrowse,
    handleKeyDown,
  };
}

export type ComposerSlashController = ReturnType<typeof useComposerSlash>;
