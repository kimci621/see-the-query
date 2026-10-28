import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('INSERT ... SELECT', () => {
  it('вложенная трасса источника и вставленные строки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'insert into author (name, country) select name, country from author where born_year < 1830',
        );
        expect(trace.mode).toBe('full');
        const dml = stageOf(trace, 'dml') as Extract<(typeof trace.stages)[number], { kind: 'dml' }> & {
          defaulted?: string[];
        };
        expect(dml.inserted).toHaveLength(2);
        expect(dml.defaulted).toEqual(['author_id', 'born_year']);
        const materialize = stageOf(trace, 'materialize');
        expect(materialize.name).toBe('SELECT');
        expect(materialize.output.rows).toHaveLength(2);
        expect(materialize.inner.stages.map((stage) => stage.kind)).toContain('filter');
        expect(trace.stages.map((stage) => stage.kind)).toEqual(['materialize', 'dml']);
      }),
    ));

  it('источник из той же таблицы снят до вставки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'insert into author (name) select name from author');
        expect(stageOf(trace, 'materialize').output.rows).toHaveLength(6);
        expect(stageOf(trace, 'dml').inserted).toHaveLength(6);
      }),
    ));

  it('volatile в источнике остаётся только итогом', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'insert into author (name) select name from author where random() < 0.5',
        );
        expect(trace.mode).toBe('final-only');
        expect(trace.fallbackReason).toBe('Пока не анимируется: случайные значения в источнике INSERT');
      }),
    ));
});
