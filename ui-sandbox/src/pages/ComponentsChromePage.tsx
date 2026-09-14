import { ComponentCatalogExtrasShell } from '@/pages/ComponentCatalogExtrasShell';
import { TierHeader } from '@/pages/shared/DemoSection';

const CHROME_SECTIONS = ['app-chrome'] as const;

/** T4 · 应用级 chrome：页头、命令面板与快捷键。 */
export function ComponentsChromePage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Comp · Chrome"
        title="App chrome"
        description="Page header、command palette 与 shortcuts（自 peri-fuse layout 抽象）。"
      />
      <ComponentCatalogExtrasShell sections={[...CHROME_SECTIONS]} />
    </div>
  );
}
