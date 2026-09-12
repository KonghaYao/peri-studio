import type { Component, JSX } from 'solid-js';
import { cn } from '../lib/cn';

type PresetProps = { class?: string };

function PresetSvg(props: PresetProps & { children: JSX.Element }) {
  return (
    <svg
      viewBox="0 0 96 96"
      class={cn('size-96 text-content-muted', props.class)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

/** 默认空状态插图。 */
export const EmptyPresetDefault: Component<PresetProps> = (props) => (
  <PresetSvg class={props.class}>
    <rect x="20" y="24" width="56" height="48" rx="8" stroke="currentColor" stroke-width="2" />
    <path d="M32 40h32M32 48h24" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </PresetSvg>
);

/** 无数据插图。 */
export const EmptyPresetNoData: Component<PresetProps> = (props) => (
  <PresetSvg class={props.class}>
    <circle cx="48" cy="40" r="18" stroke="currentColor" stroke-width="2" />
    <path d="M30 68c6-10 30-10 36 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </PresetSvg>
);

/** 无搜索结果插图。 */
export const EmptyPresetNoResult: Component<PresetProps> = (props) => (
  <PresetSvg class={props.class}>
    <circle cx="42" cy="42" r="16" stroke="currentColor" stroke-width="2" />
    <path d="M54 54l14 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </PresetSvg>
);

/** 网络错误插图。 */
export const EmptyPresetNetwork: Component<PresetProps> = (props) => (
  <PresetSvg class={props.class}>
    <path d="M24 56h48l-8-24H32l-8 24z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
    <path d="M40 64h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </PresetSvg>
);

export const EMPTY_PRESETS = {
  default: EmptyPresetDefault,
  noData: EmptyPresetNoData,
  noResult: EmptyPresetNoResult,
  network: EmptyPresetNetwork,
} as const;

export type EmptyPresetName = keyof typeof EMPTY_PRESETS;
