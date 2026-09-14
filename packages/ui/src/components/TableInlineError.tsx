import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Alert, AlertDescription, AlertTitle } from './Alert';
import { Button } from './Button';

export type TableInlineErrorProps = {
  title?: string;
  error: unknown;
  /** 刷新失败但仍展示旧数据时为 true。 */
  isStale?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  action?: JSX.Element;
  class?: string;
  'data-testid'?: string;
};

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** T2 · 表格行内/区块错误；可选 retry 与 action slot（不硬编码 401 跳转）。 */
export const TableInlineError: Component<TableInlineErrorProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'title',
    'error',
    'isStale',
    'onRetry',
    'retryLabel',
    'retrying',
    'action',
    'class',
    'data-testid',
  ]);

  const title = () =>
    local.title ??
    (local.isStale ? 'Could not refresh data; showing previous results.' : 'Request failed');

  const message = () => resolveErrorMessage(local.error);
  const showActions = () => Boolean(local.onRetry || local.action);

  return (
    <Alert
      {...rest}
      type="error"
      class={cn('flex-wrap items-start gap-12', local.class)}
    >
      <div class="min-w-0 flex-1">
        <AlertTitle class="text-danger">{title()}</AlertTitle>
        <AlertDescription class="break-words">{message()}</AlertDescription>
      </div>
      <Show when={showActions()}>
        <div class="flex shrink-0 flex-wrap items-center gap-8">
          <Show when={local.onRetry}>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={local.retrying}
              onClick={() => local.onRetry?.()}
            >
              {local.retryLabel ?? 'Retry'}
            </Button>
          </Show>
          {local.action}
        </div>
      </Show>
    </Alert>
  );
};
