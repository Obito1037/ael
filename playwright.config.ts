import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:1421';
const address = new URL(baseURL);
if (!['127.0.0.1', 'localhost'].includes(address.hostname)) {
  throw new Error('E2E_BASE_URL must use a local mock preview server.');
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 1,
  // First load compiles every lazy view on the Vite dev server; 5s is not enough on a cold start.
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: `npm run dev -- --host ${address.hostname} --port ${address.port || '80'}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
