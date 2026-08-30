import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'line',
  outputDir: 'test-results/playwright',
  use: {
    ...devices['Desktop Chrome'],
    ...(process.env.CI ? {} : { channel: 'chrome' }),
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun run visual:dev -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/visual-fixture.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
