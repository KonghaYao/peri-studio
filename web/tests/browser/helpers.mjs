import { expect } from '@playwright/test';

/**
 * Playwright 只覆盖 jsdom 测不了的装配行为：真实布局、焦点/inert、
 * 虚拟化窗口、Mermaid/KaTeX 渲染。Token 像素、组件交互与文案留在
 * vitest / css-contracts。
 */

export const DESKTOP = { width: 1280, height: 800 };
export const COMPACT = { width: 768, height: 768 };
export const PHONE = { width: 390, height: 844 };

export function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror:${error.name}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/favicon|resource-blobs|status of 404/.test(text)) return;
    errors.push(`console:${text}`);
  });
  return errors;
}

export async function gotoScenario(page, scenario, options = {}) {
  const viewport = options.viewport ?? DESKTOP;
  await page.setViewportSize(viewport);
  const params = new URLSearchParams({ scenario });
  if (options.sidebar) params.set('sidebar', options.sidebar);
  if (options.resource) params.set('resource', options.resource);
  await page.goto(`/visual-fixture.html?${params}`, { waitUntil: 'networkidle' });
}

export async function callFixture(page, method, ...args) {
  const result = await page.evaluate(([name, values]) => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge || typeof bridge[name] !== 'function') return { ok: false };
    return { ok: true, value: bridge[name](...values) };
  }, [method, args]);
  expect(result.ok, `visual fixture bridge missing ${method}`).toBe(true);
  return result.value;
}

export async function injectFixtureDiff(page, overrides = {}) {
  await callFixture(page, 'setDiffPreview', {
    requestId: 'fixture-diff',
    repoId: 'repo-1',
    groupId: 'working_tree',
    changeId: 'c2',
    path: 'web/src/widgets/resource/ResourceWorkbench.tsx',
    status: 'modified',
    loading: false,
    text: [
      'diff --git a/web/src/widgets/resource/ResourceWorkbench.tsx b/web/src/widgets/resource/ResourceWorkbench.tsx',
      '--- a/web/src/widgets/resource/ResourceWorkbench.tsx',
      '+++ b/web/src/widgets/resource/ResourceWorkbench.tsx',
      '@@ -12,3 +12,4 @@ export function ResourceWorkbench() {',
      "   const [view, setView] = createSignal<WorkbenchView>('explorer');",
      '-  const width = view() ? 300 : 46;',
      '+  const width = view() ? 310 : 46;',
      "+  const label = view() === 'scm' ? 'Source Control' : 'Explorer';",
      '   return <aside style={{ width: `${width}px` }} />;',
      '',
    ].join('\n'),
    ...overrides,
  });
}

export async function injectFilePreview(page, preview) {
  await callFixture(page, 'setFilePreview', preview);
}

export function toolRow(page, toolCallId) {
  return page.getByTestId('tool-activity-row').filter({
    has: page.locator('code.sr-only', { hasText: toolCallId }),
  });
}

export async function expandToolRow(row) {
  await row.getByTestId('tool-activity-row-expand').click();
  await expect(row.getByTestId('tool-activity-row-body')).toBeVisible();
}
