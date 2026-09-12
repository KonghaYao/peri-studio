import { render } from 'solid-js/web';
import { createSignal, Show } from 'solid-js';
import { CheckCircle2, CircleAlert, CircleX, Info } from 'lucide-solid';
import { Button } from './Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './Dialog';

export type DialogMethodType = 'info' | 'success' | 'warning' | 'error' | 'confirm';

export type DialogMethodConfig = {
  title?: string;
  content?: string;
  okText?: string;
  cancelText?: string;
  centered?: boolean;
  maskClosable?: boolean;
  onOk?: () => void | Promise<void>;
  onCancel?: () => void;
};

type ActiveDialog = DialogMethodConfig & { type: DialogMethodType };

let host: HTMLDivElement | undefined;
let setActive: ((value: ActiveDialog | null) => void) | undefined;

function ensureHost() {
  if (host) return;
  host = document.createElement('div');
  document.body.appendChild(host);
  const [active, set] = createSignal<ActiveDialog | null>(null);
  setActive = set;
  render(() => (
    <Show when={active()}>
      {(current) => (
        <Dialog open onOpenChange={(open) => { if (!open) set(null); }}>
          <DialogContent
            dismissible={current().maskClosable ?? true}
            class={current().centered ? 'top-1/2' : undefined}
          >
            <DialogHeader>
              <DialogTitle class="flex items-center gap-8">
                <MethodIcon type={current().type} />
                {current().title}
              </DialogTitle>
              <Show when={current().content}>
                <DialogDescription>{current().content}</DialogDescription>
              </Show>
            </DialogHeader>
            <DialogFooter>
              <Show when={current().type === 'confirm'}>
                <Button variant="default" onClick={() => { current().onCancel?.(); set(null); }}>
                  {current().cancelText ?? 'Cancel'}
                </Button>
              </Show>
              <Button
                variant={current().type === 'error' ? 'danger' : 'primary'}
                onClick={async () => {
                  await current().onOk?.();
                  set(null);
                }}
              >
                {current().okText ?? 'OK'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Show>
  ), host);
}

function MethodIcon(props: { type: DialogMethodType }) {
  const size = 18;
  switch (props.type) {
    case 'success':
      return <CheckCircle2 size={size} class="text-success" aria-hidden="true" />;
    case 'warning':
    case 'confirm':
      return <CircleAlert size={size} class="text-warning" aria-hidden="true" />;
    case 'error':
      return <CircleX size={size} class="text-danger" aria-hidden="true" />;
    default:
      return <Info size={size} class="text-info" aria-hidden="true" />;
  }
}

function open(type: DialogMethodType, config: DialogMethodConfig) {
  ensureHost();
  setActive?.({ ...config, type });
}

/** 静态 Dialog 辅助方法，对齐 Ant Design Modal.method。 */
export const dialog = {
  info: (config: DialogMethodConfig) => open('info', config),
  success: (config: DialogMethodConfig) => open('success', config),
  warning: (config: DialogMethodConfig) => open('warning', config),
  error: (config: DialogMethodConfig) => open('error', config),
  confirm: (config: DialogMethodConfig) => open('confirm', config),
};
