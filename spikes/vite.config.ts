import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // PGlite и libpg-query тянут свои .wasm: не даём esbuild их пребандлить
  optimizeDeps: { exclude: ['@electric-sql/pglite', 'libpg-query'] },
  worker: { format: 'es' },
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022' },
});
