import type { Component, JSX } from 'solid-js';
import { cn } from '../lib/cn';

type PresetProps = { class?: string };

/** 内置空状态插图容器（antd Empty 风格，非单色图标）。 */
function PresetIllustration(props: PresetProps & { children: JSX.Element }) {
  return (
    <svg
      viewBox="0 0 184 152"
      class={cn('h-120 w-auto', props.class)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="img"
    >
      {props.children}
    </svg>
  );
}

/** 默认空状态插图。 */
export const EmptyPresetDefault: Component<PresetProps> = (props) => (
  <PresetIllustration class={props.class}>
    <ellipse cx="92" cy="128" rx="64" ry="8" fill="var(--surface-sunken)" />
    <rect x="52" y="36" width="80" height="64" rx="8" fill="var(--surface-overlay)" stroke="var(--border-subtle)" stroke-width="1.5" />
    <rect x="64" y="52" width="56" height="6" rx="3" fill="var(--border-subtle)" />
    <rect x="64" y="66" width="40" height="6" rx="3" fill="var(--border-subtle)" />
    <rect x="64" y="80" width="48" height="6" rx="3" fill="var(--border-subtle)" />
    <path
      d="M108 88l20 20c4 4 4 10 0 14l-6 6c-4 4-10 4-14 0l-20-20"
      stroke="var(--accent-solid)"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle cx="98" cy="78" r="12" stroke="var(--accent-solid)" stroke-width="3" />
  </PresetIllustration>
);

/** 无数据插图。 */
export const EmptyPresetNoData: Component<PresetProps> = (props) => (
  <PresetIllustration class={props.class}>
    <ellipse cx="92" cy="128" rx="64" ry="8" fill="var(--surface-sunken)" />
    <path
      d="M48 56h88l-10 52H58L48 56z"
      fill="var(--accent-soft)"
      stroke="var(--accent-solid)"
      stroke-width="1.5"
      stroke-linejoin="round"
    />
    <path
      d="M58 56l8-16h52l8 16"
      fill="var(--surface-overlay)"
      stroke="var(--accent-solid)"
      stroke-width="1.5"
      stroke-linejoin="round"
    />
    <rect x="72" y="72" width="40" height="28" rx="6" fill="var(--surface-overlay)" stroke="var(--border-subtle)" stroke-width="1.5" />
    <path d="M80 84h24M80 92h16" stroke="var(--border-strong)" stroke-width="2" stroke-linecap="round" />
    <circle cx="128" cy="44" r="6" fill="var(--accent-soft)" stroke="var(--accent-solid)" stroke-width="1.5" />
    <circle cx="140" cy="60" r="4" fill="var(--surface-sunken)" stroke="var(--border-subtle)" stroke-width="1.5" />
  </PresetIllustration>
);

/** 无搜索结果插图。 */
export const EmptyPresetNoResult: Component<PresetProps> = (props) => (
  <PresetIllustration class={props.class}>
    <ellipse cx="92" cy="128" rx="64" ry="8" fill="var(--surface-sunken)" />
    <rect x="44" y="32" width="72" height="88" rx="8" fill="var(--surface-overlay)" stroke="var(--border-subtle)" stroke-width="1.5" />
    <rect x="56" y="48" width="48" height="6" rx="3" fill="var(--border-subtle)" />
    <rect x="56" y="62" width="36" height="6" rx="3" fill="var(--border-subtle)" />
    <rect x="56" y="76" width="42" height="6" rx="3" fill="var(--border-subtle)" />
    <rect x="56" y="90" width="28" height="6" rx="3" fill="var(--border-subtle)" />
    <circle cx="124" cy="96" r="22" fill="var(--accent-soft)" stroke="var(--accent-solid)" stroke-width="3" />
    <path d="M140 112l18 18" stroke="var(--accent-solid)" stroke-width="3" stroke-linecap="round" />
    <path d="M118 96h12M124 90v12" stroke="var(--accent-solid)" stroke-width="2.5" stroke-linecap="round" />
  </PresetIllustration>
);

/** 网络错误插图。 */
export const EmptyPresetNetwork: Component<PresetProps> = (props) => (
  <PresetIllustration class={props.class}>
    <ellipse cx="92" cy="128" rx="64" ry="8" fill="var(--surface-sunken)" />
    <path
      d="M52 72c8-20 32-32 40-32s32 12 40 32"
      stroke="var(--border-strong)"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path
      d="M64 84c6-12 20-18 28-18s22 6 28 18"
      stroke="var(--border-strong)"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path
      d="M76 96c4-6 12-9 16-9s12 3 16 9"
      stroke="var(--border-strong)"
      stroke-width="2"
      stroke-linecap="round"
    />
    <circle cx="92" cy="104" r="6" fill="var(--feedback-danger-soft)" stroke="var(--feedback-danger-solid)" stroke-width="2" />
    <path d="M88 104h8M92 100v8" stroke="var(--feedback-danger-solid)" stroke-width="2" stroke-linecap="round" />
    <path
      d="M128 48l12 12M140 48l-12 12"
      stroke="var(--feedback-danger-solid)"
      stroke-width="2.5"
      stroke-linecap="round"
    />
  </PresetIllustration>
);

export const EMPTY_PRESETS = {
  default: EmptyPresetDefault,
  noData: EmptyPresetNoData,
  noResult: EmptyPresetNoResult,
  network: EmptyPresetNetwork,
} as const;

export type EmptyPresetName = keyof typeof EMPTY_PRESETS;
