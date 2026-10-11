import { render, screen } from '@testing-library/react';
import { type EdgeProps, type NodeProps, Position, ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { SCHEMA } from './__fixtures__/schema';
import { FkEdge, FkMarkers, fkTitle, selfLoopPath } from './FkEdge';
import type { FkFlowEdge, SchemaFlowNode } from './model';
import { SchemaGroupNode } from './SchemaGroupNode';

const [bookAuthor, , , cartBook] = SCHEMA.fks;

function edgeProps(source: string, target: string): EdgeProps<FkFlowEdge> {
  return {
    id: 'e',
    source,
    target,
    sourceX: 300,
    sourceY: 18,
    targetX: 500,
    targetY: 118,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { fk: cartBook ?? SCHEMA.fks[0] },
  } as unknown as EdgeProps<FkFlowEdge>;
}

describe('FkEdge', () => {
  it('тултип с действиями ON DELETE и ON UPDATE', () => {
    expect(bookAuthor && fkTitle(bookAuthor)).toBe(
      'book_author_id_fkey\npublic.book (author_id) → public.author (author_id)\nON DELETE NO ACTION\nON UPDATE NO ACTION',
    );
  });

  it('ребро с маркерами «один» и «много» и тултипом', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg aria-hidden="true">
          <FkEdge {...edgeProps('public.book', 'shop.cart')} />
        </svg>
      </ReactFlowProvider>,
    );
    const path = container.querySelector('path.vs-fk-path');
    expect(path).toHaveAttribute('marker-end', 'url(#vs-fk-many)');
    expect(path).toHaveAttribute('marker-start', 'url(#vs-fk-one)');
    expect(container.querySelector('title')?.textContent).toContain('ON DELETE CASCADE');
  });

  it('FK на себя рисуется петлёй над шапкой', () => {
    expect(selfLoopPath(300, 18, 40, 18)).toBe('M 300 18 H 324 V -22 H 16 V 18 H 40');
  });

  it('маркеры объявлены один раз', () => {
    const { container } = render(<FkMarkers />);
    expect(container.querySelectorAll('marker#vs-fk-many, marker#vs-fk-one')).toHaveLength(2);
  });
});

describe('SchemaGroupNode', () => {
  it('подписывает рамку именем схемы', () => {
    const props = {
      id: 'schema:shop',
      data: { schema: 'shop' },
      type: 'schemaGroup',
    } as unknown as NodeProps<SchemaFlowNode>;
    render(<SchemaGroupNode {...props} />);
    expect(screen.getByTestId('schema-group-shop')).toHaveTextContent('shop');
  });
});
