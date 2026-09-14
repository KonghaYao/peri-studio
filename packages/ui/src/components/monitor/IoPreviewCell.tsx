import { createSignal, Show, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '../Dialog';
import { JsonTree } from '../JsonTree';

export type IoPreviewCellVariant = 'input' | 'output' | 'neutral';

export type IoPreviewCellProps = {
  data: unknown;
  variant?: IoPreviewCellVariant;
  /** 单行预览最大字符数。 */
  maxLength?: number;
  class?: string;
  'data-testid'?: string;
};

const variantSurfaceClass: Record<IoPreviewCellVariant, string> = {
  input: 'bg-surface-sunken',
  output: 'bg-success-soft',
  neutral: 'bg-transparent',
};

const variantDialogTitle: Record<IoPreviewCellVariant, string> = {
  input: 'Input',
  output: 'Output',
  neutral: 'Data',
};

function previewText(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function isEmpty(data: unknown): boolean {
  return data === null || data === undefined || data === '';
}

/** T3 · 表格内 IO 单行 JSON 预览；点击 Dialog 展开 JsonTree。 */
export const IoPreviewCell: Component<IoPreviewCellProps> = (props) => {
  const [local, rest] = splitProps(props, ['data', 'variant', 'maxLength', 'class']);
  const [open, setOpen] = createSignal(false);

  const variant = () => local.variant ?? 'neutral';
  const maxLength = () => local.maxLength ?? 200;
  const text = () => previewText(local.data);
  const truncated = () => {
    const value = text();
    return value.length > maxLength() ? `${value.slice(0, maxLength())}…` : value;
  };

  return (
    <Show
      when={!isEmpty(local.data)}
      fallback={<span class="text-11 text-content-muted">—</span>}
    >
      <Dialog open={open()} onOpenChange={setOpen}>
        <button
          {...rest}
          type="button"
          data-testid={rest['data-testid'] ?? 'io-preview-cell'}
          data-variant={variant()}
          title={text()}
          class={cn(
            'ui-io-preview-cell max-w-(--container-monitor-io-preview-max) cursor-pointer rounded-4 px-8 py-4 text-left text-11 transition-colors hover:ring-1 hover:ring-border-subtle',
            'font-mono text-content-primary',
            variantSurfaceClass[variant()],
            local.class,
          )}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
        >
          <span class="block truncate">{truncated()}</span>
        </button>

        <DialogContent size="default" class="w-(--container-dialog-default)">
          <DialogPanel
            header={(
              <DialogHeader>
                <DialogTitle>{variantDialogTitle[variant()]}</DialogTitle>
              </DialogHeader>
            )}
            footer={null}
            bodyClass="p-0"
          >
            <JsonTree
              data={local.data}
              defaultCollapsedDepth={3}
              class="max-h-(--container-dialog-tall) border-0 bg-transparent"
              data-testid="io-preview-cell-tree"
            />
          </DialogPanel>
        </DialogContent>
      </Dialog>
    </Show>
  );
};
