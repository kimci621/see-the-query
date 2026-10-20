import { defineConfig, devices } from '@playwright/test';

// Замер fps идёт на прод-сборке: dev-React при CPU ×4 сам съедает кадры (P8.9)
const PERF = Boolean(process.env.PERF);
// E2E_PORT: свой порт для параллельного прогона из другого дерева, иначе reuseExistingServer возьмёт чужой сервер (P8.110)
const PORT = Number(process.env.E2E_PORT) || (PERF ? 5198 : 5199);

export default defineConfig({
  testDir: 'tests/e2e',
  // Замер fps только по флагу: pnpm e2e:perf
  grepInvert: PERF ? undefined : /@perf/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // трейсинг снимает DOM на каждое действие (и на каждый mouse.wheel): в замере fps он мерил бы себя
    trace: PERF ? 'off' : 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: PERF
      ? `pnpm build && pnpm exec vite preview --port ${PORT} --strictPort`
      : `pnpm dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // dev-сервер без HMR: правки в дереве не перезапускают модули посреди теста (vite.config.ts)
    env: { E2E: '1' },
    reuseExistingServer: !process.env.CI,
    timeout: PERF ? 180_000 : 60_000,
  },
});
