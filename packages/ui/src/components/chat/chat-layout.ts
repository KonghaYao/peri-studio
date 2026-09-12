/** 正文、Composer、状态区等共享的水平轨道（gutter + content max）。 */
export const chatColumnClass =
  'box-border w-full max-w-(--chat-content-max) min-w-0 mx-auto px-48 desk:max-wide:px-40 max-narrow:px-24';

/** 贴底 composer 区：渐隐、高度上限与 slash 浮层裁切约束。 */
export const chatComposerStackClass =
  'relative isolate z-20 flex min-h-0 min-w-0 grow-0 shrink basis-auto max-h-(--container-composer-stack-max) flex-col overflow-visible pt-4 bg-app-bg';

/** composer 栈顶渐隐遮罩，避免 transcript 与输入区硬切。 */
export const chatComposerFadeClass =
  'pointer-events-none absolute inset-x-0 -top-56 z-0 h-56 bg-composer-fade';

/** 贴底区内可滚动的决策/队列面板。 */
export const chatDecisionPanelClass =
  'relative z-1 pointer-events-auto min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-gutter-stable';

/** 贴底区直接子项需压在渐隐层之上。 */
export const chatComposerStackChildClass = 'relative z-1 pointer-events-auto';
