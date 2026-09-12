/* Token 控制面板「基础项」清单：对应 Tailwind theme 映射的 typography / shell 变量。 */

export interface BasicsTokenSpec {
  name: string;
  label: string;
  hint?: string;
  unit?: 'px' | 'em' | 'ratio';
}

export const TYPOGRAPHY_ROLE_TOKENS: BasicsTokenSpec[] = [
  { name: '--text-caption', label: 'Caption', hint: 'text-caption · 辅助说明', unit: 'px' },
  { name: '--text-body', label: 'Body', hint: 'text-body · 正文默认', unit: 'px' },
  { name: '--text-title', label: 'Title', hint: 'text-title · 区块标题', unit: 'px' },
  { name: '--text-display', label: 'Display', hint: 'text-display · 页面大标题', unit: 'px' },
];

export const TYPOGRAPHY_SIZE_SCALE: BasicsTokenSpec[] = [
  { name: '--text-9', label: 'text-9', unit: 'px' },
  { name: '--text-10', label: 'text-10', unit: 'px' },
  { name: '--text-10p5', label: 'text-10.5', unit: 'px' },
  { name: '--text-11', label: 'text-11', unit: 'px' },
  { name: '--text-11p5', label: 'text-11.5', unit: 'px' },
  { name: '--text-12', label: 'text-12', unit: 'px' },
  { name: '--text-12p5', label: 'text-12.5', unit: 'px' },
  { name: '--text-13', label: 'text-13', unit: 'px' },
  { name: '--text-14', label: 'text-14', unit: 'px' },
  { name: '--text-15', label: 'text-15', unit: 'px' },
  { name: '--text-16', label: 'text-16', unit: 'px' },
  { name: '--text-17', label: 'text-17', unit: 'px' },
  { name: '--text-18', label: 'text-18', unit: 'px' },
  { name: '--text-19', label: 'text-19', unit: 'px' },
  { name: '--text-24', label: 'text-24', unit: 'px' },
  { name: '--text-28', label: 'text-28', unit: 'px' },
];

export const TYPOGRAPHY_LEADING_ROLES: BasicsTokenSpec[] = [
  { name: '--leading-tight', label: 'Leading tight', hint: 'leading-tight', unit: 'ratio' },
  { name: '--leading-snug', label: 'Leading snug', hint: 'leading-snug', unit: 'ratio' },
  { name: '--leading-compact', label: 'Leading compact', hint: 'leading-compact', unit: 'ratio' },
  { name: '--leading-normal', label: 'Leading normal', hint: 'leading-normal · body 默认', unit: 'ratio' },
  { name: '--leading-relaxed', label: 'Leading relaxed', hint: 'leading-relaxed', unit: 'ratio' },
];

export const TYPOGRAPHY_FONT_TOKENS: BasicsTokenSpec[] = [
  { name: '--font-sans', label: 'Sans stack', hint: 'font-sans · UI 与正文' },
  { name: '--font-mono', label: 'Mono stack', hint: 'font-mono · 代码与等宽' },
];

export const SHELL_CHROME_TOKENS: BasicsTokenSpec[] = [
  { name: '--sandbox-header-height', label: 'Sandbox header height', hint: '顶栏 + Tab 总高度', unit: 'px' },
  { name: '--sandbox-scroll-anchor', label: 'Scroll anchor offset', hint: '章节锚点 scroll-margin', unit: 'px' },
  { name: '--shell-sidebar-width', label: 'Shell sidebar width', hint: '默认侧栏宽度', unit: 'px' },
  { name: '--shell-sidebar-width-desk', label: 'Shell sidebar (desk)', hint: '窄屏侧栏宽度', unit: 'px' },
];

const EXCLUDED = new Set<string>([
  ...TYPOGRAPHY_ROLE_TOKENS.map((item) => item.name),
  ...TYPOGRAPHY_SIZE_SCALE.map((item) => item.name),
  ...TYPOGRAPHY_LEADING_ROLES.map((item) => item.name),
  ...TYPOGRAPHY_FONT_TOKENS.map((item) => item.name),
  ...SHELL_CHROME_TOKENS.map((item) => item.name),
]);

export function isBasicsPanelToken(name: string): boolean {
  return EXCLUDED.has(name);
}
