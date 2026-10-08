import { evaluate } from '@mdx-js/mdx';
import { createElement } from 'react';
import * as runtime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { rehypeCodeMeta } from './rehype-code-meta';

async function render(markdown: string): Promise<string> {
  const { default: Content } = await evaluate(markdown, {
    ...runtime,
    baseUrl: import.meta.url,
    rehypePlugins: [rehypeCodeMeta],
  });
  return renderToStaticMarkup(createElement(Content));
}

describe('rehypeCodeMeta', () => {
  it('переносит мету, язык и исходник sql-блока на pre', async () => {
    const html = await render('```sql run expect=rows:9\nselect 1;\n```\n');
    expect(html).toContain('data-lang="sql"');
    expect(html).toContain('data-meta="run expect=rows:9"');
    expect(html).toContain('data-code="select 1;"');
    expect(html).toContain('class="shiki');
  });

  it('кириллица в коде не портится', async () => {
    const html = await render("```sql\nselect 'Привет';\n```\n");
    expect(html).toContain('data-code="select &#x27;Привет&#x27;;"');
  });

  it('блок без меты получает пустую мету', async () => {
    const html = await render('```sql\nselect 1;\n```\n');
    expect(html).toContain('data-meta=""');
  });

  it('неизвестный язык подсвечивается как текст и не роняет сборку', async () => {
    const html = await render('```brainfuck\n+++\n```\n');
    expect(html).toContain('data-lang="brainfuck"');
    expect(html).toContain('+++');
  });
});
