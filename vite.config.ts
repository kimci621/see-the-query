import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { defineConfig, type Plugin } from 'vite';
import { lessonsMeta } from './plugins/lessons-meta.ts';
import { rehypeCodeMeta } from './src/features/lessons/mdx/rehype-code-meta.ts';

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
  plugins: [
    lessonsMeta(),
    {
      enforce: 'pre',
      ...mdx({ remarkPlugins: [remarkFrontmatter, remarkGfm], rehypePlugins: [rehypeCodeMeta] }),
    },
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
    libpgQueryWasm(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@content': fileURLToPath(new URL('./content', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  // PGlite сам грузит свои .wasm и .data: пребандлинг Vite их ломает
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
});
