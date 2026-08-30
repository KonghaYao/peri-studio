import { expect, test } from '@playwright/test';

function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror:${error.name}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (/favicon|resource-blobs|status of 404/.test(text)) return;
      errors.push(`console:${text}`);
    }
  });
  return errors;
}

async function injectFixtureDiff(page) {
  const injected = await page.evaluate(() => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge) return false;
    bridge.setDiffPreview({
      requestId: 'fixture-diff', repoId: 'repo-1', groupId: 'working_tree', changeId: 'c2',
      path: 'web/src/widgets/resource/ResourceWorkbench.tsx', status: 'modified', loading: false,
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
    });
    return true;
  });
  expect(injected).toBe(true);
}

test('resource workbench keeps Explorer and Source Control directly reachable', async ({ page }) => {
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
  await injectFixtureDiff(page);
  await expect(page.getByRole('region', { name: 'Git diff: web/src/widgets/resource/ResourceWorkbench.tsx, Index ↔ Working Tree' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Changes in web/src/widgets/resource/ResourceWorkbench.tsx' })).toBeVisible();
  await expect(page.getByText('const width = view() ? 300 : 46;')).toBeVisible();
  await expect(page.getByText('const width = view() ? 310 : 46;')).toBeVisible();
  await page.getByRole('button', { name: 'Close diff' }).click();
  await expect(page.getByRole('region', { name: /^Git diff:/ })).toHaveCount(0);
  const previewInjected = await page.evaluate(() => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge) return false;
    bridge.setFilePreview({
      requestId: 'browser-file', path: 'src/main.rs', loading: false, mode: 'text',
      contentType: 'text/plain', size: 30,
      text: 'fn main() {\n    println!("ready");\n}\n',
    });
    return true;
  });
  expect(previewInjected).toBe(true);
  await expect(page.getByRole('region', { name: 'File preview: src/main.rs' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Contents of src/main.rs' })).toContainText('println!("ready")');
  await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close file' }).click();
  await expect(page.getByRole('region', { name: /^File preview:/ })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test('medium resource rail reopens the Explorer view', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 820 });
  await page.goto('/visual-fixture.html?scenario=resources', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Explorer' })).toBeVisible();
});

test('desktop resource expansion floats without reflowing the conversation pane', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=resources', { waitUntil: 'networkidle' });

  const pane = page.locator('.conversation-pane');
  const panel = page.locator('.resource-workbench__panel');
  const expanded = await page.evaluate(() => {
    const conversation = document.querySelector('.conversation-pane').getBoundingClientRect();
    const resources = document.querySelector('.resource-workbench__panel').getBoundingClientRect();
    return {
      conversation: { left: conversation.left, width: conversation.width },
      resources: { left: resources.left, right: resources.right },
    };
  });
  expect(expanded.resources.left).toBeGreaterThanOrEqual(expanded.conversation.left);
  expect(expanded.resources.right).toBeLessThan(expanded.conversation.left + expanded.conversation.width);

  await page.getByRole('button', { name: 'Close resource panel' }).click();
  await expect(panel).toHaveCount(0);
  await expect(pane).toHaveCSS('width', `${expanded.conversation.width}px`);

  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(panel).toBeVisible();
  const reopened = await pane.evaluate((element) => ({ left: element.getBoundingClientRect().left, width: element.getBoundingClientRect().width }));
  expect(reopened).toEqual(expanded.conversation);
});

test('mobile resource previews hand focus to the editor and restore their source rows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/visual-fixture.html?scenario=resources', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open workspace resources' }).click();
  expect(await page.evaluate(() => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge) return false;
    bridge.appendResourceEntries(30);
    return true;
  })).toBe(true);
  await page.getByRole('treeitem', { name: 'src' }).click();
  await expect(page.getByRole('treeitem', { name: 'main.rs' })).toBeVisible();
  const origin = page.getByRole('treeitem', { name: 'fixture-24.ts' });
  await origin.focus();
  const explorerScrollTop = await page.getByRole('tree', { name: 'Workspace files' }).evaluate((tree) => {
    tree.scrollTop = 100;
    tree.dispatchEvent(new Event('scroll'));
    return tree.scrollTop;
  });
  expect(explorerScrollTop).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    window.__resourceFocusHistory = [];
    document.addEventListener('focusin', (event) => {
      const target = event.target;
      if (target instanceof HTMLElement) window.__resourceFocusHistory.push(target.getAttribute('aria-label') || target.textContent?.trim() || target.tagName);
    });
  });

  const previewInjected = await page.evaluate(() => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge) return false;
    bridge.setFilePreview({
      requestId: 'mobile-file', path: 'fixtures/fixture-24.ts', loading: false, mode: 'text',
      url: '/api/resource-blobs/mobile-file', contentType: 'text/plain', size: 13,
      text: 'fn main() {}\n',
    });
    return true;
  });
  expect(previewInjected).toBe(true);

  await expect(page.getByRole('heading', { name: 'File preview: fixtures/fixture-24.ts' })).toBeFocused();
  expect(await page.evaluate(() => window.__resourceFocusHistory)).not.toContain('Open workspace resources');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Workspace resources' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'fixture-24.ts' })).toBeFocused();
  await expect(page.getByRole('treeitem', { name: 'main.rs' })).toBeVisible();
  expect(await page.getByRole('tree', { name: 'Workspace files' }).evaluate((tree) => tree.scrollTop)).toBe(explorerScrollTop);

  await page.goto('/visual-fixture.html?scenario=resources&resource=scm', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open workspace resources' }).click();
  await page.getByRole('textbox', { name: 'Commit message' }).fill('Preserve this draft across preview');
  const diffOrigin = page.getByRole('button', { name: 'Open changes for web/src/widgets/resource/ResourceWorkbench.tsx' });
  await diffOrigin.focus();
  await page.keyboard.press('Enter');
  const diffInjected = await page.evaluate(() => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge) return false;
    bridge.setDiffPreview({
      requestId: 'mobile-diff', repoId: 'repo-1', groupId: 'working_tree', changeId: 'c2',
      path: 'web/src/widgets/resource/ResourceWorkbench.tsx', status: 'modified', loading: false,
      text: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n',
    });
    return true;
  });
  expect(diffInjected).toBe(true);

  await expect(page.getByRole('heading', { name: 'Git diff: web/src/widgets/resource/ResourceWorkbench.tsx, Index ↔ Working Tree' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Workspace resources' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open changes for web/src/widgets/resource/ResourceWorkbench.tsx' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Commit message' })).toHaveValue('Preserve this draft across preview');
});

test('desktop preview falls back to its resource view when the source row is deleted', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=resources', { waitUntil: 'networkidle' });
  await page.getByRole('treeitem', { name: 'src' }).click();
  const origin = page.getByRole('treeitem', { name: 'main.rs' });
  await origin.focus();
  await page.keyboard.press('Enter');

  const fixtureReady = await page.evaluate(() => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge) return false;
    bridge.setFilePreview({
      requestId: 'deleted-origin', path: 'src/main.rs', loading: false, mode: 'text',
      contentType: 'text/plain', size: 13, text: 'fn main() {}\n',
    });
    bridge.removeResourceEntry('src/main.rs');
    return true;
  });
  expect(fixtureReady).toBe(true);
  await expect(origin).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: /^File preview:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toBeFocused();
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

  const colors = await page.locator('.elicitation-card').getByRole('button', { name: 'Next', exact: true }).evaluate((button) => {
    const style = getComputedStyle(button);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(colors).toEqual({ foreground: 'rgb(255, 255, 255)', background: 'rgb(37, 99, 235)' });
});

test('coarse pointer keeps workspace header actions at least 44px', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/visual-fixture.html?scenario=resources', { waitUntil: 'networkidle' });
  await injectFixtureDiff(page);
  const diffClose = await page.getByRole('button', { name: 'Close diff' }).boundingBox();
  expect(diffClose?.width).toBeGreaterThanOrEqual(44);
  expect(diffClose?.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Close diff' }).click();
  await page.getByRole('button', { name: 'Open workspace resources' }).click();
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

  for (const name of ['Refresh resources', 'Close resource panel', 'Refresh Explorer']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge) return false;
    bridge.setFilePreview({
      requestId: 'coarse-file', path: 'src/main.rs', loading: false, mode: 'text',
      url: '/api/resource-blobs/coarse-file', contentType: 'text/plain', size: 13,
      text: 'fn main() {}\n',
    });
    return true;
  })).toBe(true);
  for (const name of ['Close file', 'Download file']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test('resource density tokens resolve to their authored desktop heights', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=resources&resource=scm', { waitUntil: 'networkidle' });
  await injectFixtureDiff(page);
  await expect(page.locator('.resource-editor-tab')).toHaveCSS('height', '35px');
  await expect(page.locator('.resource-editor-toolbar')).toHaveCSS('height', '34px');
  await page.getByRole('button', { name: 'Close diff' }).click();
  await expect(page.locator('.resource-group-title').first()).toHaveCSS('height', '24px');
  await expect(page.locator('[class*="group/tree-file"]').first()).toHaveCSS('height', '24px');
});

test('768px resource workflow is keyboard-only and keeps a visible focus ring', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 768 });
  await page.goto('/visual-fixture.html?scenario=resources', { waitUntil: 'networkidle' });
  await page.keyboard.press('Escape');

  let reachedStatusEntry = false;
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press('Tab');
    reachedStatusEntry = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Open workspace resources');
    if (reachedStatusEntry) break;
  }
  expect(reachedStatusEntry).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Workspace resources' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toBeVisible();

  let reachedTree = false;
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab');
    reachedTree = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'treeitem');
    if (reachedTree) break;
  }
  expect(reachedTree).toBe(true);
  await expect(page.getByRole('treeitem', { name: 'src' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('treeitem', { name: 'main.rs' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge) return false;
    bridge.setFilePreview({
      requestId: 'keyboard-file', path: 'src/main.rs', loading: false, mode: 'text',
      contentType: 'text/plain', size: 13, text: 'fn main() {}\n',
    });
    return true;
  })).toBe(true);
  await expect(page.getByRole('heading', { name: 'File preview: src/main.rs' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem', { name: 'main.rs' })).toBeFocused();
});

test('forced-colors keeps keyboard focus and security boundaries visible', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.setViewportSize({ width: 768, height: 768 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    const permission = getComputedStyle(document.querySelector('.permission-request'));
    return { outline: style.outlineStyle, width: style.outlineWidth, permissionBorder: permission.borderTopStyle };
  });
  expect(focus.outline).not.toBe('none');
  expect(focus.width).not.toBe('0px');
  expect(focus.permissionBorder).not.toBe('none');
});
