import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { GROUP_LABEL, GROUP_PADDING, type SchemaFlowNode } from './model';

export const SchemaGroupNode = memo(function SchemaGroupNode({ data }: NodeProps<SchemaFlowNode>) {
  return (
    <div
      data-testid={`schema-group-${data.schema}`}
      className="h-full w-full rounded-xl border-2 border-dashed border-border bg-muted/20"
    >
      {/* Подпись с левого края таблиц: кадр вписан по таблицам, и при зуме 0.6 подпись левее них
          вылезала бы за доску, когда таблицы занимают всю её ширину */}
      <div
        className="pr-3 font-mono text-xs font-medium text-muted-foreground"
        style={{ height: GROUP_LABEL, lineHeight: `${GROUP_LABEL}px`, paddingLeft: GROUP_PADDING }}
      >
        {data.schema}
      </div>
    </div>
  );
});
