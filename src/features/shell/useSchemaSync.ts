import { useEffect } from 'react';
import { MAX_VISIBLE_ROWS } from '@/features/board/layout';
import { introspect } from '@/features/db/introspect';
import { useSandbox } from '@/features/db/SandboxProvider';
import { useBoardStore } from '@/stores/board';

// Доска перерисовывается только здесь: после загрузки урока и после «Применить» (событие changed)
export function useSchemaSync(): void {
  const { sandbox } = useSandbox();

  useEffect(() => {
    if (!sandbox) return;
    let alive = true;
    let generation = 0;

    const sync = async () => {
      const mine = ++generation;
      try {
        const schema = await introspect(sandbox.client(), { sampleRows: MAX_VISIBLE_ROWS });
        const base = sandbox.datasetTables();
        const userTables = schema.tables.filter((t) => !base.includes(t.id)).map((t) => t.id);
        if (alive && mine === generation) useBoardStore.getState().setSchema(schema, userTables);
      } catch (e) {
        // песочница перезапускается и пришлёт changed ещё раз; старая схема остаётся на доске
        console.error('introspect', e);
      }
    };

    if (sandbox.status === 'ready') void sync();
    const off = sandbox.subscribe((e) => {
      if (e.type === 'changed') void sync();
      // Пересборка под другой урок: схема прошлого урока на доске неверна, стартовый кадр ждёт первую схему нового.
      // Ответ introspect, уже летящий к стору, отбрасываем
      if (e.type === 'rebuilding') {
        generation++;
        useBoardStore.getState().setSchema(null);
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [sandbox]);
}
