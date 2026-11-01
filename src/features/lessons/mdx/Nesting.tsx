import { validNestingPath } from './nesting-path';

export function Nesting({ path }: { path: string }) {
  if (!validNestingPath(path)) throw new Error('Nesting: неверный path');
  const [database, schema, table] = path.split('/');
  return (
    <figure
      aria-label={`кластер, база ${database}, схема ${schema}, таблица ${table}`}
      className="not-prose my-6 rounded-xl border-2 border-dashed border-border bg-muted/20 p-3 text-sm [overflow-wrap:anywhere]"
    >
      <span className="font-medium text-foreground">Кластер PostgreSQL</span>
      <div className="mt-3 rounded-lg border border-dashed border-border bg-background/70 p-3">
        <span className="font-medium text-foreground">база {database}</span>
        <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 p-3">
          <span className="font-medium text-foreground">схема {schema}</span>
          <div className="mt-3 rounded-md border border-border bg-card px-3 py-2 text-foreground">
            <span className="font-medium">таблица {table}</span>
          </div>
        </div>
      </div>
    </figure>
  );
}
