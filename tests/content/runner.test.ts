import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('проверяет настоящий перевод и останавливается на неверном SQL или отсутствии ожидания', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vs-content-runner-'));
  const source = [
    '---',
    'id: inner-join',
    'title: Inner join',
    'chapter: joins',
    'number: "6.2"',
    'order: 2',
    'dataset: bookstore',
    'docs:',
    '  - url: https://www.postgresql.org/docs/current/queries-table-expressions.html',
    '    title: Table expressions',
    '---',
    '',
    '<TlDr>Find matching rows.</TlDr>',
    '',
    '```sql run expect=rows:1',
    "select title from book where title = 'Simple Python';",
    '```',
    '',
    '<Cheatsheet>Match rows with a condition.</Cheatsheet>',
  ].join('\n');
  const ru = path.join(root, 'content/lessons/06-joins/02-inner-join.mdx');
  const en = path.join(root, 'content/lessons-en/06-joins/02-inner-join.mdx');
  const dataset = path.join(root, 'content/datasets/en/bookstore.sql');
  const run = () =>
    spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'node_modules/vitest/vitest.mjs'),
        'run',
        '--project',
        'content',
        'tests/content/lessons.test.ts',
        '-t',
        'урок en/inner-join:',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VS_CONTENT_ROOT: root,
          VS_REQUIRE_EN_LESSONS: '1',
          VITEST_MAX_WORKERS: '1',
          FORCE_COLOR: '0',
        },
        encoding: 'utf8',
        timeout: 60000,
      },
    );
  try {
    for (const file of [ru, en, dataset]) mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(ru, source);
    writeFileSync(en, source);
    writeFileSync(dataset, '');
    const good = run();
    expect(good.status, good.stdout + good.stderr).toBe(0);
    expect(good.stdout).toMatch(/Tests\s+5 passed/);

    writeFileSync(en, source.replace('select title from book', 'select missing_column from book'));
    const broken = run();
    expect(broken.status, broken.stdout + broken.stderr).not.toBe(0);
    expect(broken.stdout + broken.stderr).toContain('42703');

    writeFileSync(en, source.replace('run expect=rows:1', 'run'));
    const missing = run();
    expect(missing.status, missing.stdout + missing.stderr).not.toBe(0);
    expect(missing.stdout + missing.stderr).toContain('нет ожидания');

    rmSync(en);
    const untranslated = run();
    expect(untranslated.status, untranslated.stdout + untranslated.stderr).not.toBe(0);
    expect(untranslated.stdout + untranslated.stderr).toContain('Нет английских уроков: inner-join');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 180000);
