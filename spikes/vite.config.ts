import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// libpg-query (emscripten) ищет libpg-query.wasm рядом со своим чанком, а Vite его не выпускает.
// В собранном бандле он запрашивает /libpg-query.wasm от корня сайта: кладём файл туда.
function libpgQueryWasm(): Plugin {
  const require = createRequire(import.meta.url);
  const file = join(dirname(require.resolve('libpg-query')), 'libpg-query.wasm');
  return {
    name: 'libpg-query-wasm',
    configureServer(server) {
      server.middlewares.use('/libpg-query.wasm', (_req, res) => {
        res.setHeader('Content-Type', 'application/wasm');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'libpg-query.wasm', source: readFileSync(file) });
    },
  };
}

export default defineConfig({
  plugins: [react(), libpgQueryWasm()],
  // PGlite тянет свои .wasm/.data: не даём его пребандлить.
  // libpg-query, наоборот, пребандлим: без этого в dev нет default-экспорта у libpg-query.js
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022' },
});
