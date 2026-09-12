import { expect, test } from '@playwright/test';
import { callFixture, expandToolRow, gotoScenario, toolRow } from './helpers.mjs';

test.describe('tool-call evidence in the assembled transcript', () => {
  test.beforeEach(async ({ page }) => {
    await gotoScenario(page, 'tools', { viewport: { width: 1280, height: 900 } });
    await callFixture(page, 'setToolAcceptancePhase', 'semantic');
  });

  test('collapsed cards do not eagerly mount evidence', async ({ page }) => {
    const bash = toolRow(page, 'acceptance-bash');
    await expect(bash).toBeVisible();
    await expect(bash.getByTestId('tool-activity-row-body')).toHaveCount(0);

    await expandToolRow(bash);
    await expect(bash.getByTestId('tool-activity-row-body').getByText('bash-input-sentinel')).toBeVisible();
    await expect(bash.getByText(/bash stdout sentinel/)).toBeVisible();
    await expect(bash.getByText(/bash stderr sentinel/)).toBeVisible();
    await expect(bash).toContainText(/"exitCode": 7/);
  });

  test('Browser, MCP and Open stay generic evidence rather than fake file reads', async ({ page }) => {
    for (const id of ['acceptance-browser', 'acceptance-mcp', 'acceptance-open']) {
      const row = toolRow(page, id);
      await expandToolRow(row);
      await expect(row.getByText('Input', { exact: true })).toBeVisible();
      await expect(row.getByText('Output', { exact: true })).toBeVisible();
      await expect(row.getByText('File', { exact: true })).toHaveCount(0);
      await expect(row.getByText('Content', { exact: true })).toHaveCount(0);
    }
    await expect(toolRow(page, 'acceptance-browser')).toContainText('browser result sentinel');
    await expect(toolRow(page, 'acceptance-browser')).toContainText('official content sentinel');
    await expect(toolRow(page, 'acceptance-browser')).toContainText('docs/protocol.md');
    await expect(toolRow(page, 'acceptance-mcp')).toContainText('mcp result sentinel');
    await expect(toolRow(page, 'acceptance-open')).toContainText('open result sentinel');
  });

  test('Bash, Read, Edit and Write keep distinguishing input and output evidence', async ({ page }) => {
    const bash = toolRow(page, 'acceptance-bash');
    await expandToolRow(bash);
    await expect(bash.getByText('Command', { exact: true })).toBeVisible();
    await expect(bash.getByText('Output', { exact: true })).toBeVisible();
    await expect(bash).toContainText('printf bash-input-sentinel');
    await expect(bash).toContainText('bash stderr sentinel');

    const read = toolRow(page, 'acceptance-read');
    await expandToolRow(read);
    await expect(read).toContainText('read-sentinel.ts');
    await expect(read).toContainText('read content sentinel');

    const edit = toolRow(page, 'acceptance-edit');
    await expandToolRow(edit);
    await expect(edit).toContainText('before sentinel');
    await expect(edit).toContainText('edit result sentinel');

    const write = toolRow(page, 'acceptance-write');
    await expandToolRow(write);
    await expect(write).toContainText('write input sentinel');
    await expect(write).toContainText('write result sentinel');
  });
});
