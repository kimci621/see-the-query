import { afterEach, describe, expect, it } from 'vitest';
import { author, book, cart, category, col, SCHEMA, table, wideBook } from './__fixtures__/schema';
import {
  anchorFrame,
  autoLayout,
  COLUMN_WIDTH,
  foldColumns,
  foldWidth,
  GROUP_PADDING,
  ROW_HEIGHT,
  rem,
  SCHEMA_GAP,
  STUB_WIDTH,
  setRootFont,
  TABLE_WIDTH,
  tableHeight,
  tableWidth,
} from './layout';
import { resolvePositions } from './model';

type Rect = { x: number; y: number; w: number; h: number };

function rects(positions: Record<string, { x: number; y: number }>): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  for (const t of SCHEMA.tables) {
    const p = positions[t.id];
    if (p) out[t.id] = { x: p.x, y: p.y, w: tableWidth(t), h: tableHeight(t) };
  }
  return out;
}

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

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

// Крупный шрифт браузера (спека 3.4, WCAG 1.4.4): длины в rem, при корне 32px всё вдвое больше
describe('размеры в rem', () => {
  afterEach(() => setRootFont(16));

  it('корень 32px: константы, высота и ширина таблицы вдвое больше', () => {
    const before = {
      h: tableHeight(book),
      w: tableWidth(book),
      fold: foldWidth(foldColumns(wideBook, [], false)),
    };
    setRootFont(32);
    expect(rem(1)).toBe(32);
    expect([ROW_HEIGHT, COLUMN_WIDTH, STUB_WIDTH, TABLE_WIDTH, SCHEMA_GAP, GROUP_PADDING]).toEqual([
      48, 264, 192, 520, 240, 48,
    ]);
    expect(tableHeight(book)).toBe(2 * before.h);
    expect(tableWidth(book)).toBe(2 * before.w);
    expect(foldWidth(foldColumns(wideBook, [], false))).toBe(2 * before.fold);
  });

  it('корень 32px: раскладка и координаты урока растут вместе с таблицами, наложений нет', () => {
    const auto = autoLayout(SCHEMA, null);
    const lesson = { book: { x: 0, y: 0 }, author: { x: 0, y: 380 } };
    setRootFont(32);
    const big = autoLayout(SCHEMA, null);
    for (const id of Object.keys(auto)) expect(big[id]).toEqual({ x: 2 * auto[id].x, y: 2 * auto[id].y });
    const r = Object.values(rects(big));
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++) expect(overlap(r[i], r[j])).toBe(false);
    expect(resolvePositions(SCHEMA, null, lesson)['public.author']).toEqual({ x: 0, y: 760 });
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

describe('свёртка широкой таблицы', () => {
  const names = (f: ReturnType<typeof foldColumns>) => ({
    visible: f.visible.map((c) => c.name),
    hidden: f.hidden.map((c) => c.name),
  });

  it('до 6 колонок видны все, заглушки нет', () => {
    expect(names(foldColumns(book, [], false))).toEqual({
      visible: book.columns.map((c) => c.name),
      hidden: [],
    });
  });

  it('без запроса: PK, FK и первые по порядку схемы до пяти', () => {
    expect(names(foldColumns(wideBook, [], false))).toEqual({
      visible: ['book_id', 'title', 'author_id', 'category_id', 'price'],
      hidden: ['pages', 'published_at', 'tags', 'meta'],
    });
  });

  it('затронутая колонка видна, добор идёт после ключей и затронутых', () => {
    expect(names(foldColumns(wideBook, ['tags'], false))).toEqual({
      visible: ['book_id', 'title', 'author_id', 'category_id', 'tags'],
      hidden: ['price', 'pages', 'published_at', 'meta'],
    });
  });

  it('затронутых много: видно больше пяти, без добора', () => {
    expect(names(foldColumns(wideBook, ['meta', 'tags', 'pages'], false))).toEqual({
      visible: ['book_id', 'author_id', 'category_id', 'pages', 'tags', 'meta'],
      hidden: ['title', 'price', 'published_at'],
    });
  });

  it('затронуты все остальные колонки: заглушки нет', () => {
    const rest = ['title', 'price', 'pages', 'published_at', 'tags', 'meta'];
    expect(foldColumns(wideBook, rest, false).hidden).toEqual([]);
  });

  it('звёздочка разворачивает все 9 колонок', () => {
    expect(names(foldColumns(wideBook, [], true))).toEqual({
      visible: wideBook.columns.map((c) => c.name),
      hidden: [],
    });
  });

  it('ширина: видимые колонки плюс заглушка, не меньше TABLE_WIDTH', () => {
    expect(foldWidth(foldColumns(wideBook, [], false))).toBe(5 * COLUMN_WIDTH + STUB_WIDTH);
    expect(foldWidth(foldColumns(wideBook, [], true))).toBe(tableWidth(wideBook));
    expect(foldWidth(foldColumns(table('public.one', [col('id', 'int')]), [], false))).toBe(TABLE_WIDTH);
    // свёрнутая всегда уже полной: раскладка резервирует полную ширину
    expect(foldWidth(foldColumns(wideBook, [], false))).toBeLessThan(tableWidth(wideBook));
  });
});

// Якорь кадра (спека 3.4): доска 600×400, отступы 20, снизу хром 40, зум кадра упёрся в 0.6
describe('anchorFrame', () => {
  const pads = { left: 20, top: 20, bottom: 40 };
  const centered = (b: { x: number; y: number; width: number; height: number }, zoom: number) => ({
    x: 300 - (b.x + b.width / 2) * zoom,
    y: 200 - (b.y + b.height / 2) * zoom,
    zoom,
  });

  it('влезает: кадр по центру не трогаем', () => {
    const b = { x: 0, y: 0, width: 756, height: 340 };
    const vp = centered(b, 0.6);
    expect(anchorFrame(vp, b, 600, 400, pads)).toEqual(vp);
  });

  it('залезает только на отступы: fitView сам ужимает их поровну, кадр не трогаем', () => {
    const b = { x: 0, y: 0, width: 980, height: 580 };
    const vp = centered(b, 0.6);
    expect(anchorFrame(vp, b, 600, 400, pads)).toEqual(vp);
  });

  it('шире доски: левый край таблицы у левого отступа, по высоте центр', () => {
    const b = { x: 100, y: 50, width: 1188, height: 340 };
    const vp = centered(b, 0.6);
    expect(anchorFrame(vp, b, 600, 400, pads)).toEqual({ x: 20 - 100 * 0.6, y: vp.y, zoom: 0.6 });
  });

  it('выше доски без полосы хрома: верх таблиц у верхнего отступа, по ширине центр', () => {
    const b = { x: 0, y: -40, width: 858, height: 620 };
    const vp = centered(b, 0.6);
    expect(anchorFrame(vp, b, 600, 400, pads)).toEqual({ x: vp.x, y: 20 + 40 * 0.6, zoom: 0.6 });
  });
});
