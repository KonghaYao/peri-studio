import type { ComposerAttachmentItem, ComposerQueueItem } from '@/components/blocks/composer';
import type { SlashMenuItem } from '@/components/blocks/composer/SlashMenu';

/** Catalog 演示用图片缩略图占位（SVG data URI）。 */
function demoImagePreview(label: string, fill = '#e8e8e8') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect fill="${fill}" width="64" height="64"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="9" fill="#8c8c8c" font-family="system-ui,sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export type ComposerAttachment = ComposerAttachmentItem;

export const COMPOSER_MODEL_OPTIONS = [
  { value: 'composer-2.5', label: 'Composer 2.5' },
  { value: 'composer-2', label: 'Composer 2' },
  { value: 'gpt-5', label: 'GPT-5' },
];

export const COMPOSER_BRANCH_OPTIONS = [
  { value: 'main', label: 'main' },
  { value: 'feat/composer', label: 'feat/composer' },
];

export const COMPOSER_LOCATION_OPTIONS = [
  { value: 'this-mac', label: 'This Mac' },
  { value: 'remote', label: 'Remote workspace' },
];

export const COMPOSER_SLASH_ITEMS: SlashMenuItem[] = [
  { name: 'goal', description: 'Set a goal that the agent will pursue to completion' },
  { name: 'summarize', description: 'Summarize this conversation' },
  { name: 'canvas', description: 'Create a document, diagram, or small website…' },
  { name: 'plan', description: 'Generate an implementation plan', variant: 'plan', accent: true, dividerAfter: true },
  { name: 'compact', description: 'Compacts the current context', variant: 'plugin' },
  { name: 'automate', description: 'Trigger an agent to run based on a trigger…' },
  { name: 'code-review', description: 'Review code instead of editing it' },
  { name: 'commit', description: 'Commit the current changes' },
];

export const COMPOSER_ACTIVE_DRAFT = `composer 帮我改为这个样子一个是正常形态，另外一个是输入形态。attachments 我觉得需要浮动上去显示名称，整个还是正常的方块，注意输入区域的动态变化，注意分支，位置的显示，右下角的 usage。 + 是显示 slash commands 的，但是里面有文件上传选项，和一些特殊选项`;

export const COMPOSER_ACTIVE_ATTACHMENTS: ComposerAttachment[] = [
  { id: '1', name: 'Composer.tsx', kind: 'file', status: 'ready', onRemove: () => {} },
  {
    id: '2',
    name: 'layout.png',
    kind: 'image',
    status: 'ready',
    previewUrl: demoImagePreview('PNG', '#dbeafe'),
    showSuccessBadge: true,
    onRemove: () => {},
  },
];

export const COMPOSER_QUEUE_DEMO: ComposerQueueItem[] = [
  {
    id: 'queued-1',
    preview: 'inline 编辑不要有边框，高度和位置要对齐，减少布局抖动',
    hasAttachment: true,
  },
];

export const COMPOSER_UPLOAD_TILE_MATRIX: ComposerAttachment[] = [
  { id: 'pending', name: 'notes.txt', kind: 'file', status: 'pending' },
  {
    id: 'uploading',
    name: 'diagram.png',
    kind: 'image',
    status: 'uploading',
    progress: 62,
    previewUrl: demoImagePreview('PNG', '#fef3c7'),
  },
  { id: 'committing', name: 'spec.md', kind: 'file', status: 'committing' },
  {
    id: 'ready',
    name: 'layout.png',
    kind: 'image',
    status: 'ready',
    previewUrl: demoImagePreview('PNG', '#dbeafe'),
    showSuccessBadge: true,
    onRemove: () => {},
  },
  {
    id: 'failed',
    name: 'large.bin',
    kind: 'file',
    status: 'failed',
    errorMessage: 'File exceeds 8 MB limit.',
    onRetry: () => {},
  },
];

export const COMPOSER_UPLOAD_BATCH_DEMO: ComposerAttachment[] = [
  { id: 'api', name: 'api.ts', kind: 'file', status: 'ready', onRemove: () => {} },
  {
    id: 'schema',
    name: 'schema.json',
    kind: 'file',
    status: 'uploading',
    progress: 38,
  },
  {
    id: 'readme',
    name: 'README.md',
    kind: 'file',
    status: 'failed',
    errorMessage: 'A file already exists at this path.',
    onRetry: () => {},
  },
];

export const COMPOSER_UPLOAD_DRAFT = 'Compare @src/api.ts with the uploaded copy.';
