import { expect, test } from '@playwright/test';
import { COMPACT, PHONE, collectBrowserErrors, gotoScenario } from './helpers.mjs';

test('desktop sidebar resizes and keeps project navigation intact', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await gotoScenario(page, 'conversation', { sidebar: 'projects' });

  const resize = page.getByRole('separator', { name: 'Resize sidebar' });
  await expect(resize).toHaveAttribute('aria-valuenow', '242');
  await resize.focus();
  await page.keyboard.press('End');
  await expect(resize).toHaveAttribute('aria-valuenow', '480');

  const project = page.getByRole('button', { name: 'ACP Protocol Lab', exact: true });
  const session = page.locator('#project-sessions-project-protocol-lab').getByRole('button', { name: 'Wire contract compatibility', exact: true });
  await expect(project).toHaveAttribute('aria-expanded', 'true');
  await expect(session).toBeVisible();
  await project.click();
  await expect(project).toHaveAttribute('aria-expanded', 'false');
  await expect(session).toBeHidden();
  await project.click();
  await expect(project).toHaveAttribute('aria-expanded', 'true');
  await expect(session).toBeVisible();
  await expect(resize).toHaveAttribute('aria-valuenow', '480');
  expect(browserErrors).toEqual([]);
});

test('mobile drawer keeps nested search dialogs inert and stacked', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await gotoScenario(page, 'conversation', { viewport: PHONE });
  const openNavigation = page.getByRole('button', { name: 'Open navigation' });
  await openNavigation.click();
  const drawer = page.getByRole('dialog', { name: 'Projects & Sessions' });
  await expect(drawer).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('aria-hidden');
  await expect(drawer.getByRole('button', { name: 'New project' })).toBeEnabled();

  await page.keyboard.press('Control+K');
  const dialog = page.getByRole('dialog', { name: 'Search sessions' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('aria-hidden');
  await expect(dialog.getByRole('textbox', { name: 'Search sessions' })).toBeFocused();
  const backdrop = await page.locator('[data-dialog-overlay]').last().boundingBox();
  expect(backdrop).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(openNavigation).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('system dialog opens without horizontal overflow', async ({ page }) => {
  await gotoScenario(page, 'conversation', { sidebar: 'projects' });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'System' }).click();
  const dialog = page.getByRole('dialog', { name: 'System' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Machines' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('list', { name: 'Computer list' })).toBeVisible();
  const geometry = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
});

test('permission and question surfaces stay aligned with the composer', async ({ page }) => {
  await gotoScenario(page, 'permission-streaming');
  await expect(page.getByTestId('permission-queue-surface')).toBeVisible();
  await expect(page.getByTestId('elicitation-card')).toBeVisible();
  expect(await page.evaluate((selector) => {
    const surface = document.querySelector(selector)?.getBoundingClientRect();
    const composer = document.querySelector('[data-testid="composer-surface"]')?.getBoundingClientRect();
    if (!surface || !composer) return { present: false, aligned: false, insideViewport: false };
    return {
      present: true,
      aligned: Math.abs(surface.left - composer.left) <= 8 && Math.abs(surface.right - composer.right) <= 8,
      insideViewport: surface.left >= -1 && surface.right <= innerWidth + 1,
    };
  }, '[data-testid="permission-queue-surface"]')).toMatchObject({ present: true, aligned: true });

  await gotoScenario(page, 'elicitation', { viewport: PHONE });
  await expect(page.getByTestId('elicitation-card')).toBeVisible();
  expect(await page.evaluate((selector) => {
    const surface = document.querySelector(selector)?.getBoundingClientRect();
    const composer = document.querySelector('[data-testid="composer-surface"]')?.getBoundingClientRect();
    if (!surface || !composer) return { present: false, aligned: false, insideViewport: false };
    return {
      present: true,
      aligned: Math.abs(surface.left - composer.left) <= 8 && Math.abs(surface.right - composer.right) <= 8,
      insideViewport: surface.left >= -1 && surface.right <= innerWidth + 1,
    };
  }, '[data-testid="elicitation-card"]')).toMatchObject({ present: true, aligned: true, insideViewport: true });
});

test('composer attachments can be removed from the assembled shell', async ({ page }) => {
  await gotoScenario(page, 'assets');
  await expect(page.getByRole('button', { name: 'Remove chat-layout-reference-final.png' })).toBeVisible();
  await expect(page.getByText('status-area.md', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove chat-layout-reference-final.png' }).click();
  await expect(page.getByRole('button', { name: 'Remove chat-layout-reference-final.png' })).toHaveCount(0);
  await expect(page.getByText('status-area.md', { exact: true })).toBeVisible();
});

test('short mobile launch layout keeps the centered composer in view', async ({ page }) => {
  await gotoScenario(page, 'catalog', { viewport: { width: 390, height: 430 } });
  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="chat-empty-workspace"]').getBoundingClientRect();
    const composer = document.querySelector('[data-testid="launch-composer"]').getBoundingClientRect();
    return {
      workspaceTop: workspace.top,
      composerBottom: composer.bottom,
      pageWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.workspaceTop).toBeGreaterThanOrEqual(0);
  expect(geometry.composerBottom).toBeLessThanOrEqual(430);
  expect(geometry.pageWidth).toBeLessThanOrEqual(390);
});

test('forced-colors keeps keyboard focus and permission borders visible', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await gotoScenario(page, 'permission-streaming', { viewport: COMPACT });
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    const permission = getComputedStyle(document.querySelector('[data-testid="permission-request"]'));
    return { outline: style.outlineStyle, width: style.outlineWidth, permissionBorder: permission.borderTopStyle };
  });
  expect(focus.outline).not.toBe('none');
  expect(focus.width).not.toBe('0px');
  expect(focus.permissionBorder).not.toBe('none');
});
