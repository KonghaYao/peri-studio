/* T1 Tokens 页视觉预览用的静态档位清单（不依赖样式表解析顺序）。 */

export const SPACING_PREVIEW_STEPS = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

export const SPACING_GAP_DEMOS = [
  { utility: 'gap-8', token: '--space-8', label: '8px' },
  { utility: 'gap-16', token: '--space-16', label: '16px' },
  { utility: 'gap-24', token: '--space-24', label: '24px' },
] as const;

export const RADIUS_PREVIEW_STEPS = [
  { name: '--radius-2', label: '2' },
  { name: '--radius-4', label: '4' },
  { name: '--radius-6', label: '6' },
  { name: '--radius-8', label: '8' },
  { name: '--radius-12', label: '12' },
  { name: '--radius-16', label: '16' },
  { name: '--radius-full', label: 'pill' },
] as const;

export const RADIUS_SEMANTIC_DEMOS = [
  { name: '--radius-control', label: 'control', hint: 'Button · Input' },
  { name: '--radius-card', label: 'card', hint: 'Card · Panel' },
  { name: '--radius-pill', label: 'pill', hint: 'Badge · Chip' },
] as const;

export const TYPOGRAPHY_ROLE_DEMOS = [
  { name: '--text-caption', label: 'Caption', sample: '辅助说明 · Secondary hint', utility: 'text-caption' },
  { name: '--text-body', label: 'Body', sample: '正文默认 · Interface copy at rest', utility: 'text-body' },
  { name: '--text-title', label: 'Title', sample: '区块标题 · Section heading', utility: 'text-title' },
  { name: '--text-display', label: 'Display', sample: '页面大标题 · Page hero', utility: 'text-display' },
] as const;

export const TYPOGRAPHY_SIZE_STEPS = [
  '--text-9',
  '--text-10',
  '--text-11',
  '--text-12',
  '--text-13',
  '--text-14',
  '--text-15',
  '--text-16',
  '--text-17',
  '--text-18',
  '--text-19',
  '--text-24',
  '--text-28',
] as const;

export const TYPOGRAPHY_LEADING_DEMOS = [
  { name: '--leading-tight', label: 'tight', sample: '紧凑行高用于单行标签或紧凑列表。' },
  { name: '--leading-snug', label: 'snug', sample: '略紧行高用于次级说明与 meta 行。' },
  { name: '--leading-normal', label: 'normal', sample: '正文默认行高，多行阅读最舒适。' },
  { name: '--leading-relaxed', label: 'relaxed', sample: '宽松行高用于长文或说明段落。' },
] as const;

export const FONT_STACK_DEMOS = [
  { name: '--font-sans', label: 'Sans', sample: 'The quick brown fox · 敏捷的棕色狐狸' },
  { name: '--font-mono', label: 'Mono', sample: 'const token = "peri-studio"; // 0123456789' },
] as const;

export const FONT_WEIGHT_DEMOS = [400, 500, 550, 600, 650, 700] as const;

export const SHELL_GEOMETRY_DEMOS = [
  { name: '--sandbox-header-height', label: 'Sandbox header', role: 'height' as const },
  { name: '--sandbox-scroll-anchor', label: 'Scroll anchor', role: 'height' as const },
  { name: '--shell-sidebar-width', label: 'Sidebar width', role: 'width' as const },
  { name: '--shell-sidebar-width-desk', label: 'Sidebar (desk)', role: 'width' as const },
] as const;
