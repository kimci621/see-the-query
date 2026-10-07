import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // В vitest 5 passWithNoTests задаётся только глобально: тестов content нет до Ф8
      passWithNoTests: true,
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: [
              'src/features/{db,sql,tracer,errors,overlay}/**/*.test.ts',
              'tests/tracer/**/*.test.ts',
              'plugins/**/*.test.ts',
              'tests/unit/**/*.test.ts',
            ],
          },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            include: [
              'src/**/*.test.tsx',
              'src/stores/**/*.test.ts',
              'src/features/{shell,lessons}/**/*.test.ts',
            ],
            setupFiles: ['src/test/setup-dom.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'content',
            environment: 'node',
            include: ['tests/content/**/*.test.ts'],
          },
        },
      ],
    },
  }),
);
