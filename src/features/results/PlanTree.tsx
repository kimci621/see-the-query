import { linkPlanToStages, type PlanNode, rowsRead } from '@/features/tracer/explain';
import type { Stage } from '@/features/tracer/types';
import { useSceneStore } from '@/stores/scene';

const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function PlanTree({ plan, stages }: { plan: PlanNode; stages: Stage[] }) {
  const links = new Map(linkPlanToStages(plan, stages).map(({ node, stageIndex }) => [node, stageIndex]));
  const maxRows = Math.max(1, ...[...links.keys()].map((node) => (node.actualRows ?? 0) * (node.loops ?? 0)));
  const setHoveredStage = useSceneStore((state) => state.setHoveredStage);
  const renderNode = (node: PlanNode, key: string) => {
    const stageIndex = links.get(node) ?? null;
    const read = rowsRead(node);
    const found =
      node.actualRows !== undefined && node.loops !== undefined ? node.actualRows * node.loops : null;
    const description = [
      read === null
        ? null
        : `прочитано ${node.loops && node.loops > 1 ? '≈' : ''}${format.format(read)} строк`,
      found === null
        ? null
        : `возвращено ${node.loops && node.loops > 1 ? '≈' : ''}${format.format(found)} строк`,
      node.planRows === undefined ? null : `оценка ${format.format(node.planRows)} строк за проход`,
    ]
      .filter(Boolean)
      .join(' · ');
    const title = `${node.nodeType}${node.relation ? ` по ${node.schema ? `${node.schema}.` : ''}${node.relation}` : ''}${node.indexName ? ` (${node.indexName})` : ''}`;
    return (
      <li key={key}>
        <div
          className="rounded-md border bg-card p-2"
          style={{ borderLeftWidth: `${2 + Math.round(4 * Math.sqrt((found ?? 0) / maxRows))}px` }}
        >
          {stageIndex === null ? (
            <p className="text-xs font-semibold">{title}</p>
          ) : (
            <button
              type="button"
              className="rounded text-left text-xs font-semibold underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onMouseEnter={() => setHoveredStage(stageIndex)}
              onMouseLeave={() => setHoveredStage(null)}
              onFocus={() => setHoveredStage(stageIndex)}
              onBlur={() => setHoveredStage(null)}
              aria-label={`${title}. Показать связанный шаг`}
            >
              {title}
            </button>
          )}
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
          {node.filter && <p className="mt-1 break-words font-mono text-xs">Фильтр: {node.filter}</p>}
          {node.indexCond && (
            <p className="mt-1 break-words font-mono text-xs">Условие индекса: {node.indexCond}</p>
          )}
        </div>
        {node.children.length > 0 && (
          <ul className="ml-3 mt-2 space-y-2 border-l pl-3">
            {node.children.map((child, index) => renderNode(child, `${key}.${index}`))}
          </ul>
        )}
      </li>
    );
  };
  return (
    <div data-testid="plan-tree" className="h-full overflow-auto p-2">
      <p className="mb-2 text-xs text-muted-foreground">
        Наведи указатель или переведи фокус на узел, чтобы подсветить связанный шаг. Числа при нескольких
        проходах приблизительны.
      </p>
      <ul className="space-y-2">{renderNode(plan, 'root')}</ul>
    </div>
  );
}
