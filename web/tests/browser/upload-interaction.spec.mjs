import { expect, test } from '@playwright/test';

test('upload entry prevents browser navigation and exposes keyboard equivalence', async ({ page }) => {
  await page.goto('/visual-fixture.html?scenario=resources', { waitUntil: 'networkidle' });

  await expect(page.getByRole('button', { name: 'Slash commands' })).toBeVisible();
  await expect(page.locator('[data-testid="composer-upload-file-input"]')).toHaveAttribute('type', 'file');
  await expect(page.locator('[data-testid="composer-upload-file-input"]')).toHaveAttribute('multiple', '');

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
