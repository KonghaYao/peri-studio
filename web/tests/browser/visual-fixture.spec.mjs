import { expect, test } from '@playwright/test';
import { assertVisualContract, visualContract } from '../../scripts/visual-contract.mjs';

const scenarios = [
  ['catalog', { projects: 2, sessions: 4 }],
  ['conversation', { messages: 4, markdown: true }],
  ['permission-streaming', { permissions: 1, permissionQueueLabel: 'Pending permission requests, 2 total' }],
  ['terminal-readonly', { readonly: true }],
];
const viewports = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror:${error.name}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  return errors;
}

for (const [scenario, expected] of scenarios) {
  for (const viewport of viewports) {
    test(`${scenario} satisfies the browser contract at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      const browserErrors = collectBrowserErrors(page);
      await page.setViewportSize(viewport);
      await page.goto(`/visual-fixture.html?scenario=${scenario}`, { waitUntil: 'networkidle' });
      const facts = await page.evaluate(visualContract);
      expect(() => assertVisualContract(facts)).not.toThrow();
      expect(facts.viewport).toEqual([viewport.width, viewport.height]);
      if (viewport.width >= 960) {
        expect(facts.projectCount).toBeGreaterThanOrEqual(expected.projects ?? 1);
        expect(facts.sessionCount).toBeGreaterThanOrEqual(expected.sessions ?? 1);
      }
      if (expected.messages) expect(facts.messageCount).toBe(expected.messages);
      if (expected.markdown) expect(facts.markdown).toMatchObject({ headings: 1, lists: 1, codeBlocks: 1 });
      if (expected.permissions) expect(facts.permissionCount).toBe(expected.permissions);
      if (expected.permissionQueueLabel) expect(facts.permissionQueueLabel).toBe(expected.permissionQueueLabel);
      if (expected.readonly && viewport.width >= 960) expect(facts.readonly).toBe(true);
      expect(browserErrors).toEqual([]);
    });
  }
}

test('wide dialog owns its viewport width without child overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'System', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'System' });
  await expect(dialog).toBeVisible();
  const geometry = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    width: element.getBoundingClientRect().width,
  }));
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.width).toBeGreaterThan(500);
  expect(geometry.width).toBeLessThanOrEqual(560);
});

test('mobile drawer and nested dialog preserve inertness, focus and viewport geometry', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  const openNavigation = page.getByRole('button', { name: 'Open navigation' });
  await openNavigation.click();
  const drawer = page.getByRole('dialog', { name: 'Projects & Sessions' });
  await expect(drawer).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('aria-hidden');
  const newProject = drawer.getByRole('button', { name: 'New project' });
  await newProject.click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('aria-hidden');
  await expect(dialog.getByPlaceholder('perihelion')).toBeFocused();
  const backdrop = await page.locator('.ui-dialog-backdrop').last().boundingBox();
  expect(backdrop).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(drawer).toContainText('New project');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(openNavigation).toBeVisible();
  expect(browserErrors).toEqual([]);
});
