import { createEffect, onCleanup } from 'solid-js';
import { dismissPersistentError, persistentErrors, retryPersistentAction } from '@/store';
import { Button, CopyButton, NotificationHost, notification } from '@peri/ui';
import type { PersistentError } from '@/features/message/panel-errors';

const published = new Map<number, string>();

function fingerprint(error: PersistentError): string {
  return [error.title, error.detail, error.retryable, error.retrying, error.commandId ?? ''].join('\0');
}

function errorAction(error: PersistentError) {
  return (
    <div class="flex flex-wrap items-center gap-8">
      <CopyButton
        size="compact"
        class="pointer-coarse:min-h-44"
        text={[error.title, error.detail, error.commandId].filter(Boolean).join('\n')}
        label="Copy details"
      />
      {((error.retryable || error.retrying) && error.commandId) ? (
        <Button
          variant="primary"
          size="compact"
          busy={error.retrying}
          disabled={error.retrying}
          class="pointer-coarse:min-h-44"
          onClick={() => retryPersistentAction(error.commandId!)}
        >
          Re-confirm with the original request
        </Button>
      ) : null}
    </div>
  );
}

/** 将持久错误投影到 `@peri/ui` 全局 Notification，不占用对话栏 inline。 */
export function ErrorCenter() {
  createEffect(() => {
    const errors = persistentErrors();
    const live = new Set(errors.map((error) => error.id));
    for (const id of [...published.keys()]) {
      if (live.has(id)) continue;
      notification.destroy(id);
      published.delete(id);
    }
    for (const error of errors) {
      const next = fingerprint(error);
      if (published.get(error.id) === next) continue;
      published.set(error.id, next);
      notification.error({
        key: error.id,
        duration: error.retryable || error.retrying ? 0 : 6000,
        message: error.title,
        description: error.detail,
        action: errorAction(error),
        onClose: () => dismissPersistentError(error.id),
      });
    }
  });
  onCleanup(() => {
    for (const id of [...published.keys()]) notification.destroy(id);
    published.clear();
  });
  return <NotificationHost placement="top-right" class="p-safe" />;
}
