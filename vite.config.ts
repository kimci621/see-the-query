import { fileURLToPath, URL } from 'node:url';
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { defineConfig } from 'vite';
import { lessonsMeta } from './plugins/lessons-meta.ts';
import { rehypeCodeMeta } from './src/features/lessons/mdx/rehype-code-meta.ts';

export default defineConfig({
  plugins: [
    lessonsMeta(),
    {
      enforce: 'pre',
      ...mdx({ remarkPlugins: [remarkFrontmatter, remarkGfm], rehypePlugins: [rehypeCodeMeta] }),
    },
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@content': fileURLToPath(new URL('./content', import.meta.url)),
    },
  },
  worker: { format: 'es' },
});
