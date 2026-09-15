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
  onClose?: () => void;
};

let idCounter = 0;

function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function createFloatingNoticeStore(prefix: string) {
  const [items, setItems] = createSignal<FloatingNoticeItem[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const dismiss = (id: string, options?: { silent?: boolean }) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    let closed: FloatingNoticeItem | undefined;
    setItems((current) => {
      closed = current.find((item) => item.id === id);
      return current.filter((item) => item.id !== id);
    });
    if (!options?.silent) closed?.onClose?.();
  };

  const dismissByKey = (key?: string | number, options?: { silent?: boolean }) => {
    if (key == null) {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      const closing = options?.silent ? [] : items();
      setItems([]);
      closing.forEach((item) => item.onClose?.());
      return;
    }
    const closing: FloatingNoticeItem[] = [];
    setItems((current) => {
      const next = current.filter((item) => {
        if (item.key !== key) return true;
        closing.push(item);
        const timer = timers.get(item.id);
        if (timer) {
          clearTimeout(timer);
          timers.delete(item.id);
        }
        return false;
      });
      return next;
    });
    if (!options?.silent) closing.forEach((item) => item.onClose?.());
  };

  const open = (input: Omit<FloatingNoticeItem, 'id'> & { id?: string }) => {
    const id = input.id ?? nextId(prefix);
    const duration = input.duration ?? 3000;
    const item: FloatingNoticeItem = { ...input, id, duration };

    batch(() => {
      setItems((current) => {
        const next = input.key == null
          ? current
          : current.filter((entry) => {
            if (entry.key !== input.key) return true;
            const timer = timers.get(entry.id);
            if (timer) {
              clearTimeout(timer);
              timers.delete(entry.id);
            }
            return false;
          });
        return [...next, item];
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
