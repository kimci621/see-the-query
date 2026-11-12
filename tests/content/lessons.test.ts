// tests/content/lessons.test.ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CHAPTERS } from '@content/chapters';
import { compile } from '@mdx-js/mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { normalizeTableId } from '@/features/board/model';
import type { DbClient } from '@/features/db/types';
import { CALLOUT_KINDS } from '@/features/lessons/mdx/Callouts';
import { mdxComponents } from '@/features/lessons/mdx/components';
import { remarkNesting } from '@/features/lessons/mdx/remark-nesting';
import { collectLessonsMeta } from '../../plugins/lessons-meta';
import { withDataset } from '../helpers/db';
import {
  checkBlocks,
  checkFinalOnlyNotes,
  checkForeignSqlFences,
  checkTermIds,
  extractSqlBlocks,
} from './blocks';

const ROOT = process.cwd();
const LESSONS = collectLessonsMeta(ROOT);

// Уроки, написанные по docs/content-style.md. Задача урока добавляет сюда свой id первым шагом
const GUIDE_LESSONS: string[] = [
  'how-to-use',
  'table-anatomy',
  'select-basics',
  'logical-order',
  'where-boolean',
  'null-logic',
  'order-by',
  'limit-offset',
  'inner-join',
  'left-right-join',
  'aggregate-functions',
  'group-by',
  'having',
  'cluster-db-schema',
  'primary-foreign-key',
  'command-groups',
  'create-schema',
  'create-table',
  'operators',
  'distinct-on',
  'case-when',
  'values-generate-series',
  'relations',
  'full-join',
  'cross-join',
  'self-join',
  'multi-join',
  'natural-join',
  'on-vs-where',
  'semi-join',
  'anti-join',
  'row-multiplication',
  'lateral-join',
  'filter-aggregates',
  'rollup-cube',
  'scalar-subquery',
  'from-subquery',
  'correlated-subquery',
  'in-exists-any-all',
  'set-operations',
  'cte',
  'recursive-cte',
  'cte-materialization',
  'over-partition',
  'ranking',
  'lag-lead',
  'window-frame',
  'top-n',
  'types-casting',
  'numbers',
  'strings',
  'dates-time',
  'boolean',
  'enum',
  'arrays',
  'jsonb',
  'uuid-pk',
  'view',
  'materialized-view',
  'transactions',
  'savepoint',
  'mvcc',
  'isolation',
  'locks',
  'btree-seq-vs-index',
  'explain',
  'composite-indexes',
  'index-variants',
];

// Компоненты, которые урок получает без импорта; pre это подмена тега, а не компонент MDX
const MDX_TAGS = new Set(Object.keys(mdxComponents).filter((name) => name !== 'pre'));

const pad = (n: number) => String(n).padStart(2, '0');
const withoutCode = (mdx: string) => mdx.replace(/^ {0,3}```[\s\S]*?^ {0,3}```[ \t]*$/gm, '');

// Таблицы и колонки базы в формате id доски: 'public.book', 'public.book.title'
async function knownObjects(db: DbClient): Promise<Set<string>> {
  const result = await db.query(
    `with relations as (
       select c.oid, case when n.nspname like 'pg_temp_%' then 'pg_temp' else n.nspname end as schema,
              c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p', 'v', 'm')
         and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
     )
     select schema || '.' || name from relations
     union all
     select r.schema || '.' || r.name || '.' || a.attname
     from relations r join pg_attribute a on a.attrelid = r.oid
     where a.attnum > 0 and not a.attisdropped`,
  );
  return new Set(result.rows.map((r) => String(r[0])));
}

it('урок materialized-view: раннер видит снимки и их колонки', () =>
  withDataset('bookstore', async (db) => {
    await db.query('create materialized view mv_test as select book_id, title from book');
    const known = await knownObjects(db);
    expect(known.has('public.mv_test')).toBe(true);
    expect(known.has('public.mv_test.book_id')).toBe(true);
    expect(known.has('public.mv_test.title')).toBe(true);
  }));

describe('уроки по гайду', () => {
  for (const id of GUIDE_LESSONS) {
    it(`урок ${id}: есть, структура по гайду`, () => {
      const meta = LESSONS.find((l) => l.id === id);
      if (!meta) throw new Error(`нет урока ${id}`);
      const source = readFileSync(path.join(ROOT, meta.path), 'utf8');
      expect(source, 'нет <TlDr>').toContain('<TlDr>');
      expect(source, 'нет <Cheatsheet>').toContain('<Cheatsheet>');
      expect(
        extractSqlBlocks(source).some((b) => b.meta.run),
        'нет ни одного run-блока',
      ).toBe(true);
    });
  }
});

describe.each(LESSONS.map((meta) => [meta.id, meta] as const))('урок %s', (_id, meta) => {
  const source = readFileSync(path.join(ROOT, meta.path), 'utf8');

  it('frontmatter и путь по правилам', () => {
    const chapter = CHAPTERS.find((c) => c.id === meta.chapter);
    if (!chapter) throw new Error(`неизвестная глава ${meta.chapter}`);
    expect(meta.path).toBe(
      `/content/lessons/${pad(chapter.number)}-${chapter.id}/${pad(meta.order)}-${meta.id}.mdx`,
    );
    expect(
      meta.number.startsWith(`${chapter.number}.`),
      `номер ${meta.number} не из главы ${chapter.number}`,
    ).toBe(true);
    expect(
      existsSync(path.join(ROOT, 'content/datasets', `${meta.dataset}.sql`)),
      `нет датасета ${meta.dataset}`,
    ).toBe(true);
    expect(meta.docs.length, 'docs пуст').toBeGreaterThan(0);
    for (const { url, title } of meta.docs) {
      expect(url).toMatch(/^https:\/\//);
      expect(title.trim(), `нет title у ${url}`).not.toBe('');
    }
  });

  it('только известные MDX-компоненты', () => {
    const text = withoutCode(source);
    const tags = [...text.matchAll(/<([A-Z][A-Za-z]*)[\s/>]/g)].map((m) => m[1] ?? '');
    expect(tags.filter((t) => !MDX_TAGS.has(t))).toEqual([]);
    const kinds = [...text.matchAll(/<Callout kind="([^"]*)"/g)].map((m) => m[1] ?? '');
    expect(kinds.filter((k) => !(CALLOUT_KINDS as string[]).includes(k))).toEqual([]);
  });

  it('компоненты Nesting содержат корректный путь', async () => {
    await compile(
      { path: meta.path, value: source },
      { remarkPlugins: [remarkFrontmatter, remarkGfm, remarkNesting] },
    );
  });

  it('примеры выполняются и сходятся с ожиданиями', async () => {
    const blocks = extractSqlBlocks(source);
    expect(blocks.length, 'в уроке нет sql-блоков').toBeGreaterThan(0);
    const problems = await withDataset(meta.dataset, async (db) => {
      const found = [
        ...checkForeignSqlFences(source),
        ...checkFinalOnlyNotes(source, blocks),
        ...(await checkBlocks(blocks, db)),
      ];
      const known = await knownObjects(db);
      found.push(...checkTermIds(withoutCode(source), known));
      // Имена в frontmatter можно писать без схемы: доска нормализует их так же
      const layout = meta.board?.layout;
      const layoutTables = layout && layout !== 'auto' ? Object.keys(layout) : [];
      for (const name of meta.board?.tables ?? []) {
        if (!known.has(normalizeTableId(name))) found.push(`board.tables: нет таблицы ${name}`);
      }
      for (const name of layoutTables) {
        if (!known.has(normalizeTableId(name))) found.push(`board.layout: нет таблицы ${name}`);
      }
      return found;
    });
    expect(problems).toEqual([]);
  }, 120_000);
});
