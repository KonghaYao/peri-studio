import type { JSX } from 'solid-js';
import { createFloatingNoticeStore, type NoticeTone } from '../../lib/floating-notice-store';

export type NotificationPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type NotificationConfig = {
  message: string | JSX.Element;
  description?: string | JSX.Element;
  duration?: number;
  key?: string | number;
  placement?: NotificationPlacement;
  action?: JSX.Element;
  onClose?: () => void;
};

type NotificationRecord = {
  tone: NoticeTone;
  content: string | JSX.Element;
  title?: string | JSX.Element;
  duration: number;
  key?: string | number;
  placement?: NotificationPlacement;
  action?: JSX.Element;
};

export const notificationStore = createFloatingNoticeStore('notification');

function open(tone: NoticeTone, config: NotificationConfig) {
  const record: Omit<NotificationRecord, 'id'> & { id?: string } = {
    tone,
    title: config.message,
    content: config.description ?? '',
    duration: config.duration ?? 4500,
    key: config.key,
    placement: config.placement,
    action: config.action,
  };
  const close = notificationStore.open(record);
  return {
    close: () => {
      close();
      config.onClose?.();
    },
  };
}

export function notificationsForPlacement(placement: NotificationPlacement) {
  return () => notificationStore.items().filter((item) => (item.placement ?? 'top-right') === placement);
}

/** Ant Design 风格 Notification API（按 placement 挂载 NotificationHost）。 */
export const notification = {
  open: (config: NotificationConfig & { type?: NoticeTone }) =>
    open(config.type ?? 'info', config),
  info: (config: NotificationConfig) => open('info', config),
  success: (config: NotificationConfig) => open('success', config),
  warning: (config: NotificationConfig) => open('warning', config),
  error: (config: NotificationConfig) => open('error', config),
  destroy: (key?: string | number) => notificationStore.dismissByKey(key),
};
