import type { JSX } from 'solid-js';
import { createFloatingNoticeStore, type NoticeTone } from '../../lib/floating-notice-store';

export type MessageConfig = {
  content: string | JSX.Element;
  duration?: number;
  key?: string | number;
  onClose?: () => void;
};

export const messageStore = createFloatingNoticeStore('message');

function open(tone: NoticeTone, config: MessageConfig | string) {
  const normalized = typeof config === 'string' ? { content: config } : config;
  const close = messageStore.open({
    tone,
    content: normalized.content,
    duration: normalized.duration ?? 3000,
    key: normalized.key,
  });
  return {
    close: () => {
      close();
      normalized.onClose?.();
    },
  };
}

/** Ant Design 风格全局 Message API（需挂载 MessageHost）。 */
export const message = {
  open: (config: MessageConfig) => open('info', config),
  info: (config: MessageConfig | string) => open('info', config),
  success: (config: MessageConfig | string) => open('success', config),
  warning: (config: MessageConfig | string) => open('warning', config),
  error: (config: MessageConfig | string) => open('error', config),
  loading: (config: MessageConfig | string) => open('loading', { ...(typeof config === 'string' ? { content: config } : config), duration: 0 }),
  destroy: (key?: string | number) => messageStore.dismissByKey(key),
};
