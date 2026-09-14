import {
  Bot,
  Settings,
  SquareTerminal,
  User,
  type LucideIcon,
} from 'lucide-solid';

export type ChatIoRoleConfig = {
  label: string;
  icon: LucideIcon;
  roleClass: string;
  iconClass: string;
  alignRight?: boolean;
  mono?: boolean;
};

const ROLE_CONFIG: Record<string, ChatIoRoleConfig> = {
  system: {
    label: 'System',
    icon: Settings,
    roleClass: 'ui-io-chat-role-system',
    iconClass: 'ui-io-chat-icon-system',
  },
  developer: {
    label: 'Developer',
    icon: Settings,
    roleClass: 'ui-io-chat-role-system',
    iconClass: 'ui-io-chat-icon-system',
  },
  user: {
    label: 'User',
    icon: User,
    roleClass: 'ui-io-chat-role-user',
    iconClass: 'ui-io-chat-icon-user',
    alignRight: true,
  },
  assistant: {
    label: 'Assistant',
    icon: Bot,
    roleClass: 'ui-io-chat-role-assistant',
    iconClass: 'ui-io-chat-icon-assistant',
  },
  tool: {
    label: 'Tool',
    icon: SquareTerminal,
    roleClass: 'ui-io-chat-role-tool',
    iconClass: 'ui-io-chat-icon-tool',
    mono: true,
  },
  function: {
    label: 'Function',
    icon: SquareTerminal,
    roleClass: 'ui-io-chat-role-tool',
    iconClass: 'ui-io-chat-icon-tool',
    mono: true,
  },
};

const FALLBACK_ROLE: ChatIoRoleConfig = {
  label: '',
  icon: Bot,
  roleClass: 'ui-io-chat-role-fallback',
  iconClass: 'ui-io-chat-icon-fallback',
};

export function chatIoRoleConfig(role: string): ChatIoRoleConfig {
  const cfg = ROLE_CONFIG[role];
  if (cfg) return cfg;
  return { ...FALLBACK_ROLE, label: role };
}
