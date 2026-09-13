import { ArrowUp, Check, Mic, Plus, ScanLine, SendHorizontal } from 'lucide-solid';
import { Show, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { Button, IconButton } from '../Button';
import { composerSendBtnClass, composerSkillsButtonClass, composerSkillsIconClass } from './composer-layout';

const sendActionClass =
  'ui-composer-action flex w-36 min-h-36 shrink-0 items-center justify-center rounded-8 max-narrow:w-48 max-narrow:min-h-44';

const stopActionClass =
  'ui-composer-action ui-composer-action--stop flex w-36 min-h-36 shrink-0 items-center justify-center rounded-8 max-narrow:w-48 max-narrow:min-h-44';

export const ComposerMicButton: Component<{
  listening?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}> = (props) => (
  <IconButton
    data-testid="composer-mic"
    label={props.listening ? 'Stop voice input' : 'Voice input'}
    title={props.title ?? (props.listening ? 'Stop voice input' : 'Voice input')}
    disabled={props.disabled}
    aria-pressed={props.listening || undefined}
    class="shrink-0 border-0 bg-transparent text-content-primary disabled:opacity-55"
    onClick={props.onClick}
  >
    <Mic
      size={18}
      strokeWidth={1.7}
      class={props.listening ? 'animate-pulse text-accent' : undefined}
      aria-hidden="true"
    />
  </IconButton>
);

export const ComposerAttachmentButton: Component<{
  disabled?: boolean;
  onClick: () => void;
}> = (props) => (
  <IconButton
    label="Add attachment"
    title="Upload files to this project"
    disabled={props.disabled}
    class="ui-composer-attachment max-narrow:hidden shrink-0 border-0 bg-transparent text-content-primary disabled:opacity-55"
    onClick={props.onClick}
  >
    <Plus size={18} strokeWidth={1.7} />
  </IconButton>
);

export const ComposerPredictionButton: Component<{
  onClick: () => void;
}> = (props) => (
  <Button
    size="compact"
    variant="secondary"
    class="ui-composer-prediction-action inline-flex min-h-(--control-height-compact) items-center justify-center px-9 border-border-subtle bg-surface-muted text-text-secondary text-11 pointer-coarse:min-h-44 max-narrow:min-h-44"
    onClick={props.onClick}
    aria-label="Use suggestion"
    title="Use suggestion (Tab)"
  >
    <Check size={16} strokeWidth={1.7} />
    <kbd class="ml-3 px-4 py-2 border border-border-subtle rounded-4 bg-surface text-9 max-narrow:hidden">Tab</kbd>
  </Button>
);

export const ComposerSkillsButton: Component<{
  skillCount: number;
  menuId: string;
  expanded: boolean;
  disabled?: boolean;
  onClick: () => void;
}> = (props) => (
  <Button
    size="compact"
    class={composerSkillsButtonClass}
    aria-expanded={props.expanded}
    aria-controls={props.menuId}
    aria-label={`Browse skills (${props.skillCount})`}
    title={`Browse skills (${props.skillCount})`}
    onClick={props.onClick}
    disabled={props.disabled}
  >
    <ScanLine size={17} strokeWidth={1.7} class={composerSkillsIconClass} aria-hidden="true" />
    <span class="sr-only">{props.skillCount}</span>
  </Button>
);

export type ComposerSendStopActionProps = {
  mode: 'send' | 'stop';
  label: string;
  disabled?: boolean;
  busy?: boolean;
  uncertain?: boolean;
  showStopGlyph?: boolean;
  /** pill：ComposerShell compact 内联圆形发送钮 */
  shape?: 'default' | 'pill';
  onClick: () => void;
};

export const ComposerSendStopAction: Component<ComposerSendStopActionProps> = (props) => {
  const [local] = splitProps(props, ['mode', 'label', 'disabled', 'busy', 'uncertain', 'showStopGlyph', 'shape', 'onClick']);
  const variant = () => (local.mode === 'send' ? 'primary' : 'stop') as 'primary' | 'stop';
  const pill = () => local.shape === 'pill';

  return (
    <span class="shrink-0">
      <IconButton
        data-testid="composer-action"
        tooltipPlacement="end"
        variant={variant()}
        size={pill() ? 'sm' : undefined}
        showTooltip={!pill()}
        type="button"
        onClick={local.onClick}
        disabled={local.disabled}
        busy={local.busy}
        label={local.label}
        class={cn(
          pill() ? composerSendBtnClass : local.mode === 'send' ? sendActionClass : stopActionClass,
          local.mode === 'stop' && local.uncertain && 'bg-warning hover:bg-warning-strong',
        )}
      >
        <Show when={local.mode === 'send'}>
          <Show when={pill()} fallback={<SendHorizontal size={18} strokeWidth={1.7} />}>
            <ArrowUp size={16} strokeWidth={2.2} />
          </Show>
        </Show>
        <Show when={local.mode === 'stop' && (local.showStopGlyph ?? true)}>
          <span aria-hidden="true" class="size-10 rounded-2 bg-current" />
        </Show>
      </IconButton>
    </span>
  );
};
