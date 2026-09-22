import { defineConfig, devices } from '@playwright/test';

// The e2e suite drives the app against the in-memory mock Drive
// (`?mock=1`), so it needs no Google credentials and no network. The mock
// exposes a control surface on `window.__mockDrive` that lets a test create
// remote revisions the way another editor would.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
