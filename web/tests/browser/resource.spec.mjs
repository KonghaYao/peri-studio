import { expect, test } from '@playwright/test';
import {
  COMPACT,
  PHONE,
  callFixture,
  collectBrowserErrors,
  gotoScenario,
  injectFilePreview,
  injectFixtureDiff,
} from './helpers.mjs';

test('resource workbench reaches Explorer, Source Control, diff and file preview', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await gotoScenario(page, 'resources');

  await expect(page.getByRole('tree', { name: 'Workspace files' })).toBeVisible();
  await page.getByRole('treeitem', { name: 'src' }).click();
  await expect(page.getByRole('treeitem', { name: 'main.rs' })).toBeVisible();
  await page.getByRole('button', { name: 'Source Control' }).click();
  await expect(page.getByText('Staged Changes')).toBeVisible();
  await expect(page.getByText('Untracked Changes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unstage server/src/control/resource_service.rs' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Stage web/src/entities/resource/resource-view.ts' })).toBeAttached();
  await injectFixtureDiff(page);
  await expect(page.getByRole('region', { name: 'Git diff: web/src/widgets/resource/ResourceWorkbench.tsx, Index ↔ Working Tree' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Contents of web/src/widgets/resource/ResourceWorkbench.tsx' })).toBeVisible();
  await expect(page.getByText('const width = view() ? 300 : 46;')).toBeVisible();
  await expect(page.getByText('const width = view() ? 310 : 46;')).toBeVisible();
  await page.getByRole('button', { name: 'Close diff' }).click();
  await expect(page.getByRole('region', { name: /^Git diff:/ })).toHaveCount(0);

  await injectFilePreview(page, {
    requestId: 'browser-file',
    path: 'src/main.rs',
    loading: false,
    mode: 'text',
    contentType: 'text/plain',
    size: 30,
    text: 'fn main() {\n    println!("ready");\n}\n',
  });
  await expect(page.getByRole('region', { name: 'File preview: src/main.rs' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Contents of src/main.rs' })).toContainText('println!("ready")');
  await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close file preview' }).click();
  await expect(page.getByRole('region', { name: /^File preview:/ })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test('desktop resource expansion floats without reflowing the conversation pane', async ({ page }) => {
  await gotoScenario(page, 'resources');
  const pane = page.getByTestId('conversation-pane');
  const panel = page.getByTestId('resource-workbench-panel');
  const expanded = await page.evaluate(() => {
    const conversation = document.querySelector('[data-testid="conversation-pane"]').getBoundingClientRect();
    const resources = document.querySelector('[data-testid="resource-workbench-panel"]').getBoundingClientRect();
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
  const reopened = await pane.evaluate((element) => ({
    left: element.getBoundingClientRect().left,
    width: element.getBoundingClientRect().width,
  }));
  expect(reopened).toEqual(expanded.conversation);
});

test('mobile resource previews restore focus and drafts to their source rows', async ({ page }) => {
  await gotoScenario(page, 'resources', { viewport: PHONE });
  await page.getByRole('button', { name: 'Open workspace resources' }).click();
  await callFixture(page, 'appendResourceEntries', 30);
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
      if (target instanceof HTMLElement) {
        window.__resourceFocusHistory.push(target.getAttribute('aria-label') || target.textContent?.trim() || target.tagName);
      }
    });
  });

  await injectFilePreview(page, {
    requestId: 'mobile-file',
    path: 'fixtures/fixture-24.ts',
    loading: false,
    mode: 'text',
    url: '/api/resource-blobs/mobile-file',
    contentType: 'text/plain',
    size: 13,
    text: 'fn main() {}\n',
  });

  await expect(page.getByRole('region', { name: 'File preview: fixtures/fixture-24.ts' })).toBeVisible();
  expect(await page.evaluate(() => window.__resourceFocusHistory)).not.toContain('Open workspace resources');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Workspace resources' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'fixture-24.ts' })).toBeFocused();
  await expect(page.getByRole('treeitem', { name: 'main.rs' })).toBeVisible();
  expect(await page.getByRole('tree', { name: 'Workspace files' }).evaluate((tree) => tree.scrollTop)).toBe(explorerScrollTop);

  await gotoScenario(page, 'resources', { viewport: PHONE, resource: 'scm' });
  await page.getByRole('button', { name: 'Open workspace resources' }).click();
  await page.getByRole('textbox', { name: 'Commit message' }).fill('Preserve this draft across preview');
  const diffOrigin = page.getByRole('button', { name: 'Open changes for web/src/widgets/resource/ResourceWorkbench.tsx' });
  await diffOrigin.focus();
  await page.keyboard.press('Enter');
  await injectFixtureDiff(page, {
    requestId: 'mobile-diff',
    text: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n',
  });

  await expect(page.getByRole('region', { name: /^Git diff:/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Workspace resources' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open changes for web/src/widgets/resource/ResourceWorkbench.tsx' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Commit message' })).toHaveValue('Preserve this draft across preview');
});

test('desktop preview falls back to its resource view when the source row is deleted', async ({ page }) => {
  await gotoScenario(page, 'resources');
  await page.getByRole('treeitem', { name: 'src' }).click();
  await page.getByRole('treeitem', { name: 'main.rs' }).focus();
  await page.keyboard.press('Enter');

  const fixtureReady = await page.evaluate(() => {
    const bridge = window.__PERI_VISUAL_FIXTURE__;
    if (!bridge) return false;
    bridge.setFilePreview({
      requestId: 'deleted-origin',
      path: 'src/main.rs',
      loading: false,
      mode: 'text',
      contentType: 'text/plain',
      size: 13,
      text: 'fn main() {}\n',
    });
    bridge.removeResourceEntry('src/main.rs');
    return bridge.hasResourceEntry('src/main.rs') === false;
  });
  expect(fixtureReady).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem', { name: 'main.rs' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /^File preview:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toBeVisible();
});

test('compact resource workflow is keyboard-only and keeps a visible focus ring', async ({ page }) => {
  await gotoScenario(page, 'resources', { viewport: COMPACT });
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
  await injectFilePreview(page, {
    requestId: 'keyboard-file',
    path: 'src/main.rs',
    loading: false,
    mode: 'text',
    contentType: 'text/plain',
    size: 13,
    text: 'fn main() {}\n',
  });
  await expect(page.getByRole('region', { name: 'File preview: src/main.rs' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem', { name: 'main.rs' })).toBeFocused();
});

test('coarse pointer keeps workspace header actions at least 44px', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await gotoScenario(page, 'resources', { viewport: PHONE });
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
  await injectFilePreview(page, {
    requestId: 'coarse-file',
    path: 'src/main.rs',
    loading: false,
    mode: 'text',
    url: '/api/resource-blobs/coarse-file',
    contentType: 'text/plain',
    size: 13,
    text: 'fn main() {}\n',
  });
  for (const name of ['Close file preview', 'Download file']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test('explorer dragover prevents browser navigation while uploads are blocked', async ({ page }) => {
  await gotoScenario(page, 'resources');
  const result = await page.getByRole('tree', { name: 'Workspace files' }).evaluate((tree) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['browser fixture'], 'browser-upload.txt', { type: 'text/plain' }));
    const event = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
    const dispatched = tree.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, dispatched };
  });
  expect(result).toEqual({ defaultPrevented: true, dispatched: false });
  await expect(page.getByTestId('resource-workbench-panel').getByRole('alert')).toContainText('Connect to the server before uploading files.');
});
