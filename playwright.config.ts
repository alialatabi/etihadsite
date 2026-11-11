import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests. Runs against a local `next dev` server on port 3199
 * with console transport and an isolated data directory.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3199',
    locale: 'ar-IQ',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: 'pnpm dev -p 3199',
    url: 'http://localhost:3199',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      DATA_DIR: './data-e2e',
      ORDER_TRANSPORT: 'console',
      ADMIN_PASSWORD: 'e2e-password',
      SESSION_SECRET: 'e2e-session-secret-e2e-session-secret-1234',
    },
  },
});
