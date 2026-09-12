import { Check, Plus, ScanLine, SendHorizontal } from 'lucide-solid';
import { Show, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { Button, IconButton } from '../Button';

const sendActionClass =
  'ui-composer-action flex w-36 min-h-36 shrink-0 items-center justify-center rounded-8 max-narrow:w-48 max-narrow:min-h-44';

const stopActionClass =
  'ui-composer-action ui-composer-action--stop flex w-36 min-h-36 shrink-0 items-center justify-center rounded-8 max-narrow:w-48 max-narrow:min-h-44';

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
    class="ui-composer-skills relative inline-flex w-34 min-h-30 items-center justify-center gap-0 rounded-7 border-0 bg-transparent p-0 text-text-primary text-11 font-normal pointer-coarse:w-48 pointer-coarse:min-h-44"
    aria-expanded={props.expanded}
    aria-controls={props.menuId}
    aria-label={`Browse skills (${props.skillCount})`}
    title={`Browse skills (${props.skillCount})`}
    onClick={props.onClick}
    disabled={props.disabled}
  >
    <ScanLine size={17} strokeWidth={1.7} class="ui-composer-skills__icon" aria-hidden="true" />
    <span class="ui-composer-skills__count sr-only">{props.skillCount}</span>
  </Button>
);

export type ComposerSendStopActionProps = {
  mode: 'send' | 'stop';
  label: string;
  disabled?: boolean;
  busy?: boolean;
  uncertain?: boolean;
  showStopGlyph?: boolean;
  onClick: () => void;
};

export const ComposerSendStopAction: Component<ComposerSendStopActionProps> = (props) => {
  const [local] = splitProps(props, ['mode', 'label', 'disabled', 'busy', 'uncertain', 'showStopGlyph', 'onClick']);
  const variant = () => (local.mode === 'send' ? 'primary' : 'stop') as 'primary' | 'stop';

  return (
    <span class="shrink-0">
      <IconButton
        data-testid="composer-action"
        tooltipPlacement="end"
        variant={variant()}
        type="button"
        onClick={local.onClick}
        disabled={local.disabled}
        busy={local.busy}
        label={local.label}
        class={cn(
          local.mode === 'send' ? sendActionClass : stopActionClass,
          local.mode === 'stop' && local.uncertain && 'bg-warning hover:bg-warning-strong',
        )}
      >
        <Show when={local.mode === 'send'}>
          <SendHorizontal size={18} strokeWidth={1.7} />
        </Show>
        <Show when={local.mode === 'stop' && (local.showStopGlyph ?? true)}>
          <span aria-hidden="true" class="size-10 rounded-2 bg-current" />
        </Show>
      </IconButton>
    </span>
  );
};
