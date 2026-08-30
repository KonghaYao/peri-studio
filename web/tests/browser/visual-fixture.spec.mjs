import { expect, test } from '@playwright/test';
import { assertVisualContract, visualContract } from '../../scripts/visual-contract.mjs';

const scenarios = [
  ['catalog', { projects: 2, sessions: 4 }],
  ['conversation', { messages: 2 }],
  ['resources', { projects: 2, sessions: 4 }],
  ['markdown', { messages: 1 }],
  ['permission-streaming', { permissions: 1, permissionQueueLabel: 'Pending permission requests, 2 total' }],
  ['terminal-readonly', { readonly: true }],
];
const viewports = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 768 },
  { width: 390, height: 844 },
];

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

test('markdown lab renders rich content without eager network media', async ({ page }) => {
  const requested = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/visual-fixture.html?scenario=markdown', { waitUntil: 'networkidle' });

  await expect(page.locator('.markdown-body table')).toHaveCount(1);
  await expect(page.locator('.markdown-body .katex')).toHaveCount(2);
  await expect(page.locator('.md-code-block[data-highlighted=true]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Load image: Architecture' })).toBeVisible();
  expect(requested.some((url) => url.includes('architecture.png'))).toBe(false);

  await expect(page.locator('.md-mermaid__result svg[aria-roledescription]')).toBeVisible();
  await expect(page.locator('.md-mermaid__result script, .md-mermaid__result foreignObject')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy SVG' })).toBeVisible();
  await expect(page.locator('.md-mermaid pre')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show source' }).click();
  await expect(page.locator('.md-mermaid pre')).toContainText('flowchart LR');
  await expect(page.locator('.md-mermaid').getByRole('button', { name: 'Copy code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open diagram' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show diagram' }).click();
  await expect(page.locator('.md-mermaid__result svg[aria-roledescription]')).toBeVisible();
  await page.getByRole('button', { name: 'Open diagram' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Diagram' })).toBeVisible();
  await page.keyboard.press('Escape');

  const geometry = await page.locator('.markdown-body').evaluate((body) => ({
    width: body.getBoundingClientRect().width,
    tableWidth: body.querySelector('.md-table').getBoundingClientRect().width,
    tableViewportWidth: body.querySelector('.md-table > div:last-child').clientWidth,
    tableContentWidth: body.querySelector('.md-table table').getBoundingClientRect().width,
    codeWidth: body.querySelector('.md-code-block').getBoundingClientRect().width,
    scrollWidth: body.scrollWidth,
  }));
  expect(geometry.tableWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.tableContentWidth).toBeLessThanOrEqual(geometry.tableViewportWidth + 1);
  expect(geometry.codeWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
});

test('markdown conversation uses the available desktop content track', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/visual-fixture.html?scenario=markdown', { waitUntil: 'networkidle' });

  const geometry = await page.evaluate(() => {
    const markdown = document.querySelector('.markdown-body');
    const track = markdown.closest('.message-list-content');
    const viewport = track.parentElement;
    const trackRect = track.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const trackStyle = getComputedStyle(track);
    return {
      markdownWidth: markdown.getBoundingClientRect().width,
      trackInnerWidth: track.clientWidth
        - Number.parseFloat(trackStyle.paddingLeft)
        - Number.parseFloat(trackStyle.paddingRight),
      leftGap: trackRect.left - viewportRect.left,
      rightGap: viewportRect.left + viewport.clientWidth - trackRect.right,
    };
  });
  expect(geometry.markdownWidth).toBeGreaterThanOrEqual(geometry.trackInnerWidth - 1);
  expect(geometry.trackInnerWidth).toBeLessThanOrEqual(820);
  expect(Math.abs(geometry.leftGap - geometry.rightGap)).toBeLessThanOrEqual(1);
});

test('markdown keeps a readable vertical rhythm across rich blocks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/visual-fixture.html?scenario=markdown', { waitUntil: 'networkidle' });

  const rhythm = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      paragraph: [style('.markdown-body p').lineHeight, style('.markdown-body p').marginBottom],
      heading: [style('.markdown-body h1').marginTop, style('.markdown-body h1').marginBottom],
      list: style('.markdown-body ul').marginBottom,
      quote: style('.markdown-body blockquote').marginBlock,
      table: style('.markdown-body .md-table').marginBlock,
      code: style('.markdown-body .md-code-block').marginBlock,
      math: style('.markdown-body .md-math--block').marginBlock,
      imageConsent: style('.markdown-body .md-image-consent').marginBlock,
    };
  });
  expect(rhythm).toEqual({
    paragraph: ['18.85px', '3px'],
    heading: ['0px', '10px'],
    list: '14px',
    quote: '14px',
    table: '16px',
    code: '16px',
    math: '16px',
    imageConsent: '16px',
  });
});

test('long conversation combines rich markdown, dense tool calls, and the status area', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/visual-fixture.html?scenario=long-conversation', { waitUntil: 'networkidle' });

  await expect(page.getByRole('region', { name: 'Status area' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Todo/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Async/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Changes/ })).toBeVisible();
  await page.getByRole('tab', { name: /Async/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Agent');
  // The transcript window may retain one neighboring row as measured heights
  // settle; assert density rather than coupling acceptance to overscan internals.
  expect(await page.locator('.tool-activity-row').count()).toBeGreaterThanOrEqual(8);
  await expect(page.locator('.markdown-body table').first()).toBeVisible();
  await expect(page.locator('.markdown-body pre').first()).toBeVisible();
  await expect(page.locator('.workbench-status-bar')).toHaveCount(0);
});

test('assistant actions stay contextual and tool rows have no divider', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/visual-fixture.html?scenario=long-conversation', { waitUntil: 'networkidle' });

  const message = page.getByRole('article', { name: 'Assistant message' }).first();
  const actions = message.locator('.conversation-message__actions');
  expect(await actions.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
  expect(await actions.evaluate((element) => getComputedStyle(element).position)).toBe('absolute');
  const layout = await message.evaluate((element) => ({
    messageHeight: element.getBoundingClientRect().height,
    surfaceHeight: element.querySelector('.conversation-message__surface').getBoundingClientRect().height,
  }));
  expect(Math.abs(layout.messageHeight - layout.surfaceHeight)).toBeLessThanOrEqual(1);
  await actions.getByRole('button', { name: 'Copy answer' }).focus();
  await expect(actions).toHaveCSS('opacity', '1');
  expect(await page.evaluate(() => [...document.styleSheets].some((sheet) => {
    try { return [...sheet.cssRules].some((rule) => rule.cssText.includes('.conversation-message--assistant:hover')); }
    catch { return false; }
  }))).toBe(true);
  await expect(message.locator('.tool-activity-row').first()).toHaveCSS('border-bottom-width', '0px');
});

test('slash surface uses the shared overlay radius', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: 'Message the agent' }).fill('/');
  await expect(page.locator('.slash-menu')).toBeVisible();
  await expect(page.locator('.slash-menu')).toHaveCSS('border-radius', '12px');
});

test('chat controls live in global workspace surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Conversation actions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'MCP' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close running instance' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'System information' })).toBeVisible();
});

test('assets scenario stages visual references above the composer input', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=assets', { waitUntil: 'networkidle' });

  const assets = page.getByLabel('Staged assets');
  await expect(assets).toBeVisible();
  await expect(assets.locator('article')).toHaveCount(3);
  await expect(assets.locator('article').first()).toHaveCSS('width', '68px');
  await expect(assets.locator('article').first()).toHaveCSS('height', '68px');
  await expect(assets).toContainText('chat-layout-reference-final.png');
  await expect(assets).toContainText('status-area.md');
  await expect(assets.locator('img')).toHaveCount(1);
  await page.getByRole('button', { name: /Remove chat-layout-reference-final\.png/ }).click();
  await expect(assets.locator('article')).toHaveCount(2);
});

test('subtasks identify agent and workflow task sources', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=subtasks', { waitUntil: 'networkidle' });

  await page.getByRole('tab', { name: /Async/ }).click();
  const asyncTasks = page.getByRole('tabpanel');
  await expect(asyncTasks).toContainText('Agent');
  await expect(asyncTasks).toContainText('Workflow');
});

for (const scenario of ['conversation', 'permission-streaming', 'elicitation', 'markdown', 'resources', 'assets']) {
  test(`${scenario} keeps icon actions rectangular`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/visual-fixture.html?scenario=${scenario}`, { waitUntil: 'networkidle' });
    const geometry = await page.locator('[data-icon-button]:visible').evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label'), width: rect.width, height: rect.height, radius: getComputedStyle(button).borderRadius };
    }));
    expect(geometry.length).toBeGreaterThan(0);
    for (const button of geometry) {
      expect(button.width, button.label ?? 'icon action').toBeGreaterThanOrEqual(button.height);
      expect(button.radius, button.label ?? 'icon action').not.toBe('50%');
    }
  });
}

for (const [scenario, expected] of scenarios) {
  for (const viewport of viewports) {
    test(`${scenario} satisfies the browser contract at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      const browserErrors = collectBrowserErrors(page);
      const needsSidebar = expected.projects != null || expected.sessions != null;
      await page.setViewportSize(viewport);
      await page.goto(
        `/visual-fixture.html?scenario=${scenario}${needsSidebar ? '&sidebar=projects' : ''}`,
        { waitUntil: 'networkidle' },
      );
      const facts = await page.evaluate(visualContract);
      expect(() => assertVisualContract(facts)).not.toThrow();
      expect(facts.viewport).toEqual([viewport.width, viewport.height]);
      if (viewport.width >= 960) {
        if (expected.projects != null) expect(facts.projectCount).toBeGreaterThanOrEqual(expected.projects);
        if (expected.sessions != null) expect(facts.sessionCount).toBeGreaterThanOrEqual(expected.sessions);
      }
      if (expected.messages) expect(facts.messageTotal).toBe(expected.messages);
      if (expected.markdown) expect(facts.markdown).toMatchObject({ headings: 1, lists: 1, codeBlocks: 1 });
      if (expected.permissions) expect(facts.permissionCount).toBe(expected.permissions);
      if (expected.permissionQueueLabel) expect(facts.permissionQueueLabel).toBe(expected.permissionQueueLabel);
      if (expected.readonly && viewport.width >= 960) expect(facts.readonly).toBe(true);
      expect(browserErrors).toEqual([]);
    });
  }
}

test('migrated surfaces retain their authored computed borders', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=tools&sidebar=projects', { waitUntil: 'networkidle' });

  const borders = await page.evaluate(() => {
    const style = (selector) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element) : null;
    };
    return {
      sidebar: style('.project-sidebar')?.borderRightWidth,
      sessionGuide: style('.session-list')?.borderLeftWidth,
      selectedSession: style('.session-row [aria-current="page"]')?.borderLeftWidth ?? '0px',
      statusArea: style('.status-area')?.borderWidth,
      composer: style('.composer-surface')?.borderWidth,
      toolGroup: style('.tool-activity-group')?.borderWidth,
    };
  });

  expect(borders).toEqual({
    sidebar: '1px',
    sessionGuide: '0px',
    selectedSession: '0px',
    statusArea: '0px',
    composer: '1px',
    toolGroup: '1px',
  });
});

test('runtime status stays compact while recovery labels disclose trust', async ({ page }) => {
  await page.setViewportSize({ width: 631, height: 800 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });
  await expect(page.locator('.runtime-status')).toHaveCount(0);
  await expect(page.locator('.connection-pill')).toHaveText('Online');
  await expect(page.locator('.connection-pill .ui-status__label')).toHaveClass(/sr-only/);

  await page.goto('/visual-fixture.html?scenario=terminal-readonly', { waitUntil: 'networkidle' });
  await expect(page.locator('.runtime-status')).toHaveText('Crashed');
  const boundaries = await page.locator('.history-boundary > span').allTextContents();
  expect(boundaries).toContain('Verified history');
  expect(boundaries.every((label) => /^(?:Verified|Unverified) history$/.test(label))).toBe(true);
  const boundaryGap = await page.locator('.history-boundary').first().evaluate((element) => {
    const message = element.nextElementSibling;
    return message.getBoundingClientRect().top - element.getBoundingClientRect().bottom;
  });
  expect(boundaryGap).toBeLessThanOrEqual(4);

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toContain('Run exited abnormally');
  expect(visibleText).not.toContain('Peri-verified recovered history');
  expect(visibleText).not.toContain('Recovered');
  expect(visibleText).not.toContain('Local server connected');
});

test('token usage is a quiet graphic and scrollbars share one global style', async ({ page }) => {
  await page.setViewportSize({ width: 631, height: 800 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });

  const usage = page.locator('.composer-usage');
  await expect(usage).toHaveAttribute('aria-label', /Context usage.*Input 12,400.*Output 860.*Cached 9,800/);
  await expect(usage).toHaveText('');
  await usage.hover();
  await expect(page.getByText('Latest request')).toBeVisible();
  await expect(page.getByText('Input', { exact: true })).toBeVisible();
  await expect(page.getByText('Output', { exact: true })).toBeVisible();
  await expect(page.getByText('Cached', { exact: true })).toBeVisible();

  const geometry = await usage.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    opacity: getComputedStyle(element).opacity,
  }));
  expect(geometry.width).toBeLessThanOrEqual(28);
  expect(geometry.height).toBeLessThanOrEqual(28);
  expect(Number(geometry.opacity)).toBeLessThanOrEqual(1);

  const scrollbar = await page.locator('.message-list-scroll').evaluate((element) => ({
    color: getComputedStyle(element).scrollbarColor,
    width: getComputedStyle(element, '::-webkit-scrollbar').width,
  }));
  expect(scrollbar.color).not.toBe('transparent transparent');
  expect(scrollbar.width).toBe('6px');
});

test('sidebar chrome and composer match the compact input shell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });

  await expect(page.locator('.window-toolbar > span.rounded-full')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add attachment' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Approval mode' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Voice input' })).toBeDisabled();
  await expect(page.locator('.composer-runtime')).toBeVisible();
  await expect(page.getByRole('button', { name: /Browse skills/ })).toBeVisible();
  await expect(page.locator('.composer-action')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const surface = document.querySelector('.composer-surface');
    const input = document.querySelector('.composer-input');
    const toolbar = document.querySelector('.composer-toolbar');
    return {
      surfaceHeight: surface.getBoundingClientRect().height,
      inputHeight: input.getBoundingClientRect().height,
      radius: getComputedStyle(surface).borderRadius,
      toolbarBorder: getComputedStyle(toolbar).borderTopWidth,
      overflowingIcons: [...toolbar.querySelectorAll('button svg')].filter((icon) => {
        const iconBox = icon.getBoundingClientRect();
        const buttonBox = icon.closest('button').getBoundingClientRect();
        return iconBox.left < buttonBox.left
          || iconBox.right > buttonBox.right
          || iconBox.top < buttonBox.top
          || iconBox.bottom > buttonBox.bottom;
      }).length,
    };
  });

  expect(geometry.surfaceHeight).toBeLessThanOrEqual(112);
  expect(geometry.inputHeight).toBeLessThanOrEqual(64);
  expect(geometry.radius).toBe('12px');
  expect(geometry.toolbarBorder).toBe('0px');
  expect(geometry.overflowingIcons).toBe(0);
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 768, height: 768 }, { width: 390, height: 844 }]) {
  test(`conversation body keeps a centered reading inset at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });

    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), height: Math.round(box.height) };
      };
      return {
        message: rect('.conversation-message--assistant'),
        permission: rect('.permission-queue__surface'),
        composer: rect('.composer-surface'),
        scrollbarReserve: document.querySelector('.message-list-scroll').offsetWidth
          - document.querySelector('.message-list-scroll').clientWidth,
      };
    });

    expect(geometry.permission.left).toBe(geometry.composer.left);
    expect(geometry.permission.right).toBe(geometry.composer.right);
    const leftInset = geometry.message.left - geometry.composer.left;
    const rightInset = geometry.composer.right - geometry.message.right;
    expect(leftInset).toBeGreaterThanOrEqual(0);
    expect(rightInset).toBeGreaterThanOrEqual(0);
    expect(Math.abs(leftInset - rightInset)).toBeLessThanOrEqual(geometry.scrollbarReserve + 1);
    expect(leftInset).toBeLessThanOrEqual(56);
    await expect(page.locator('.elicitation-card')).toHaveCount(0);
  });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`question surface stays compact and aligned at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/visual-fixture.html?scenario=elicitation', { waitUntil: 'networkidle' });

    const card = page.locator('.elicitation-card');
    await expect(card).toBeVisible();
    await expect(card.getByText('Questions', { exact: true })).toBeVisible();
    await expect(card.getByText('1 / 2')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Previous question' })).toBeDisabled();
    await card.getByRole('button', { name: 'Next question' }).click();
    await expect(card.getByText('Which release scope should this change use?')).toBeVisible();
    await expect(card.getByText('2 / 2')).toBeVisible();
    await card.getByRole('button', { name: 'Previous question' }).click();
    await expect(card.getByText('How should we proceed with this refactor?')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Skip' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const card = document.querySelector('.elicitation-card').getBoundingClientRect();
      const composer = document.querySelector('.composer-surface').getBoundingClientRect();
      return {
        aligned: Math.round(card.left) === Math.round(composer.left) && Math.round(card.right) === Math.round(composer.right),
        height: Math.round(card.height),
        insideViewport: card.left >= 0 && card.right <= innerWidth,
      };
    });
    expect(geometry.aligned).toBe(true);
    expect(geometry.insideViewport).toBe(true);
    expect(geometry.height).toBeLessThanOrEqual(430);
  });
}

test('sidebar sessions stay icon-free and quiet unless the selected session is loading', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation&sidebar=projects', { waitUntil: 'networkidle' });

  const workspaceRow = page.locator('#project-sessions-project-perihelion [data-session-id="acp-thread-01J5WORLDCLASSCURRENT"]');
  await expect(workspaceRow.locator('.session-copy')).toBeVisible();

  await workspaceRow.hover();
  const geometry = await workspaceRow.evaluate((row) => {
    const rect = (selector) => row.querySelector(selector)?.getBoundingClientRect();
    const copy = rect('.session-copy');
    const menu = rect('.session-menu');
    const list = row.closest('.session-list');
    return {
      copyWidth: copy?.width ?? 0,
      copyRight: copy?.right ?? 0,
      menuLeft: menu?.left ?? 0,
      titleIconCount: row.querySelectorAll('.session-copy svg, .session-copy + svg').length,
      statusCount: row.querySelectorAll('.session-loading-wave').length,
      sessionListBorder: list ? getComputedStyle(list).borderLeftWidth : '0px',
    };
  });

  expect(geometry.copyWidth).toBeGreaterThan(20);
  expect(geometry.menuLeft).toBeGreaterThan(0);
  expect(geometry.titleIconCount).toBe(0);
  expect(geometry.statusCount).toBe(0);
  expect(geometry.sessionListBorder).toBe('0px');

  await page.goto('/visual-fixture.html?scenario=long-conversation&sidebar=projects', { waitUntil: 'networkidle' });
  const busyRow = page.locator('[data-session-id="acp-thread-01J5WORLDCLASSCURRENT"]').first();
  const loading = busyRow.locator('.session-loading-wave');
  await expect(loading).toBeVisible();
  await expect(loading.locator('.session-loading-wave__core')).toBeVisible();
});

test('machine topology lives in the global system dialog without child overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation&sidebar=projects', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'System information' }).click();
  const dialog = page.getByRole('dialog', { name: 'System' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Machines' })).toHaveAttribute('aria-selected', 'true');
  const tree = dialog.getByRole('tree', { name: 'Machine topology' });
  await expect(tree).toBeVisible();
  const geometry = await tree.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    panelWidth: element.closest('[role="dialog"]').getBoundingClientRect().width,
  }));
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.panelWidth).toBeGreaterThanOrEqual(420);
  expect(geometry.panelWidth).toBeLessThanOrEqual(760);
});

test('desktop sidebar visibly resizes and preserves project navigation', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation&sidebar=projects', { waitUntil: 'networkidle' });

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

test('mobile drawer preserves instance-bound project creation semantics and nested dialog inertness', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  const openNavigation = page.getByRole('button', { name: 'Open navigation' });
  await openNavigation.click();
  const drawer = page.getByRole('dialog', { name: 'Projects & Sessions' });
  await expect(drawer).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('aria-hidden');
  const newProject = drawer.getByRole('button', { name: 'New project' });
  await expect(newProject).toBeEnabled();

  await page.keyboard.press('Meta+K');
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
