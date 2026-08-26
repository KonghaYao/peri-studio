import { expect, test } from '@playwright/test';

test('conversation copy keeps compact authored line heights', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  const geometry = await page.getByRole('article', { name: 'Your message' }).first().evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    lineHeight: getComputedStyle(element.querySelector('.conversation-message__text')).lineHeight,
    composerLineHeight: getComputedStyle(document.querySelector('.composer-input')).lineHeight,
    assistantHeight: document.querySelector('.conversation-message--assistant').getBoundingClientRect().height,
  }));
  expect(geometry).toMatchObject({ lineHeight: '22px', composerLineHeight: '22px' });
  expect(geometry.height).toBeLessThan(100);
  expect(geometry.assistantHeight).toBeLessThan(800);
});

test('intervention actions stay compact in narrow layouts', async ({ page }) => {
  const measure = () => page.evaluate(() => ['Allow once', 'Deny'].map((label) => {
    const button = document.querySelector(`.permission-request button[aria-label="${label}"]`);
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  await page.setViewportSize({ width: 631, height: 800 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });
  const desktop = await measure();
  expect(Math.max(...desktop.map(({ width }) => width))).toBeLessThan(160);
  expect(new Set(desktop.map(({ height }) => height))).toEqual(new Set([36]));
  await expect(page.locator('.elicitation-card')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(new Set((await measure()).map(({ height }) => height))).toEqual(new Set([44]));
});

test('conversation typography and permission surfaces stay dense and neutral', async ({ page }) => {
  await page.setViewportSize({ width: 631, height: 800 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });
  const facts = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      body: style('body').fontSize,
      message: [style('.conversation-message__text').fontSize, style('.conversation-message__text').lineHeight],
      button: style('.permission-request [data-slot=button]').fontSize,
      heading: style('.markdown-body h2').fontSize,
      page: style('body').backgroundColor,
      permission: style('.permission-request').backgroundColor,
      mark: style('.permission-request__mark').backgroundColor,
      text: document.body.innerText,
    };
  });
  expect(facts).toMatchObject({ body: '14px', message: ['14px', '22px'], button: '13px', heading: '17px' });
  expect(facts.permission).toBe(facts.page);
  expect(facts.mark).toBe(facts.page);
  for (const copy of ['Locks immediately once selected', 'Waiting for your permission', 'Hub observed', 'shows only redacted run summaries']) {
    expect(facts.text).not.toContain(copy);
  }
});

test('desktop chrome and focused composer retain the neutral canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  const input = page.locator('.composer-input');
  const surface = page.locator('.composer-surface');
  const resting = await surface.evaluate((element) => ({ border: getComputedStyle(element).borderColor, shadow: getComputedStyle(element).boxShadow }));
  await expect(input).toBeEnabled();
  await input.focus();
  await page.waitForTimeout(180);
  const focused = await surface.evaluate((element) => ({ border: getComputedStyle(element).borderColor, shadow: getComputedStyle(element).boxShadow }));
  expect(focused).toEqual(resting);
  await expect(page.locator('.onboarding-card')).toHaveCount(0);
  const canvas = await page.evaluate(() => ({
    page: getComputedStyle(document.body).backgroundColor,
    sidebar: getComputedStyle(document.querySelector('.project-sidebar')).backgroundColor,
    input: getComputedStyle(document.querySelector('.composer-input')).backgroundColor,
  }));
  expect(canvas.sidebar).toBe(canvas.page);
  expect(canvas.input).toBe('rgba(0, 0, 0, 0)');
});
