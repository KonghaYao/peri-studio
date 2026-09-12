import { ComponentCatalogExtrasF } from '@/pages/ComponentCatalogExtrasF';
import { ComponentCatalogExtrasShell } from '@/pages/ComponentCatalogExtrasShell';
import { TierHeader } from '@/pages/shared/DemoSection';

const SHELL_SECTIONS = [
  'project-sidebar',
  'session-row-accessory',
  'project-row-accessory',
  'chat-header',
  'chat-shell',
  'chat-transcript',
  'status-area',
  'terminal-dock',
] as const;

/** T4 · 产品壳层：侧栏、会话 chrome、状态区与终端。 */
export function ComponentsShellPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Comp · Shell"
        title="Shell"
        description="侧栏、会话 chrome、状态区与终端 dock。"
      />
      <ComponentCatalogExtrasShell sections={[...SHELL_SECTIONS]} />
      <ComponentCatalogExtrasF sections={[...SHELL_SECTIONS]} />
    </div>
  );
}
