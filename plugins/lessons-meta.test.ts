import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectLessonsMeta, parseLessonFile } from './lessons-meta';

const VALID = `---
id: inner-join
title: INNER JOIN
chapter: joins
number: "6.2"
order: 2
dataset: bookstore
docs:
  - https://www.postgresql.org/docs/current/queries-table-expressions.html
tags: [join, "null"]
mvp: true
---

Текст урока.
`;

describe('parseLessonFile', () => {
  it('разбирает корректный frontmatter', () => {
    const meta = parseLessonFile(VALID, 'content/lessons/06-joins/02-inner-join.mdx');
    expect(meta).toEqual({
      id: 'inner-join',
      title: 'INNER JOIN',
      chapter: 'joins',
      number: '6.2',
      order: 2,
      dataset: 'bookstore',
      docs: ['https://www.postgresql.org/docs/current/queries-table-expressions.html'],
      tags: ['join', 'null'],
      mvp: true,
      path: '/content/lessons/06-joins/02-inner-join.mdx',
    });
  });

  it('нет frontmatter → ошибка с путём файла', () => {
    expect(() => parseLessonFile('# Урок', 'content/lessons/x.mdx')).toThrow(
      'content/lessons/x.mdx: нет frontmatter',
    );
  });

  it('number без кавычек → ошибка с подсказкой про кавычки', () => {
    const src = VALID.replace('number: "6.2"', 'number: 6.10');
    expect(() => parseLessonFile(src, 'a.mdx')).toThrow(/number.*кавычк/);
  });

  it('нет обязательного поля → ошибка с именем поля', () => {
    const src = VALID.replace('title: INNER JOIN\n', '');
    expect(() => parseLessonFile(src, 'a.mdx')).toThrow('a.mdx: поле title');
  });

  it('order не целое число → ошибка', () => {
    const src = VALID.replace('order: 2', 'order: "2"');
    expect(() => parseLessonFile(src, 'a.mdx')).toThrow('a.mdx: поле order');
  });

  it('tags и docs по умолчанию пустые', () => {
    const src = VALID.replace(/docs:\n {2}- .*\n/, '').replace('tags: [join, "null"]\n', '');
    const meta = parseLessonFile(src, 'a.mdx');
    expect(meta.docs).toEqual([]);
    expect(meta.tags).toEqual([]);
  });

  it('CRLF в файле не мешает', () => {
    expect(parseLessonFile(VALID.replace(/\n/g, '\r\n'), 'a.mdx').id).toBe('inner-join');
  });
});

describe('collectLessonsMeta', () => {
  function makeRoot(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), 'vs-lessons-'));
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content);
    }
    return root;
  }

  it('собирает все уроки', () => {
    const root = makeRoot({
      'content/lessons/06-joins/02-inner-join.mdx': VALID,
      'content/lessons/06-joins/03-left-join.mdx': VALID.replace('id: inner-join', 'id: left-join'),
    });
    expect(
      collectLessonsMeta(root)
        .map((m) => m.id)
        .sort(),
    ).toEqual(['inner-join', 'left-join']);
  });

  it('дубль id → ошибка с обоими путями', () => {
    const root = makeRoot({
      'content/lessons/06-joins/02-a.mdx': VALID,
      'content/lessons/06-joins/03-b.mdx': VALID,
    });
    expect(() => collectLessonsMeta(root)).toThrow(/Дубль id «inner-join».*02-a\.mdx.*03-b\.mdx/);
  });

  it('нет папки уроков → пустой список', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vs-empty-'));
    expect(collectLessonsMeta(root)).toEqual([]);
  });
});
