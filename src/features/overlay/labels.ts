import type { Stage } from '@/features/tracer/types';

// Короткое название стадии для чипа таймлайна и подсказок
export function stageLabel(stage: Stage): string {
  switch (stage.kind) {
    case 'scan':
      return 'FROM';
    case 'join':
      return stage.joinType === 'cross' ? 'CROSS JOIN' : `${stage.joinType.toUpperCase()} JOIN`;
    case 'filter':
      return stage.clause === 'where' ? 'WHERE' : 'HAVING';
    case 'group': {
      // Агрегат без GROUP BY: имя первой агрегатной функции, остальные числом (COUNT +1)
      const [first, ...rest] = stage.aggregates;
      if (stage.keys.length || !first) return 'GROUP BY';
      const name = first.slice(0, first.indexOf('(')).replace(/^.*\./, '').toUpperCase();
      return rest.length ? `${name} +${rest.length}` : name;
    }
    case 'window':
      return 'OVER';
    case 'project':
      return 'SELECT';
    case 'distinct':
      return 'DISTINCT';
    case 'sort':
      return 'ORDER BY';
    case 'limit':
      return 'LIMIT';
    case 'setop':
      return stage.op.toUpperCase();
    case 'materialize':
      return `WITH ${stage.name}`;
    case 'recursion':
      return `RECURSIVE ${stage.name}`;
    case 'subquery':
      return 'ПОДЗАПРОС';
    case 'dml':
      return stage.op.toUpperCase();
    case 'ddl':
      return 'DDL';
    case 'error':
      return 'ОШИБКА';
  }
}

// 'public.book' + 'b' → 'book b'; схема показывается, если она не public
export function tableTitle(tableId: string, alias: string): string {
  const [schema, name] = tableId.includes('.') ? tableId.split('.', 2) : ['public', tableId];
  const shown = schema === 'public' ? name : `${schema}.${name}`;
  return alias === name ? shown : `${shown} ${alias}`;
}
