import { children, createEffect, createSignal, For, onCleanup, Show, splitProps, type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../../lib/cn';
import { ComposerAttachmentChip } from './ComposerAttachmentChip';
import { ComposerAttachmentList } from './ComposerAttachmentList';
import { ComposerDropOverlay } from './ComposerDropOverlay';
import type { ComposerAttachmentItem } from './composer-attachment-types';
import {
  composerAttachmentFloatClass,
  composerMetaRowClass,
  composerShellClass,
  composerSurfaceAttachmentsClass,
  composerSurfaceBodyClass,
  composerSurfaceClass,
  composerSurfaceFieldClass,
  composerSurfaceFieldSlotClass,
  composerSurfaceLeadingClass,
  composerSurfaceToolbarClass,
  composerSurfaceTrailingClass,
} from './composer-layout';
import {
  COMPOSER_EXPANDED_FIELD_MAX_HEIGHT_PX,
  COMPOSER_FIELD_LINE_HEIGHT_PX,
  composerShellExpanded,
  composerSoftWrapsAtWidth,
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

function CompactSlot(props: { class: string; children?: JSX.Element }) {
  const slot = children(() => props.children);
  return (
    <Show when={slot()}>
      <div class={props.class}>{slot()}</div>
    </Show>
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
  let compactFieldWidth = 0;
  let widthProbe: HTMLSpanElement | undefined;
  let layoutScheduled = false;

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
    scheduleFieldLayout();
  };

  const measureNowrapWidth = (element: HTMLTextAreaElement, value: string) => {
    if (typeof document === 'undefined' || !value) return 0;
    const style = getComputedStyle(element);
    if (!widthProbe) {
      widthProbe = document.createElement('span');
      widthProbe.setAttribute('aria-hidden', 'true');
    }
    widthProbe.style.cssText = [
      'position:absolute',
      'left:-99999px',
      'top:0',
      'visibility:hidden',
      'pointer-events:none',
      'white-space:pre',
      `font:${style.font || `${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`}`,
      `letter-spacing:${style.letterSpacing}`,
      `text-transform:${style.textTransform}`,
      'padding:0',
      'border:0',
      'margin:0',
    ].join(';');
    widthProbe.textContent = value;
    if (!widthProbe.isConnected) document.body.appendChild(widthProbe);
    return widthProbe.getBoundingClientRect().width;
  };

  const measureField = () => {
    const element = fieldRef;
    if (!element) return;
    const value = element.value || draftValue();
    if (!value.trim()) {
      setWrapped(false);
      return;
    }
    if (value.includes('\n')) return;
    if (!expanded()) {
      const width = element.clientWidth;
      if (width > 0) compactFieldWidth = width;
    }
    const compactWidth = compactFieldWidth || element.clientWidth;
    setWrapped(composerSoftWrapsAtWidth({
      draft: value,
      nowrapWidth: measureNowrapWidth(element, value),
      compactWidth,
      currentlyWrapped: wrapped(),
    }));
  };

  const resizeField = () => {
    const element = fieldRef;
    if (!element) return;
    element.style.height = 'auto';
    const maxHeight = expanded()
      ? COMPOSER_EXPANDED_FIELD_MAX_HEIGHT_PX
      : COMPOSER_FIELD_LINE_HEIGHT_PX;
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  };

  const syncFieldLayout = () => {
    measureField();
    resizeField();
  };

  const scheduleFieldLayout = () => {
    if (layoutScheduled) return;
    layoutScheduled = true;
    queueMicrotask(() => {
      layoutScheduled = false;
      syncFieldLayout();
    });
  };

  createEffect(() => {
    if (local.draft !== undefined) setInternalDraft(local.draft);
    draftValue();
    attachments().length;
    scheduleFieldLayout();
  });

  onCleanup(() => {
    widthProbe?.remove();
    widthProbe = undefined;
  });

  const bindFieldRef = (element: HTMLTextAreaElement | undefined) => {
    fieldRef = element;
    scheduleFieldLayout();
  };

  const fieldCtx = (): ComposerShellFieldContext => ({
    expanded: expanded(),
    bindRef: bindFieldRef,
    fieldClass: composerSurfaceFieldClass(expanded()),
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
    <div class={cn(composerShellClass, local.class, disabled() && 'opacity-60')}>
      {local.queue}
      {local.overlay}
      <div
        ref={(element) => local.surfaceRef?.(element)}
        data-slot="composer-surface"
        aria-busy={surfaceAria()['aria-busy']}
        aria-disabled={surfaceAria()['aria-disabled']}
        data-testid={surfaceAria()['data-testid'] ?? 'composer-surface'}
        class={composerSurfaceClass(expanded())}
        data-drop-active={local.dropActive ? '' : undefined}
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
          <div class={composerSurfaceAttachmentsClass}>
            <Show
              when={attachmentLayout() === 'tile'}
              fallback={
                <div class={composerAttachmentFloatClass} aria-label="Attached files">
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

        <div
          data-slot="composer-body"
          class={composerSurfaceBodyClass(expanded(), attachments().length > 0)}
        >
          <Show when={!expanded()}>
            <CompactSlot class={composerSurfaceLeadingClass}>{local.compactLeading}</CompactSlot>
          </Show>
          <div class={composerSurfaceFieldSlotClass(expanded())}>
            <Show
              when={local.renderField}
              fallback={defaultField()}
            >
              <Dynamic component={local.renderField!} ctx={fieldCtx()} {...(local.renderFieldProps ?? {})} />
            </Show>
          </div>
          <Show when={!expanded()}>
            <CompactSlot class={composerSurfaceTrailingClass}>{local.compactTrailing}</CompactSlot>
          </Show>
        </div>

        {local.notices}

        <Show when={expanded()}>
          <div class={composerSurfaceToolbarClass}>
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
            class="sr-only"
            aria-hidden="true"
            tabindex={-1}
            disabled={disabled()}
            onChange={(event) => local.onFilesPicked?.(event.currentTarget.files)}
          />
        </Show>
      </div>

      <Show when={local.metaRow}>
        <div class={composerMetaRowClass}>{local.metaRow}</div>
      </Show>
    </div>
  );
};
