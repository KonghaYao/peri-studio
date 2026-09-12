import { createEffect, createSignal, For, Show, splitProps, type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../../lib/cn';
import { ComposerAttachmentChip } from './ComposerAttachmentChip';
import { ComposerAttachmentList } from './ComposerAttachmentList';
import { ComposerDropOverlay } from './ComposerDropOverlay';
import type { ComposerAttachmentItem } from './composer-attachment-types';
import {
  COMPOSER_EXPANDED_FIELD_MAX_HEIGHT_PX,
  COMPOSER_FIELD_LINE_HEIGHT_PX,
  composerShellExpanded,
} from './composer-shell-utils';
import { Textarea } from '../Textarea';

export type ComposerShellFieldContext = {
  expanded: boolean;
  bindRef: (element: HTMLTextAreaElement | undefined) => void;
  fieldClass: string;
  maxHeight: number;
};

export type ComposerShellProps = {
  class?: string;
  disabled?: boolean;
  dropActive?: boolean;
  dropDescribedById?: string;
  /** 受控展开；省略时由附件/换行/折行自动推导 */
  expanded?: boolean;
  attachments?: ComposerAttachmentItem[];
  attachmentLayout?: 'chip' | 'tile';
  draft?: string;
  onDraftChange?: (value: string) => void;
  queue?: JSX.Element;
  overlay?: JSX.Element;
  /** 置于 surface 内最前（如上传拖放层） */
  innerLeading?: JSX.Element;
  /** T4 自定义输入区（prediction/placeholder 叠层等） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T4 field slot merges ctx with app props via Dynamic
  renderField?: Component<any>;
  renderFieldProps?: Record<string, unknown>;
  fieldPlaceholder?: string;
  fieldDisabled?: boolean;
  fieldAriaLabel?: string;
  notices?: JSX.Element;
  compactLeading?: JSX.Element;
  compactTrailing?: JSX.Element;
  expandedToolbar?: JSX.Element;
  metaRow?: JSX.Element;
  registerFileInput?: (element: HTMLInputElement | undefined) => void;
  onFilesPicked?: (files: FileList | null) => void;
  surfaceRef?: (element: HTMLDivElement | undefined) => void;
  'aria-busy'?: boolean;
  'aria-disabled'?: boolean;
  'data-testid'?: string;
};

function fieldClass(expanded: boolean) {
  return cn(
    'ui-composer-surface-v2__field',
    expanded ? 'ui-composer-surface-v2__field--expanded' : 'ui-composer-surface-v2__field--compact',
  );
}

/** T3 · Composer 双形态壳：compact 胶囊 / expanded 多行；T4 通过 slot 注入业务控件。 */
export const ComposerShell: Component<ComposerShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'disabled',
    'dropActive',
    'dropDescribedById',
    'expanded',
    'attachments',
    'attachmentLayout',
    'draft',
    'onDraftChange',
    'queue',
    'overlay',
    'innerLeading',
    'renderField',
    'renderFieldProps',
    'fieldPlaceholder',
    'fieldDisabled',
    'fieldAriaLabel',
    'notices',
    'compactLeading',
    'compactTrailing',
    'expandedToolbar',
    'metaRow',
    'registerFileInput',
    'onFilesPicked',
    'surfaceRef',
  ]);
  const surfaceAria = () => ({
    'aria-busy': rest['aria-busy'],
    'aria-disabled': rest['aria-disabled'],
    'data-testid': rest['data-testid'],
  });

  const [wrapped, setWrapped] = createSignal(false);
  const [internalDraft, setInternalDraft] = createSignal(local.draft ?? '');
  let fieldRef: HTMLTextAreaElement | undefined;

  const attachments = () => local.attachments ?? [];
  const attachmentLayout = () => local.attachmentLayout ?? 'chip';
  const draftValue = () => local.draft ?? internalDraft();
  const disabled = () => local.disabled ?? false;

  const autoExpanded = () => composerShellExpanded({
    draft: draftValue(),
    attachmentCount: attachments().length,
    wrapped: wrapped(),
  });
  const expanded = () => local.expanded ?? autoExpanded();

  const setDraftValue = (value: string) => {
    if (local.draft === undefined) setInternalDraft(value);
    local.onDraftChange?.(value);
    queueMicrotask(measureField);
  };

  const measureField = () => {
    const element = fieldRef;
    const value = draftValue();
    if (!element || !value.trim()) {
      setWrapped(false);
      return;
    }
    if (value.includes('\n')) {
      setWrapped(false);
      return;
    }
    setWrapped(element.scrollHeight > element.clientHeight + 1);
  };

  const resizeField = () => {
    const element = fieldRef;
    if (!element) return;
    element.style.height = 'auto';
    const maxHeight = expanded()
      ? COMPOSER_EXPANDED_FIELD_MAX_HEIGHT_PX
      : COMPOSER_FIELD_LINE_HEIGHT_PX;
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
    measureField();
  };

  createEffect(() => {
    if (local.draft !== undefined) setInternalDraft(local.draft);
    queueMicrotask(measureField);
  });

  createEffect(() => {
    expanded();
    draftValue();
    queueMicrotask(resizeField);
  });

  const bindFieldRef = (element: HTMLTextAreaElement | undefined) => {
    fieldRef = element;
    queueMicrotask(measureField);
  };

  const fieldCtx = (): ComposerShellFieldContext => ({
    expanded: expanded(),
    bindRef: bindFieldRef,
    fieldClass: fieldClass(expanded()),
    maxHeight: expanded()
      ? COMPOSER_EXPANDED_FIELD_MAX_HEIGHT_PX
      : COMPOSER_FIELD_LINE_HEIGHT_PX,
  });

  const defaultField = () => (
    <Textarea
      ref={bindFieldRef}
      variant="bare"
      autoResize
      maxHeight={fieldCtx().maxHeight}
      rows={1}
      value={draftValue()}
      onInput={(event) => setDraftValue(event.currentTarget.value)}
      placeholder={local.fieldPlaceholder}
      aria-label={local.fieldAriaLabel ?? 'Message the agent'}
      disabled={local.fieldDisabled ?? disabled()}
      class={fieldCtx().fieldClass}
    />
  );

  return (
    <div class={cn('ui-composer-shell', local.class, disabled() && 'opacity-60')}>
      {local.queue}
      {local.overlay}
      <div
        ref={(element) => local.surfaceRef?.(element)}
        data-slot="composer-surface"
        aria-busy={surfaceAria()['aria-busy']}
        aria-disabled={surfaceAria()['aria-disabled']}
        data-testid={surfaceAria()['data-testid'] ?? 'composer-surface'}
        class={cn(
          'ui-composer-surface-v2',
          expanded() ? 'ui-composer-surface-v2--expanded' : 'ui-composer-surface-v2--compact',
          local.dropActive && 'ui-composer-surface--drop-target',
        )}
        aria-dropeffect={local.dropActive ? 'copy' : undefined}
        aria-describedby={local.dropActive ? local.dropDescribedById : undefined}
        data-composer-expanded={expanded() ? 'true' : 'false'}
      >
        <ComposerDropOverlay
          active={!!local.dropActive}
          describedById={local.dropDescribedById ?? 'composer-drop-desc'}
        />
        {local.innerLeading}

        <Show when={expanded() && attachments().length > 0}>
          <div class="ui-composer-surface-v2__attachments">
            <Show
              when={attachmentLayout() === 'tile'}
              fallback={
                <div class="ui-composer-attachment-float" aria-label="Attached files">
                  <For each={attachments()}>
                    {(attachment) => <ComposerAttachmentChip {...attachment} />}
                  </For>
                </div>
              }
            >
              <ComposerAttachmentList items={attachments()} />
            </Show>
          </div>
        </Show>

        <div class="ui-composer-surface-v2__body">
          <Show when={!expanded()}>{local.compactLeading}</Show>
          <Show
            when={local.renderField}
            fallback={defaultField()}
          >
            <Dynamic component={local.renderField!} ctx={fieldCtx()} {...(local.renderFieldProps ?? {})} />
          </Show>
          <Show when={!expanded()}>{local.compactTrailing}</Show>
        </div>

        {local.notices}

        <Show when={expanded()}>
          <div class="ui-composer-surface-v2__toolbar">
            {local.compactLeading}
            {local.expandedToolbar ?? (
              <>
                <span class="flex-1" />
                {local.compactTrailing}
              </>
            )}
          </div>
        </Show>

        <Show when={local.onFilesPicked}>
          <input
            ref={(element) => local.registerFileInput?.(element)}
            type="file"
            multiple
            class="ui-sr-only"
            aria-hidden="true"
            tabindex={-1}
            disabled={disabled()}
            onChange={(event) => local.onFilesPicked?.(event.currentTarget.files)}
          />
        </Show>
      </div>

      <Show when={local.metaRow}>
        <div class="ui-composer-meta-row">{local.metaRow}</div>
      </Show>
    </div>
  );
};
