import { describe, expect, it } from 'vitest';
import { author, book, cart, SCHEMA } from './__fixtures__/schema';
import { foldColumns, foldWidth, tableHeight, tableWidth } from './layout';
import {
  buildEdges,
  buildNodes,
  GROUP_LABEL,
  GROUP_PADDING,
  normalizeTableId,
  resolvePositions,
  tableAriaLabel,
} from './model';

describe('normalizeTableId', () => {
  it('голое имя уходит в public, полное остаётся', () => {
    expect(normalizeTableId('book')).toBe('public.book');
    expect(normalizeTableId('shop.cart')).toBe('shop.cart');
  });
});

describe('tableAriaLabel', () => {
  it('таблица, число строк и все колонки', () => {
    expect(tableAriaLabel(book)).toBe(
      `Таблица public.book, 11 строк, колонки: ${book.columns.map((c) => c.name).join(', ')}`,
    );
  });
});

describe('resolvePositions', () => {
  it('координаты урока ставят указанные таблицы, остальные встают правее них', () => {
    const auto = resolvePositions(SCHEMA, null, 'auto');
    const manual = resolvePositions(SCHEMA, null, { book: { x: 5, y: 7 } });
    expect(manual['public.book']).toEqual({ x: 5, y: 7 });
    const right = 5 + tableWidth(book);
    for (const id of ['public.author', 'public.book_category', 'shop.cart'])
      expect(manual[id].x).toBeGreaterThan(right);
    expect(resolvePositions(SCHEMA, null)).toEqual(auto);
  });
});

describe('buildNodes', () => {
  const positions = resolvePositions(SCHEMA, null);
  const nodes = buildNodes(SCHEMA, null, positions);

  it('рамки схем идут раньше таблиц', () => {
    expect(nodes.map((n) => n.id)).toEqual([
      'schema:public',
      'schema:shop',
      'public.author',
      'public.book_category',
      'public.book',
      'shop.cart',
    ]);
  });

  it('таблица внутри рамки: абсолютная позиция совпадает с раскладкой', () => {
    for (const t of [author, book, cart]) {
      const node = nodes.find((n) => n.id === t.id);
      const group = nodes.find((n) => n.id === `schema:${t.schema}`);
      expect(node?.type).toBe('table');
      expect(node?.parentId).toBe(`schema:${t.schema}`);
      // ширину ноды задаёт сама таблица (свёртка), модель даёт стартовую для кадра до замера
      expect(node?.width).toBeUndefined();
      expect(node?.initialWidth).toBe(foldWidth(foldColumns(t, [], false)));
      expect(node?.height).toBe(tableHeight(t));
      expect({
        x: (group?.position.x ?? 0) + (node?.position.x ?? 0),
        y: (group?.position.y ?? 0) + (node?.position.y ?? 0),
      }).toEqual(positions[t.id]);
    }
  });

  it('таблица: подпись и роль для скринридера на обёртке ноды', () => {
    const node = nodes.find((n) => n.id === 'public.book');
    expect(node?.ariaLabel).toBe(tableAriaLabel(book));
    expect(node?.domAttributes).toEqual({ 'aria-roledescription': 'таблица' });
  });

  it('рамка охватывает таблицы с отступом и местом под подпись', () => {
    const shop = nodes.find((n) => n.id === 'schema:shop');
    const p = positions['shop.cart'];
    expect(shop?.position).toEqual({
      x: (p?.x ?? 0) - GROUP_PADDING,
      y: (p?.y ?? 0) - GROUP_PADDING - GROUP_LABEL,
    });
    expect(shop?.width).toBe(tableWidth(cart) + 2 * GROUP_PADDING);
    expect(shop?.height).toBe(tableHeight(cart) + 2 * GROUP_PADDING + GROUP_LABEL);
  });

  it('фильтр урока убирает таблицы и пустые рамки', () => {
    const ids = buildNodes(SCHEMA, ['public.book'], positions).map((n) => n.id);
    expect(ids).toEqual(['schema:public', 'public.book']);
  });
});

describe('buildEdges', () => {
  it('ребро идёт от таблицы, на которую ссылаются, к таблице с FK', () => {
    const edge = buildEdges(SCHEMA, null).find((e) => e.id === 'book_author_id_fkey:public.book');
    expect(edge).toMatchObject({ type: 'fk', source: 'public.author', target: 'public.book' });
    expect(edge?.data?.fk.name).toBe('book_author_id_fkey');
  });

  it('ребро со скрытым концом не строится', () => {
    expect(buildEdges(SCHEMA, ['public.book', 'public.author']).map((e) => e.id)).toEqual([
      'book_author_id_fkey:public.book',
    ]);
  });
});
