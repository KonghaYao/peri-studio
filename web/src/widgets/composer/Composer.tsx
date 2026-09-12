// 发送窗口（Composer）：输入区 + 底部工具行（ui.md §3.8 / §四.7）。
// 编排留在本 shell；工具行 / 附件条 / 编辑器拆至同目录子组件。

import { Show, type JSX } from 'solid-js';
import { cn } from '@peri/ui';
import { SlashMenu } from './SlashMenu';
import { ComposerUploadSurface } from './ComposerUploadSurface';
import { ComposerStagedAssets } from './ComposerStagedAssets';
import { ComposerEditor } from './ComposerEditor';
import { ComposerToolbar } from './ComposerToolbar';
import { useComposerState } from './useComposerState';

export function Composer(props: {
  layout?: 'docked' | 'centered';
  renderRuntimeMenu?: (ctx: { id: string; disabled: boolean }) => JSX.Element;
}) {
  const centered = () => props.layout === 'centered';
  let taRef: HTMLTextAreaElement | undefined;
  let composerSurfaceRef: HTMLElement | undefined;
  const state = useComposerState(() => taRef);

  const focusInput = () => {
    taRef?.focus();
  };

  const runtimeMenu = () =>
    props.renderRuntimeMenu?.({
      id: state.modelMenuId,
      disabled: state.runtimeMenuDisabled(),
    }) ?? null;

  return (
    <div
      data-testid="composer-wrap"
      class={cn(
        'composer-wrap relative w-full',
        centered() ? 'composer-wrap--centered' : 'composer-wrap--overlay chat-column',
      )}
    >
      <Show when={state.slash.slashMenuOpen()}>
        <SlashMenu
          id={state.slashMenuId}
          items={state.slash.slashItems()}
          activeIndex={state.slash.boundedActiveIndex()}
          onActiveIndex={state.slash.onMenuActiveIndex}
          onSelect={(item) => state.slash.selectCommand(item.name)}
          onKeyDown={(event) => {
            state.slash.handleKeyDown(event);
          }}
        />
      </Show>
      <section
        ref={composerSurfaceRef}
        data-testid="composer-surface"
        aria-busy={state.submissionIsInFlight() || undefined}
        aria-disabled={state.inputDisabled()}
        class="composer-surface relative overflow-hidden border border-composer-border rounded-(--composer-radius) bg-surface-overlay p-2.5 max-narrow:rounded-16"
      >
        <ComposerUploadSurface
          origin="composer"
          projectId={state.draftOwner()?.projectId ?? null}
          disabled={state.inputDisabled()}
          dropDescId={state.uploadDropDescId}
          surfaceRef={composerSurfaceRef}
          registerFileInput={(element) => {
            state.setUploadFileInputRef(element);
          }}
          getDraft={() => state.composerDraft(state.draftOwner())}
          setDraft={(text) => state.setComposerDraft(state.draftOwner(), text)}
          focusAt={state.focusAt}
          readCaret={() => ({
            start: taRef?.selectionStart ?? state.composerDraft(state.draftOwner()).length,
            end: taRef?.selectionEnd ?? state.composerDraft(state.draftOwner()).length,
          })}
        />
        <ComposerStagedAssets />
        <ComposerEditor
          centered={centered()}
          state={state}
          taRef={(el) => {
            taRef = el;
          }}
          focusInput={focusInput}
        />
        <ComposerToolbar
          state={state}
          runtimeMenu={runtimeMenu()}
          focusInput={focusInput}
          textareaRef={() => taRef}
        />
      </section>
    </div>
  );
}
