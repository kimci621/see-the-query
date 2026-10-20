import { describe, expect, it, vi } from 'vitest';
import { traceStatement } from '@/features/tracer/trace';
import { withDataset } from '../helpers/db';
import {
  checkBlocks,
  checkFinalOnlyNotes,
  checkForeignSqlFences,
  checkTermIds,
  extractSqlBlocks,
} from './blocks';

// Настоящий трассировщик по умолчанию, в одном тесте подменяем на падающий
vi.mock('@/features/tracer/trace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/tracer/trace')>();
  return { ...actual, traceStatement: vi.fn(actual.traceStatement) };
});

// В исходниках тестов вместо тройной обратной кавычки пишем ~~~, чтобы не ломать шаблонные строки
const mdx = (body: string) => body.replaceAll('~~~', '```');

describe('extractSqlBlocks', () => {
  it('находит sql-блоки с метой и номером строки, другие языки пропускает', () => {
    const blocks = extractSqlBlocks(
      mdx(
        [
          '# Урок',
          '',
          '~~~sql run expect=rows:11',
          'select * from book;',
          '~~~',
          '',
          '~~~ts',
          'const x = 1;',
          '~~~',
          '',
          '<Step caption="Шаг">',
          '',
          '~~~sql',
          "select 'Привет, ~~~ мир' as hi;",
          '~~~',
          '',
          '</Step>',
        ].join('\n'),
      ),
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ line: 3, rawMeta: 'run expect=rows:11', sql: 'select * from book;' });
    expect(blocks[0]?.meta).toMatchObject({ run: true, expectRows: 11 });
    expect(blocks[1]).toMatchObject({ line: 13, rawMeta: '', sql: "select 'Привет, ``` мир' as hi;" });
  });

  it('многострочный блок и ```sqlite не путаются', () => {
    const blocks = extractSqlBlocks(
      mdx('~~~sqlite\nselect 1;\n~~~\n\n~~~sql run expect=rows:9\nselect *\nfrom book\nwhere true;\n~~~\n'),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.sql).toBe('select *\nfrom book\nwhere true;');
    expect(blocks[0]?.line).toBe(5);
  });

  it('пустой блок не глотает соседний', () => {
    const blocks = extractSqlBlocks(
      mdx('~~~sql noexec\n~~~\n\nтекст\n\n~~~sql run expect=rows:3\nselect 1;\n~~~\n'),
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ line: 1, rawMeta: 'noexec', sql: '' });
    expect(blocks[1]).toMatchObject({ line: 6, rawMeta: 'run expect=rows:3', sql: 'select 1;' });
  });

  it('ошибка меты называет строку', () => {
    expect(() => extractSqlBlocks(mdx('текст\n\n~~~sql run expect=row:9\nselect 1;\n~~~\n'))).toThrow(
      'строка 3',
    );
  });
});

describe('checkBlocks', () => {
  it('превью не оставляет следов, apply коммитит', async () => {
    const blocks = extractSqlBlocks(
      mdx(
        [
          '~~~sql run expect=rows:1 trace=final-only',
          "insert into author (name, country, born_year) values ('Лев Толстой', 'Россия', 1828) returning author_id;",
          '~~~',
          '',
          '~~~sql run expect=rows:0',
          "select * from author where name = 'Лев Толстой';",
          '~~~',
          '',
          '~~~sql apply expect=rows:1',
          "insert into author (name, country, born_year) values ('Лев Толстой', 'Россия', 1828) returning author_id;",
          '~~~',
          '',
          '~~~sql run expect=rows:1',
          "select * from author where name = 'Лев Толстой';",
          '~~~',
        ].join('\n'),
      ),
    );
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db, { trace: false }));
    expect(problems).toEqual([]);
  });

  it('неверное число строк', async () => {
    const blocks = extractSqlBlocks(mdx('~~~sql run expect=rows:5\nselect * from book;\n~~~\n'));
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db, { trace: false }));
    expect(problems).toEqual(['строка 1: ожидалось 5 строк, получено 11']);
  });

  it('expectError, а запрос выполнился', async () => {
    const blocks = extractSqlBlocks(mdx('~~~sql run expectError=42703\nselect title from book;\n~~~\n'));
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db, { trace: false }));
    expect(problems).toEqual(['строка 1: ожидалась ошибка 42703, а запрос выполнился']);
  });

  it('expectError с другим кодом и неожиданная ошибка', async () => {
    const blocks = extractSqlBlocks(
      mdx(
        '~~~sql run expectError=42P01\nselect titel from book;\n~~~\n\n~~~sql run expect=rows:1\nselect 100 / 0;\n~~~\n',
      ),
    );
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db, { trace: false }));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^строка 1: ожидалась ошибка 42P01, получена 42703/);
    expect(problems[1]).toMatch(/^строка 5: неожиданная ошибка 22012/);
  });

  it('блок без ожидания', async () => {
    const blocks = extractSqlBlocks(
      mdx('~~~sql run\nselect 1;\n~~~\n\n~~~sql noexec\nselect <что-то>;\n~~~\n'),
    );
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db, { trace: false }));
    expect(problems).toEqual(['строка 1: у блока нет ожидания (expect=rows:N или expectError=SQLSTATE)']);
  });

  it('трасса: full проходит, два оператора в run-блоке нельзя', async () => {
    const blocks = extractSqlBlocks(
      mdx(
        '~~~sql run expect=rows:11\nselect * from book;\n~~~\n\n~~~sql run expect=rows:6\nselect 1; select * from author;\n~~~\n',
      ),
    );
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db));
    expect(problems).toEqual(['строка 5: в run-блоке должен быть один оператор, а их 2']);
  }, 60_000);

  it('два оператора в run-блоке нельзя и при expectError', async () => {
    const blocks = extractSqlBlocks(
      mdx('~~~sql run expectError=42703\nselect 1; select titel from book;\n~~~\n'),
    );
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db));
    expect(problems).toEqual(['строка 1: в run-блоке должен быть один оператор, а их 2']);
  });

  it('два оператора в apply-блоке нельзя: кнопка урока применяет оператор под курсором', async () => {
    const blocks = extractSqlBlocks(
      mdx(
        "~~~sql apply expect=rows:1\ninsert into book_category (name) values ('x'); insert into book_category (name) values ('y');\n~~~\n",
      ),
    );
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db, { trace: false }));
    expect(problems).toEqual(['строка 1: в apply-блоке должен быть один оператор, а их 2']);
  });

  it('COMMIT в блоке без apply ловится и не протекает в следующие блоки', async () => {
    const blocks = extractSqlBlocks(
      mdx(
        [
          '~~~sql expect=rows:0',
          "insert into book_category (name) values ('x'); commit;",
          '~~~',
          '',
          '~~~sql run expect=rows:0',
          "select * from book_category where name = 'x';",
          '~~~',
        ].join('\n'),
      ),
    );
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db, { trace: false }));
    expect(problems).toEqual([
      'строка 1: команда транзакции в блоке без apply: превью её не выполняет, а раннер закоммитил бы данные',
    ]);
  });

  it('синтаксическая ошибка с expectError=42601 не считается проблемой парсера', async () => {
    const blocks = extractSqlBlocks(mdx('~~~sql run expectError=42601\nselect from from book;\n~~~\n'));
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db));
    expect(problems).toEqual([]);
  });

  it('сбой трассировщика даёт проблему со строкой, а не роняет урок', async () => {
    vi.mocked(traceStatement).mockRejectedValueOnce(new Error('бум'));
    const blocks = extractSqlBlocks(mdx('~~~sql run expect=rows:11\nselect * from book;\n~~~\n'));
    const problems = await withDataset('bookstore', (db) => checkBlocks(blocks, db));
    expect(problems).toEqual(['строка 1: трассировщик упал: Error: бум']);
  });
});

describe('checkForeignSqlFences', () => {
  const bt = (n: number) => '`'.repeat(n);

  it('ловит чужие заборы sql с номером строки', () => {
    expect(checkForeignSqlFences('a\n~~~sql\nselect 1;\n~~~\n')).toEqual([
      expect.stringContaining('строка 2'),
    ]);
    expect(checkForeignSqlFences(`a\n\n${bt(4)}sql\nselect 1;\n${bt(4)}\n`)).toEqual([
      expect.stringContaining('строка 3'),
    ]);
    expect(checkForeignSqlFences(`a\n    ${bt(3)}sql\nselect 1;\n`)).toEqual([
      expect.stringContaining('строка 2'),
    ]);
  });

  it('обычные заборы, ```sqlite и другие языки не трогает', () => {
    const src = mdx(
      '~~~sql run\nselect 1;\n~~~\n\n   ~~~sql\nx\n~~~\n\n~~~sqlite\ny\n~~~\n\n~~~ts\nz\n~~~\n',
    );
    expect(checkForeignSqlFences(src)).toEqual([]);
  });
});

describe('checkFinalOnlyNotes', () => {
  const check = (text: string) => {
    const source = mdx(text);
    return checkFinalOnlyNotes(source, extractSqlBlocks(source));
  };

  it('final-only без комментария с причиной даёт проблему со строкой блока', () => {
    expect(check('Текст\n\n~~~sql run expect=rows:1 trace=final-only\nselect 1;\n~~~')).toHaveLength(1);
    expect(
      check('{/* final-only: */}\n~~~sql run expect=rows:1 trace=final-only\nselect 1;\n~~~'),
    ).toHaveLength(1);
    expect(
      check('{/* final-only: причина */}\n~~~sql run expect=rows:1 trace=final-only\nselect 1;\n~~~'),
    ).toEqual([]);
  });

  it('пустые строки между комментарием и блоком допустимы, обычные блоки не требуют комментария', () => {
    expect(
      check(
        '{/* final-only: подзапрос во FROM */}\n\n~~~sql run expect=rows:1 trace=final-only\nselect 1;\n~~~',
      ),
    ).toEqual([]);
    expect(check('~~~sql run expect=rows:1\nselect 1;\n~~~')).toEqual([]);
  });
});

describe('checkTermIds', () => {
  const known = new Set(['public.book', 'public.book.title']);

  it('id строкой в кавычках сверяется с базой', () => {
    expect(checkTermIds('<T id="public.book">book</T> и <C id="public.book.titel">title</C>', known)).toEqual(
      ['<C id="public.book.titel">: такого объекта нет в датасете'],
    );
  });

  it('id выражением или без кавычек раннер не пропускает', () => {
    expect(
      checkTermIds('<T id={"public.nope"}>x</T>, <C id={`public.book.title`}>y</C>, <T>z</T>', known),
    ).toEqual([
      '<T id={"public.nope"}>: id пишем строкой в двойных кавычках, иначе раннер его не проверит',
      '<C id={`public.book.title`}>: id пишем строкой в двойных кавычках, иначе раннер его не проверит',
      '<T>: id пишем строкой в двойных кавычках, иначе раннер его не проверит',
    ]);
  });
});
