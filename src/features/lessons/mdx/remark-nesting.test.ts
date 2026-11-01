import { compile } from '@mdx-js/mdx';
import { describe, expect, it } from 'vitest';
import { remarkNesting } from './remark-nesting';

describe('проверка Nesting при сборке MDX', () => {
  const build = (source: string) => compile(source, { remarkPlugins: [remarkNesting] });

  it('принимает строковый путь из трёх частей', async () => {
    await expect(build('<Nesting path="postgres/public/book" />')).resolves.toBeDefined();
  });

  it.each([
    '<Nesting />',
    '<Nesting path="postgres/public" />',
    '<Nesting path="postgres//book" />',
    '<Nesting path="postgres/public/book/extra" />',
    '<Nesting path=" postgres/public/book" />',
    '<Nesting path={"postgres/public/book"} />',
    '<Nesting path="postgres/public/book" {...props} />',
  ])('отклоняет неверный путь: %s', async (source) => {
    await expect(build(source)).rejects.toThrow(/Nesting.*path/);
  });

  it('не проверяет примеры компонента внутри блока кода', async () => {
    await expect(build('```mdx\n<Nesting path="bad" />\n```')).resolves.toBeDefined();
  });
});
