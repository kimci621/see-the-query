import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { GROUP_LABEL, type SchemaFlowNode } from './model';

export const SchemaGroupNode = memo(function SchemaGroupNode({ data }: NodeProps<SchemaFlowNode>) {
  return (
    <div
      data-testid={`schema-group-${data.schema}`}
      className="h-full w-full rounded-xl border-2 border-dashed border-border bg-muted/20"
    >
      <div
        className="px-3 font-mono text-xs font-medium text-muted-foreground"
        style={{ height: GROUP_LABEL, lineHeight: `${GROUP_LABEL}px` }}
      >
        {data.schema}
      </div>
    </div>
  );
});
