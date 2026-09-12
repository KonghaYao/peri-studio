import { batch, createSignal, type JSX } from 'solid-js';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error' | 'loading';

export type FloatingNoticeItem = {
  id: string;
  tone: NoticeTone;
  content: string | JSX.Element;
  title?: string | JSX.Element;
  duration: number;
  key?: string | number;
  placement?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  action?: JSX.Element;
};

let idCounter = 0;

function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function createFloatingNoticeStore(prefix: string) {
  const [items, setItems] = createSignal<FloatingNoticeItem[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const dismiss = (id: string) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const dismissByKey = (key?: string | number) => {
    if (key == null) {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      setItems([]);
      return;
    }
    setItems((current) => {
      const next = current.filter((item) => item.key !== key);
      current
        .filter((item) => item.key === key)
        .forEach((item) => {
          const timer = timers.get(item.id);
          if (timer) {
            clearTimeout(timer);
            timers.delete(item.id);
          }
        });
      return next;
    });
  };

  const open = (input: Omit<FloatingNoticeItem, 'id'> & { id?: string }) => {
    const id = input.id ?? nextId(prefix);
    const duration = input.duration ?? 3000;
    const item: FloatingNoticeItem = { ...input, id, duration };

    batch(() => {
      setItems((current) => {
        if (input.key != null) {
          const existing = current.find((entry) => entry.key === input.key);
          if (existing) {
            dismiss(existing.id);
          }
        }
        return [...current, item];
      });
    });

    if (duration > 0) {
      const timer = setTimeout(() => dismiss(id), duration);
      timers.set(id, timer);
    }

    return () => dismiss(id);
  };

  return {
    items,
    open,
    dismiss,
    dismissByKey,
  };
}
