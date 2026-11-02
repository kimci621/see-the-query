import { describe, expect, it } from 'vitest';
import { introspect } from '@/features/db/introspect';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';
import { testCtx } from '../__fixtures__/traces';
import { frameBounds, ghostHeight } from '../geometry';
import { constraintErrorAnimator } from './constraint-error';

const rects = {
  'public.author': { x: 330, y: 0, width: 400, height: 220 },
  'public.book': { x: 0, y: 280, width: 600, height: 350 },
};

describe('сцена ошибки ограничения', () => {
  it('кадр FK вмещает обе таблицы и попытку вставки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const schema = await introspect(db);
        const trace = await traceSql(db, "insert into book (title, author_id) values ('Новая книга', 99)", {
          schema,
        });
        const phases = constraintErrorAnimator({ tables: [], decorations: [] }, stageOf(trace, 'error'), 0, {
          ...testCtx(rects),
          schema,
        });
        const frame = phases.at(-1)?.frame;
        if (!frame) throw new Error('нет кадра ошибки');
        const bounds = frameBounds(frame);
        expect(bounds?.x).toBeLessThanOrEqual(rects['public.book'].x);
        expect(bounds?.y).toBeLessThanOrEqual(rects['public.author'].y);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeGreaterThanOrEqual(
          rects['public.author'].x + rects['public.author'].width,
        );
        expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeGreaterThanOrEqual(
          rects['public.book'].y + rects['public.book'].height,
        );
      }),
    ));

  it('попытка вставки не закрывает строку с повторяющимся ключом', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const schema = await introspect(db);
        const trace = await traceSql(
          db,
          "insert into author (author_id, name) overriding system value values (1, 'Другой автор')",
          { schema },
        );
        const phases = constraintErrorAnimator({ tables: [], decorations: [] }, stageOf(trace, 'error'), 0, {
          ...testCtx(rects),
          schema,
        });
        const frame = phases.at(-1)?.frame;
        const attempted = frame?.tables.find((table) => table.id === 'a:public.author');
        const conflict = frame?.tables.find((table) => table.id === 't:public.author');
        if (!attempted || !conflict) throw new Error('нет попытки или конфликтующей строки');
        expect(conflict.rows.some((row) => row.state === 'conflict')).toBe(true);
        expect(attempted.y + ghostHeight(attempted)).toBeLessThanOrEqual(conflict.y);
      }),
    ));
});
