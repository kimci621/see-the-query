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
        if (alive && mine === generation) useBoardStore.getState().setSchema(schema);
      } catch (e) {
        // песочница перезапускается и пришлёт changed ещё раз; старая схема остаётся на доске
        console.error('introspect', e);
      }
    };

    if (sandbox.status === 'ready') void sync();
    const off = sandbox.subscribe((e) => {
      if (e.type === 'changed') void sync();
    });
    return () => {
      alive = false;
      off();
    };
  }, [sandbox]);
}
