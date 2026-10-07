import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'pnpm build && pnpm preview', url: 'http://localhost:4173', timeout: 120_000, reuseExistingServer: true },
});
