import { expect, test } from '@playwright/test';

function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror:${error.name}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  return errors;
}

test('resource workbench matches Explorer and Source Control interaction contracts', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=resources', { waitUntil: 'networkidle' });

  await expect(page.getByRole('tree', { name: 'Workspace files' })).toBeVisible();
  await page.getByRole('treeitem', { name: 'src' }).click();
  await expect(page.getByRole('treeitem', { name: 'main.rs' })).toBeVisible();
  await page.getByRole('button', { name: 'Source Control' }).click();
  await expect(page.getByText('STAGED CHANGES')).toBeVisible();
  await expect(page.getByText('UNTRACKED CHANGES')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unstage server/src/control/resource_service.rs' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Stage web/src/panel/lib/resource-view.ts' })).toBeAttached();
  await expect(page.getByRole('region', { name: 'Git diff preview' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Changes in web/src/panel/components/ResourceWorkbench.tsx' })).toBeVisible();
  await expect(page.getByText('const width = view() ? 300 : 46;')).toBeVisible();
  await expect(page.getByText('const width = view() ? 310 : 46;')).toBeVisible();
  await page.getByRole('button', { name: 'Close diff' }).click();
  await expect(page.getByRole('region', { name: 'Git diff preview' })).toHaveCount(0);
  const previewInjected = await page.evaluate(() => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge) return false;
    bridge.setFilePreview({
      requestId: 'browser-file', path: 'src/main.rs', loading: false, mode: 'text',
      url: '/api/resource-blobs/browser-file', contentType: 'text/plain', size: 30,
      text: 'fn main() {\n    println!("ready");\n}\n',
    });
    return true;
  });
  expect(previewInjected).toBe(true);
  await expect(page.getByRole('region', { name: 'File preview' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Contents of src/main.rs' })).toContainText('println!("ready")');
  await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close file' }).click();
  await expect(page.getByRole('region', { name: 'File preview' })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test('medium status entry reopens the Explorer view', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 820 });
  await page.goto('/visual-fixture.html?scenario=resources', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Open workspace resources' }).click();
  await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Explorer' })).toBeVisible();
});

test('short mobile launch layout keeps prompt and composer separated', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 430 });
  await page.goto('/visual-fixture.html?scenario=catalog', { waitUntil: 'networkidle' });
  const geometry = await page.evaluate(() => {
    const prompt = document.querySelector('.launch-prompt').getBoundingClientRect();
    const composer = document.querySelector('.launch-composer').getBoundingClientRect();
    return { promptBottom: prompt.bottom, composerTop: composer.top, pageWidth: document.documentElement.scrollWidth };
  });
  expect(geometry.promptBottom).toBeLessThanOrEqual(geometry.composerTop);
  expect(geometry.pageWidth).toBeLessThanOrEqual(390);
});

test('primary action labels retain readable contrast', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/visual-fixture.html?scenario=elicitation', { waitUntil: 'networkidle' });

  const colors = await page.getByRole('button', { name: 'Continue' }).evaluate((button) => {
    const style = getComputedStyle(button);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(colors).toEqual({ foreground: 'rgb(255, 255, 255)', background: 'rgb(36, 36, 34)' });
});

test('coarse pointer keeps workspace header actions at least 44px', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/visual-fixture.html?scenario=resources', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open workspace resources' }).click();
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

  for (const name of ['Refresh resources', 'Close resource panel', 'Refresh Explorer']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});
