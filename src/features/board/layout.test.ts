import { describe, expect, it } from 'vitest';
import { author, book, cart, category, col, SCHEMA, table } from './__fixtures__/schema';
import { autoLayout, COLUMN_WIDTH, SCHEMA_GAP, TABLE_WIDTH, tableHeight, tableWidth } from './layout';

type Rect = { x: number; y: number; w: number; h: number };

function rects(positions: Record<string, { x: number; y: number }>): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  for (const t of SCHEMA.tables) {
    const p = positions[t.id];
    if (p) out[t.id] = { x: p.x, y: p.y, w: tableWidth(t), h: tableHeight(t) };
  }
  return out;
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('размеры таблицы', () => {
  it('высота: шапка, заголовки колонок, видимые строки и строка «+ ещё» или «пусто»', () => {
    expect(tableHeight(book)).toBe(36 + 40 + 3 * 24 + 24);
    expect(tableHeight(author)).toBe(36 + 40 + 3 * 24);
    expect(tableHeight(cart)).toBe(36 + 40 + 24);
  });

  it('видно не больше 15 строк', () => {
    const rows = Array.from({ length: 15 }, (_, i) => [i]);
    expect(tableHeight(table('public.big', [col('id', 'int')], rows, 40))).toBe(36 + 40 + 15 * 24 + 24);
  });

  it('ширина по числу колонок, не меньше TABLE_WIDTH', () => {
    expect(tableWidth(book)).toBe(6 * COLUMN_WIDTH);
    expect(tableWidth(table('public.one', [col('id', 'int')]))).toBe(TABLE_WIDTH);
  });
});

describe('autoLayout', () => {
  it('таблицы не перекрываются', () => {
    const r = Object.values(rects(autoLayout(SCHEMA, null)));
    expect(r).toHaveLength(4);
    for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i];
        const b = r[j];
        if (a && b) expect(overlap(a, b)).toBe(false);
      }
    }
  });

  it('таблица, на которую ссылаются, левее ссылающейся', () => {
    const r = rects(autoLayout(SCHEMA, null));
    const a = r[author.id];
    const b = r[book.id];
    const c = r[category.id];
    expect(a && b && a.x + a.w <= b.x).toBe(true);
    expect(c && b && c.x + c.w <= b.x).toBe(true);
  });

  it('вторая схема правее первой с зазором', () => {
    const r = rects(autoLayout(SCHEMA, null));
    const publicRight = Math.max(...[author, category, book].map((t) => (r[t.id]?.x ?? 0) + tableWidth(t)));
    expect(r[cart.id]?.x).toBe(publicRight + SCHEMA_GAP);
  });

  it('учитывает фильтр урока и детерминирована', () => {
    const p = autoLayout(SCHEMA, ['public.book', 'public.author']);
    expect(Object.keys(p).sort()).toEqual(['public.author', 'public.book']);
    expect(autoLayout(SCHEMA, null)).toEqual(autoLayout(SCHEMA, null));
  });
});
