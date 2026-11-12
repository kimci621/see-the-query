import { render, screen, within } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { TableInfo } from '@/features/db/introspect';
import { book } from './__fixtures__/schema';
import type { TableFlowNode } from './model';
import { tableAriaLabel } from './model';
import { TableNode } from './TableNode';

function renderTable(table: TableInfo) {
  const props = { id: table.id, data: { table }, type: 'table' } as unknown as NodeProps<TableFlowNode>;
  return render(
    <ReactFlowProvider>
      <TooltipProvider>
        <TableNode {...props} />
      </TooltipProvider>
    </ReactFlowProvider>,
  );
}

describe('представления на доске', () => {
  it('показывает вид и его запрос', () => {
    const table: TableInfo = { ...book, kind: 'view', viewDefinition: 'SELECT title FROM book' };
    renderTable(table);
    const node = screen.getByTestId(`table-node-${table.id}`);
    expect(node).toHaveAttribute('data-kind', 'view');
    expect(within(node).getByText('VIEW')).toBeVisible();
    expect(within(node).getByTestId('view-definition')).toHaveTextContent('SELECT title FROM book');
    expect(tableAriaLabel(table)).toContain('Представление');
    expect(tableAriaLabel(table)).toContain('SELECT title FROM book');
  });

  it('показывает состояние снимка и не считает неизвестное состояние свежим', () => {
    const table: TableInfo = {
      ...book,
      kind: 'matview',
      matviewLag: 2,
      viewDefinition: 'SELECT title FROM book',
    };
    const { rerender } = renderTable(table);
    expect(screen.getByText('2 различия')).toBeVisible();
    expect(tableAriaLabel(table)).toContain('Материализованное представление');
    expect(tableAriaLabel(table)).toContain('различий с текущим результатом: 2');
    rerender(
      <ReactFlowProvider>
        <TooltipProvider>
          <TableNode
            {...({
              id: table.id,
              data: { table: { ...table, matviewLag: 0 } },
              type: 'table',
            } as unknown as NodeProps<TableFlowNode>)}
          />
        </TooltipProvider>
      </ReactFlowProvider>,
    );
    expect(screen.getByText('Совпадает')).toBeVisible();
    rerender(
      <ReactFlowProvider>
        <TooltipProvider>
          <TableNode
            {...({
              id: table.id,
              data: { table: { ...table, matviewLag: null } },
              type: 'table',
            } as unknown as NodeProps<TableFlowNode>)}
          />
        </TooltipProvider>
      </ReactFlowProvider>,
    );
    expect(screen.queryByText('Совпадает')).toBeNull();
    expect(screen.queryByText('2 различия')).toBeNull();
  });
});
