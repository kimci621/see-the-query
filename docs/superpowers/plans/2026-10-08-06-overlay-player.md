# Ф6 Оверлей и плеер: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Проигрывать трассу запроса (`Trace`) анимацией на отдельном слое поверх доски: призраки таблиц, стадии scan / filter / project / distinct / sort / limit, плеер с чипами стадий, скрабом, автоплеем и подписями. Базовая доска при этом не перерисовывается.

**Architecture:** Аниматоры это чистые функции `(prevFrame, stage) → Phase[]`, каждая фаза хранит готовый кадр (`Frame`). `buildPlayback` прогоняет стадии трассы через аниматоры и получает плоский список фаз. `OverlayLayer` живёт внутри `<ReactFlow>` через `ViewportPortal` (координаты кадра = координаты доски), рендерит текущий кадр, а переходы между соседними кадрами анимируют `motion` (таблицы, строки, вход и выход) и CSS-переходы (сдвиг ячеек). Плеер (`usePlayer`) двигает `phaseIndex` в `useSceneStore` по таймеру.

**Tech Stack:** React 19, TypeScript strict, `@xyflow/react@12.12.0` (ViewportPortal, useReactFlow), `motion@14.0.0` (`motion/react`), zustand 5, shadcn/ui (Button, Slider, ToggleGroup, Tooltip), Vitest 5 (проекты node и dom), Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-08-visual-sql-design.md` (разделы 2, 3.5, 3.7, 4, 5.9, 9, 10). Контракты: `docs/superpowers/plans/2026-10-08-00-contracts.md` (разделы 6, 7, 9, 10).

## Global Constraints

- Базовая доска не анимируется и не перерисовывается во время сцены. Все движения только на оверлее (спека, принцип 5).
- Оверлей анимирует только `transform` и `opacity` (CLAUDE.md, раздел «Код»). Размеры таблиц меняются мгновенно, двигаются только позиции.
- Шаги показываются в логическом порядке: FROM → JOIN → WHERE → GROUP BY → HAVING → окна → SELECT → DISTINCT → ORDER BY → LIMIT (спека, принцип 6).
- Длительности фаз при скорости 1x: 400-900 мс; скорость делит длительность (контракты, раздел 10).
- Автоплей после правки: сцена проигрывается заново на 2x до последнего шага (спека 3.7).
- Скраб назад и клик по чипу: мгновенная пересборка кадра без анимации (спека 5.9).
- Сжатый режим: стадия больше 200 строк рисуется первыми 20 строками + полоса «… ещё N строк» и счётчик (спека 9).
- `prefers-reduced-motion`: фазы сменяются без движения, только смена состояний и подписи (спека 5.9, 10).
- Каждая фаза имеет текстовую подпись, она же в `aria-live` (спека 10).
- Цвет не единственный сигнал: отброшенные строки зачёркнуты и с иконкой, NULL с пунктиром и текстом (спека 10).
- Режим `final-only`: пошаговой сцены нет, в плеере пометка «пошаговый разбор для этой конструкции пока не умею» с причиной (спека, принцип 3).
- Тексты интерфейса и комментарии в коде на русском, идентификаторы на английском.
- Коммит только с зелёным `pnpm check`. Сообщение `<type>(<area>): <описание на русском>` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Сжатый режим на большой стадии (2000 строк).** Человек ждёт, что сцена не тормозит и числа в счётчике правдивые (берутся из `stage.output`, а не из видимых 20 строк). Тест: `filter.test.ts` → «сжатый режим: счётчик показывает настоящие числа» (задача 4) и `playback.test.ts` → «стадия на 500 строк рисует 20 строк и hiddenRows» (задача 8).
2. **Трасса `final-only` или без стадий.** Человек ждёт, что оверлей просто не появится, доска не останется приглушённой, а плеер честно скажет, почему разбора нет. Тест: `playback.test.ts` → «final-only даёт пустое проигрывание» (задача 8) и `Timeline.test.tsx` → «final-only показывает причину» (задача 12).
3. **Новая трасса пришла посреди проигрывания (пользователь допечатал символ).** Человек ждёт, что старая сцена не доиграет поверх новой: таймер сбрасывается, индекс фазы не выходит за пределы нового проигрывания. Тест: `scene.test.ts` → «setPlayback сбрасывает индекс и запускает автоплей заново» (задача 1) и `usePlayer.test.tsx` → «смена playback перезапускает таймер» (задача 12).
4. **Строки с одинаковыми значениями и NULL в ячейках.** Человек ждёт, что NULL отличим от пустой строки `''`, а одинаковые строки не склеиваются в рендере (ключ это RowKey, а не значения). Тест: `format.test.ts` → «NULL и пустая строка различаются» (задача 2) и `GhostTable.test.tsx` → «дубликаты значений рендерятся отдельными строками» (задача 10).
5. **Горячие клавиши, пока курсор в редакторе.** Человек ждёт, что пробел и стрелки в редакторе SQL печатают текст, а не управляют плеером. Тест: `useBoardHotkeys.test.tsx` → «пробел в поле ввода не трогает плеер» (задача 13).

---

## Карта файлов

Создаются:
- `src/features/overlay/types.ts`: типы кадров, фаз, аниматоров, проигрывания (контракт + `hiddenRows`).
- `src/features/overlay/geometry.ts`: размеры призраков, позиции строк и ячеек, границы кадра, геометрия декораций.
- `src/features/overlay/format.ts`: форматирование значений ячеек.
- `src/features/overlay/frame.ts`: операции над кадром (текущая таблица, пересборка из `Relation`, состояния строк и колонок, сжатие).
- `src/features/overlay/labels.ts`: короткие названия стадий для чипов и подсказок.
- `src/features/overlay/animators/scan.ts`, `filter.ts`, `project.ts`, `distinct.ts`, `sort.ts`, `limit.ts`, `generic.ts`, `error.ts`, `index.ts`: аниматоры и реестр `ANIMATORS`.
- `src/features/overlay/playback.ts`: `buildPlayback`.
- `src/features/overlay/emptyHint.ts`: подсказка для пустого результата.
- `src/features/overlay/__fixtures__/traces.ts`: синтетические трассы для тестов.
- `src/features/overlay/GhostTable.tsx`: рендер призрачной таблицы.
- `src/features/overlay/Decorations.tsx`: сканер, ножницы, счётчик, скобка, стрелка, линии пар (SVG).
- `src/features/overlay/OverlayErrorBoundary.tsx`.
- `src/features/overlay/OverlayLayer.tsx`: слой поверх доски.
- `src/features/overlay/context.ts`: сборка `AnimatorContext` из React Flow.
- `src/features/overlay/overlay.css`: стили призраков и декораций.
- `src/features/timeline/usePlayer.ts`, `src/features/timeline/Timeline.tsx`.
- `src/features/board/useBoardHotkeys.ts`.
- `src/features/results/EmptyHint.tsx`.
- `src/lib/renderCount.ts`: счётчик рендеров для e2e (только DEV).
- `tests/e2e/overlay.spec.ts`, `tests/e2e/overlay-perf.spec.ts`.
- Тесты рядом с исходниками (перечислены в задачах).

Меняются:
- `src/stores/scene.ts`: поля `playback`, `instant`, `autoRun`, действия `setPlayback`, `advance`, селектор `effectiveSpeed`.
- `src/features/board/BoardCanvas.tsx`: `<OverlayLayer />` внутри `<ReactFlow>`.
- `src/features/board/TableNode.tsx`: `bumpRenderCount('tableNode')`.
- `src/features/shell/BoardPane.tsx`: `<Timeline />`, фокусируемый контейнер доски с `useBoardHotkeys`.
- `src/features/editor/useLiveTrace.ts`: пустой текст закрывает сцену.
- `src/features/results/ResultsPanel.tsx`: `<EmptyHint />` при 0 строк.
- `vitest.config.ts`: проект `dom` включает `src/stores/**/*.test.ts`.
- `playwright.config.ts` и `package.json`: перф-тесты по флагу `PERF=1`, скрипт `e2e:perf`.

---

### Task 1: Типы оверлея и стор сцены с проигрыванием

**Files:**
- Create: `src/features/overlay/types.ts`
- Modify: `src/stores/scene.ts` (если файла ещё нет, создать целиком в виде ниже)
- Modify: `vitest.config.ts` (проект `dom`)
- Test: `src/stores/scene.test.ts`

**Interfaces:**
- Consumes: `Trace`, `Stage`, `RowKey`, `Relation` из `@/features/tracer/types` (Ф5); `SchemaSnapshot` из `@/features/db/introspect` (Ф2).
- Produces:
  - типы `RowState`, `GhostColumn`, `GhostRow`, `GhostTable` (с полем `hiddenRows?: number`), `Decoration`, `Frame`, `Phase`, `AnimatorContext`, `Animator<S>`, `Playback` из `@/features/overlay/types`;
  - `useSceneStore` с полями контракта + `playback: Playback | null`, `instant: boolean`, `autoRun: boolean`, действиями `setPlayback(p: Playback | null): void`, `advance(): void`;
  - селектор `effectiveSpeed(s: SceneStore): number` (при `autoRun` не меньше 2).

- [ ] **Step 1: Создать типы оверлея**

`src/features/overlay/types.ts`:

```ts
import type { SchemaSnapshot } from '@/features/db/introspect';
import type { RowKey, Stage } from '@/features/tracer/types';

// Состояние строки на сцене: от него зависят цвет, иконка и зачёркивание
export type RowState =
  | 'normal' | 'kept' | 'dropped' | 'unknown' | 'null-filled'
  | 'new' | 'changed' | 'deleted' | 'cut' | 'matched';

export interface GhostColumn {
  name: string;
  type?: string;
  state: 'normal' | 'highlight' | 'removed' | 'computed' | 'key' | 'added';
}

export interface GhostRow {
  key: RowKey;
  values: unknown[];
  state: RowState;
  group?: number;
  badge?: string;
  cellNotes?: Record<number, string>;
}

export interface GhostTable {
  id: string;
  title: string;
  x: number;
  y: number;
  columns: GhostColumn[];
  rows: GhostRow[];
  dashed?: boolean;
  opacity?: number;
  // сколько строк стадии не нарисовано (сжатый режим)
  hiddenRows?: number;
}

export type Decoration =
  | { kind: 'pair-line'; id: string; from: { table: string; row: RowKey; col: string }; to: { table: string; row: RowKey; col: string } }
  | { kind: 'scanner'; table: string; rowIndex: number }
  | { kind: 'scissors'; table: string; afterRow: number }
  | { kind: 'counter'; id: string; x: number; y: number; text: string }
  | { kind: 'bracket'; table: string; fromRow: number; toRow: number; color: number; label?: string }
  | { kind: 'arrow'; id: string; from: { x: number; y: number }; to: { x: number; y: number }; tone: 'info' | 'danger' };

export interface Frame {
  tables: GhostTable[];
  decorations: Decoration[];
  camera?: { x: number; y: number; width: number; height: number };
}

export interface Phase {
  id: string;
  stageIndex: number;
  caption: string;
  durationMs: number;
  frame: Frame;
}

export interface AnimatorContext {
  nodeRect(tableId: string): { x: number; y: number; width: number; height: number } | null;
  workArea: { x: number; y: number };
  schema: SchemaSnapshot;
}

export type Animator<S extends Stage = Stage> = (
  prev: Frame,
  stage: S,
  stageIndex: number,
  ctx: AnimatorContext,
) => Phase[];

export interface Playback {
  phases: Phase[];
  stageStarts: number[];
}

// Удобный тип: стадия конкретного вида
export type StageOf<K extends Stage['kind']> = Extract<Stage, { kind: K }>;
```

- [ ] **Step 2: Подключить тесты сторов к проекту dom**

В `vitest.config.ts` в проекте `dom` массив `include` должен содержать `'src/stores/**/*.test.ts'` (сторы используют `localStorage` через `persist`, поэтому нужен jsdom). Пример итогового блока проекта:

```ts
{
  extends: true,
  test: {
    name: 'dom',
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/stores/**/*.test.ts'],
    setupFiles: ['./tests/setup-dom.ts'],
  },
},
```

Если `setupFiles` в проекте не было, строку не добавлять.

- [ ] **Step 3: Написать падающий тест стора**

`src/stores/scene.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { Phase, Playback } from '@/features/overlay/types';
import type { Trace } from '@/features/tracer/types';
import { effectiveSpeed, useSceneStore } from './scene';

const frame = { tables: [], decorations: [] };
const phase = (i: number): Phase => ({ id: `p${i}`, stageIndex: 0, caption: `фаза ${i}`, durationMs: 500, frame });
const playback = (n: number): Playback => ({ phases: Array.from({ length: n }, (_, i) => phase(i)), stageStarts: [0] });
const trace = { sql: 'select 1', stages: [], mode: 'full' } as unknown as Trace;

describe('useSceneStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useSceneStore.setState(useSceneStore.getInitialState(), true);
  });

  it('setTrace игнорирует устаревшее поколение', () => {
    const g1 = useSceneStore.getState().nextGeneration();
    const g2 = useSceneStore.getState().nextGeneration();
    useSceneStore.getState().setTrace(trace, g2);
    useSceneStore.getState().setTrace({ ...trace, sql: 'old' }, g1);
    expect(useSceneStore.getState().trace?.sql).toBe('select 1');
  });

  it('setPlayback сбрасывает индекс и запускает автоплей заново', () => {
    const s = useSceneStore.getState();
    s.setAutoplay(true);
    s.setPlayback(playback(5));
    s.advance();
    s.advance();
    expect(useSceneStore.getState().phaseIndex).toBe(2);
    useSceneStore.getState().setPlayback(playback(2));
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(0);
    expect(st.playing).toBe(true);
    expect(st.autoRun).toBe(true);
    expect(st.instant).toBe(true);
  });

  it('без автоплея setPlayback сразу показывает последнюю фазу', () => {
    useSceneStore.getState().setAutoplay(false);
    useSceneStore.getState().setPlayback(playback(4));
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(3);
    expect(st.playing).toBe(false);
  });

  it('advance на последней фазе останавливает плеер и снимает autoRun', () => {
    useSceneStore.getState().setAutoplay(true);
    useSceneStore.getState().setPlayback(playback(2));
    useSceneStore.getState().advance();
    expect(useSceneStore.getState().phaseIndex).toBe(1);
    useSceneStore.getState().advance();
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(1);
    expect(st.playing).toBe(false);
    expect(st.autoRun).toBe(false);
  });

  it('seek мгновенный, ставит паузу и ограничивает индекс', () => {
    useSceneStore.getState().setPlayback(playback(3));
    useSceneStore.getState().play();
    useSceneStore.getState().seek(10);
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(2);
    expect(st.instant).toBe(true);
    expect(st.playing).toBe(false);
  });

  it('step назад мгновенный, вперёд анимированный', () => {
    useSceneStore.getState().setAutoplay(false);
    useSceneStore.getState().setPlayback(playback(3));
    useSceneStore.getState().step(-1);
    expect(useSceneStore.getState().phaseIndex).toBe(1);
    expect(useSceneStore.getState().instant).toBe(true);
    useSceneStore.getState().step(1);
    expect(useSceneStore.getState().phaseIndex).toBe(2);
    expect(useSceneStore.getState().instant).toBe(false);
  });

  it('play на последней фазе начинает с начала', () => {
    useSceneStore.getState().setAutoplay(false);
    useSceneStore.getState().setPlayback(playback(3));
    useSceneStore.getState().play();
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(0);
    expect(st.playing).toBe(true);
  });

  it('effectiveSpeed при autoRun не меньше 2', () => {
    useSceneStore.getState().setSpeed(0.5);
    useSceneStore.getState().setAutoplay(true);
    useSceneStore.getState().setPlayback(playback(3));
    expect(effectiveSpeed(useSceneStore.getState())).toBe(2);
    useSceneStore.getState().pause();
    expect(effectiveSpeed(useSceneStore.getState())).toBe(0.5);
  });

  it('close очищает сцену', () => {
    useSceneStore.getState().setTrace(trace, useSceneStore.getState().nextGeneration());
    useSceneStore.getState().setPlayback(playback(3));
    useSceneStore.getState().close();
    const st = useSceneStore.getState();
    expect(st.trace).toBeNull();
    expect(st.playback).toBeNull();
    expect(st.playing).toBe(false);
    expect(st.status).toBe('idle');
  });

  it('speed, autoplay и followCamera сохраняются в localStorage', () => {
    useSceneStore.getState().setSpeed(2);
    useSceneStore.getState().setFollowCamera(false);
    const saved = JSON.parse(localStorage.getItem('vs-scene') ?? '{}');
    expect(saved.state).toEqual({ speed: 2, autoplay: true, followCamera: false });
  });
});
```

- [ ] **Step 4: Запустить тест, убедиться что падает**

Run: `pnpm vitest run --project dom src/stores/scene.test.ts`
Expected: FAIL (`setPlayback is not a function` или `Cannot find module './scene'`).

- [ ] **Step 5: Реализовать стор**

`src/stores/scene.ts` (полный файл; если файл уже был создан в Ф4/Ф5, заменить его этим содержимым, поля контракта сохранены):

```ts
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Playback } from '@/features/overlay/types';
import type { Trace } from '@/features/tracer/types';

export interface SceneStore {
  trace: Trace | null;
  generation: number;
  status: 'idle' | 'tracing' | 'ready' | 'error';
  stale: boolean;
  playback: Playback | null;
  phaseIndex: number;
  playing: boolean;
  // true: следующий кадр показать без анимации (скраб, шаг назад, новая сцена)
  instant: boolean;
  // true: идёт автопроигрывание после правки запроса (скорость не меньше 2x)
  autoRun: boolean;
  speed: 0.5 | 1 | 2;
  autoplay: boolean;
  followCamera: boolean;
  nextGeneration(): number;
  setTrace(trace: Trace, generation: number): void;
  setStatus(s: SceneStore['status']): void;
  setStale(v: boolean): void;
  setPlayback(p: Playback | null): void;
  seek(phaseIndex: number): void;
  advance(): void;
  play(): void;
  pause(): void;
  toggle(): void;
  step(delta: 1 | -1): void;
  setSpeed(s: 0.5 | 1 | 2): void;
  setAutoplay(v: boolean): void;
  setFollowCamera(v: boolean): void;
  close(): void;
}

const lastIndex = (p: Playback | null) => (p ? Math.max(0, p.phases.length - 1) : 0);

export const useSceneStore = create<SceneStore>()(
  persist(
    (set, get) => ({
      trace: null,
      generation: 0,
      status: 'idle',
      stale: false,
      playback: null,
      phaseIndex: 0,
      playing: false,
      instant: true,
      autoRun: false,
      speed: 1,
      autoplay: true,
      followCamera: true,

      nextGeneration() {
        const generation = get().generation + 1;
        set({ generation });
        return generation;
      },

      setTrace(trace, generation) {
        // устаревшая трасса (пользователь уже допечатал) выбрасывается
        if (generation < get().generation) return;
        set({ trace, status: 'ready', stale: false, playback: null, phaseIndex: 0, playing: false, autoRun: false, instant: true });
      },

      setStatus(status) {
        set({ status });
      },

      setStale(stale) {
        set({ stale });
      },

      setPlayback(playback) {
        if (!playback || playback.phases.length === 0) {
          set({ playback, phaseIndex: 0, playing: false, autoRun: false, instant: true });
          return;
        }
        if (get().autoplay) {
          set({ playback, phaseIndex: 0, playing: true, autoRun: true, instant: true });
        } else {
          set({ playback, phaseIndex: lastIndex(playback), playing: false, autoRun: false, instant: true });
        }
      },

      seek(index) {
        const max = lastIndex(get().playback);
        set({ phaseIndex: Math.min(Math.max(0, index), max), instant: true, playing: false, autoRun: false });
      },

      advance() {
        const { phaseIndex, playback } = get();
        if (phaseIndex < lastIndex(playback)) {
          set({ phaseIndex: phaseIndex + 1, instant: false });
        } else {
          set({ playing: false, autoRun: false });
        }
      },

      play() {
        const { phaseIndex, playback } = get();
        if (!playback || playback.phases.length === 0) return;
        if (phaseIndex >= lastIndex(playback)) {
          set({ phaseIndex: 0, instant: true, playing: true, autoRun: false });
        } else {
          set({ playing: true, autoRun: false });
        }
      },

      pause() {
        set({ playing: false, autoRun: false });
      },

      toggle() {
        if (get().playing) get().pause();
        else get().play();
      },

      step(delta) {
        const { phaseIndex, playback } = get();
        const next = Math.min(Math.max(0, phaseIndex + delta), lastIndex(playback));
        // назад показываем мгновенно, вперёд анимируем
        set({ phaseIndex: next, instant: delta < 0, playing: false, autoRun: false });
      },

      setSpeed(speed) {
        set({ speed });
      },

      setAutoplay(autoplay) {
        set({ autoplay });
      },

      setFollowCamera(followCamera) {
        set({ followCamera });
      },

      close() {
        set({ trace: null, playback: null, phaseIndex: 0, playing: false, autoRun: false, instant: true, status: 'idle', stale: false });
      },
    }),
    {
      name: 'vs-scene',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ speed: s.speed, autoplay: s.autoplay, followCamera: s.followCamera }),
    },
  ),
);

// Скорость с учётом автопроигрывания: после правки запроса не медленнее 2x
export function effectiveSpeed(s: Pick<SceneStore, 'speed' | 'autoRun'>): number {
  return s.autoRun ? Math.max(2, s.speed) : s.speed;
}
```

- [ ] **Step 6: Запустить тест, убедиться что проходит**

Run: `pnpm vitest run --project dom src/stores/scene.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 7: Проверки и трекер**

Run: `pnpm check`
Expected: все этапы зелёные.

В `docs/PROGRESS.md` поставить `✅ (<дата>)` у пункта **P6.4**.

- [ ] **Step 8: Commit**

```bash
git add src/features/overlay/types.ts src/stores/scene.ts src/stores/scene.test.ts vitest.config.ts docs/PROGRESS.md
git commit -m "feat(overlay): типы кадров и проигрывание в сторе сцены

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Геометрия и форматирование значений

**Files:**
- Create: `src/features/overlay/geometry.ts`, `src/features/overlay/format.ts`
- Test: `src/features/overlay/geometry.test.ts`, `src/features/overlay/format.test.ts`

**Interfaces:**
- Consumes: `GhostTable`, `Frame`, `Decoration` (задача 1).
- Produces:
  - константы `COL_WIDTH = 132`, `TITLE_HEIGHT = 32`, `COLHEAD_HEIGHT = 28`, `ROW_H = 26`, `TABLE_GAP = 80`, `COMPRESS_THRESHOLD = 200`, `COMPRESSED_VISIBLE_ROWS = 20`;
  - `ghostWidth(t: GhostTable): number`, `ghostHeight(t: GhostTable): number`, `rowTop(index: number): number` (относительно таблицы), `cellLeft(colIndex: number): number`, `frameBounds(frame: Frame): { x: number; y: number; width: number; height: number } | null`, `cellCenter(t: GhostTable, rowKey: string, colName: string): { x: number; y: number } | null`, `columnKeys(cols: { name: string }[]): string[]`;
  - `formatValue(v: unknown): { text: string; isNull: boolean }`.

- [ ] **Step 1: Написать падающие тесты**

`src/features/overlay/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatValue } from './format';

describe('formatValue', () => {
  it('NULL и пустая строка различаются', () => {
    expect(formatValue(null)).toEqual({ text: 'NULL', isNull: true });
    expect(formatValue(undefined)).toEqual({ text: 'NULL', isNull: true });
    expect(formatValue('')).toEqual({ text: "''", isNull: false });
  });

  it('числа, строки, boolean, bigint', () => {
    expect(formatValue('890.00').text).toBe('890.00');
    expect(formatValue(42).text).toBe('42');
    expect(formatValue(true).text).toBe('true');
    expect(formatValue(10n).text).toBe('10');
  });

  it('дата в ISO без миллисекунд, объекты в JSON', () => {
    expect(formatValue(new Date('2024-03-01T07:00:00.000Z')).text).toBe('2024-03-01 07:00:00Z');
    expect(formatValue({ lang: 'ru' }).text).toBe('{"lang":"ru"}');
    expect(formatValue(['a', 'b']).text).toBe('{a,b}');
  });

  it('длинный текст обрезается до 40 символов', () => {
    const t = formatValue('а'.repeat(60)).text;
    expect(t.length).toBe(40);
    expect(t.endsWith('…')).toBe(true);
  });
});
```

`src/features/overlay/geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  COL_WIDTH, COLHEAD_HEIGHT, ROW_H, TITLE_HEIGHT,
  cellCenter, columnKeys, frameBounds, ghostHeight, ghostWidth, rowTop,
} from './geometry';
import type { GhostTable } from './types';

const table = (over: Partial<GhostTable> = {}): GhostTable => ({
  id: 't:b', title: 'book', x: 100, y: 50,
  columns: [{ name: 'title', state: 'normal' }, { name: 'price', state: 'normal' }],
  rows: [
    { key: 'b=(0,1)', values: ['Тихий Дон', '890.00'], state: 'normal' },
    { key: 'b=(0,2)', values: ['Python', '2400.00'], state: 'normal' },
  ],
  ...over,
});

describe('geometry', () => {
  it('ширина по числу колонок, высота по строкам', () => {
    expect(ghostWidth(table())).toBe(2 * COL_WIDTH);
    expect(ghostHeight(table())).toBe(TITLE_HEIGHT + COLHEAD_HEIGHT + 2 * ROW_H);
  });

  it('полоса скрытых строк добавляет одну строку высоты', () => {
    expect(ghostHeight(table({ hiddenRows: 300 }))).toBe(TITLE_HEIGHT + COLHEAD_HEIGHT + 3 * ROW_H);
  });

  it('пустая таблица всё равно имеет ширину одной колонки', () => {
    expect(ghostWidth(table({ columns: [] }))).toBe(COL_WIDTH);
  });

  it('rowTop считает от верха таблицы', () => {
    expect(rowTop(0)).toBe(TITLE_HEIGHT + COLHEAD_HEIGHT);
    expect(rowTop(3)).toBe(TITLE_HEIGHT + COLHEAD_HEIGHT + 3 * ROW_H);
  });

  it('frameBounds объединяет все таблицы', () => {
    const a = table();
    const b = table({ id: 't:a', x: 600, y: 0 });
    expect(frameBounds({ tables: [a, b], decorations: [] })).toEqual({
      x: 100, y: 0, width: 600 + ghostWidth(b) - 100, height: 50 + ghostHeight(a),
    });
    expect(frameBounds({ tables: [], decorations: [] })).toBeNull();
  });

  it('frameBounds берёт camera, если она задана', () => {
    const camera = { x: 1, y: 2, width: 3, height: 4 };
    expect(frameBounds({ tables: [table()], decorations: [], camera })).toEqual(camera);
  });

  it('cellCenter находит ячейку по ключу строки и имени колонки', () => {
    expect(cellCenter(table(), 'b=(0,2)', 'price')).toEqual({
      x: 100 + COL_WIDTH + COL_WIDTH / 2,
      y: 50 + rowTop(1) + ROW_H / 2,
    });
    expect(cellCenter(table(), 'нет', 'price')).toBeNull();
  });

  it('columnKeys различает одноимённые колонки', () => {
    expect(columnKeys([{ name: 'a' }, { name: 'b' }, { name: 'a' }])).toEqual(['a', 'b', 'a#2']);
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `pnpm vitest run --project node src/features/overlay/geometry.test.ts src/features/overlay/format.test.ts`
Expected: FAIL (`Cannot find module './geometry'`, `'./format'`).

- [ ] **Step 3: Реализовать**

`src/features/overlay/format.ts`:

```ts
const MAX_LEN = 40;

// Текст ячейки призрака. NULL отдельно от пустой строки: на сцене это разные вещи
export function formatValue(v: unknown): { text: string; isNull: boolean } {
  if (v === null || v === undefined) return { text: 'NULL', isNull: true };
  let text: string;
  if (typeof v === 'string') text = v === '' ? "''" : v;
  else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') text = String(v);
  else if (v instanceof Date) text = v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
  else if (Array.isArray(v)) text = `{${v.map((x) => (x === null ? 'NULL' : String(x))).join(',')}}`;
  else text = JSON.stringify(v);
  if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN - 1)}…`;
  return { text, isNull: false };
}
```

`src/features/overlay/geometry.ts`:

```ts
import type { Frame, GhostTable } from './types';

export const COL_WIDTH = 132;
export const TITLE_HEIGHT = 32;
export const COLHEAD_HEIGHT = 28;
export const ROW_H = 26;
export const TABLE_GAP = 80;
export const COMPRESS_THRESHOLD = 200;
export const COMPRESSED_VISIBLE_ROWS = 20;

export function ghostWidth(t: GhostTable): number {
  return Math.max(1, t.columns.length) * COL_WIDTH;
}

export function ghostHeight(t: GhostTable): number {
  const band = t.hiddenRows ? 1 : 0;
  return TITLE_HEIGHT + COLHEAD_HEIGHT + (t.rows.length + band) * ROW_H;
}

// Верх строки относительно верха таблицы
export function rowTop(index: number): number {
  return TITLE_HEIGHT + COLHEAD_HEIGHT + index * ROW_H;
}

export function cellLeft(colIndex: number): number {
  return colIndex * COL_WIDTH;
}

export function frameBounds(frame: Frame): { x: number; y: number; width: number; height: number } | null {
  if (frame.camera) return frame.camera;
  if (frame.tables.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const t of frame.tables) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + ghostWidth(t));
    maxY = Math.max(maxY, t.y + ghostHeight(t));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Центр ячейки в координатах доски (для линий пар и стрелок)
export function cellCenter(t: GhostTable, rowKey: string, colName: string): { x: number; y: number } | null {
  const rowIndex = t.rows.findIndex((r) => r.key === rowKey);
  const colIndex = t.columns.findIndex((c) => c.name === colName);
  if (rowIndex === -1 || colIndex === -1) return null;
  return { x: t.x + cellLeft(colIndex) + COL_WIDTH / 2, y: t.y + rowTop(rowIndex) + ROW_H / 2 };
}

// Стабильные ключи колонок: одноимённые получают суффикс #2, #3
export function columnKeys(cols: { name: string }[]): string[] {
  const seen = new Map<string, number>();
  return cols.map((c) => {
    const n = (seen.get(c.name) ?? 0) + 1;
    seen.set(c.name, n);
    return n === 1 ? c.name : `${c.name}#${n}`;
  });
}
```

- [ ] **Step 4: Запустить, убедиться что проходят**

Run: `pnpm vitest run --project node src/features/overlay/geometry.test.ts src/features/overlay/format.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/overlay/geometry.ts src/features/overlay/format.ts src/features/overlay/geometry.test.ts src/features/overlay/format.test.ts
git commit -m "feat(overlay): геометрия призраков и форматирование ячеек

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Операции над кадром, фикстуры трасс и аниматор scan

**Files:**
- Create: `src/features/overlay/frame.ts`, `src/features/overlay/labels.ts`, `src/features/overlay/__fixtures__/traces.ts`, `src/features/overlay/animators/scan.ts`
- Test: `src/features/overlay/frame.test.ts`, `src/features/overlay/animators/scan.test.ts`

**Interfaces:**
- Consumes: типы задачи 1, геометрия задачи 2; `Relation`, `Row`, `Stage`, `Trace` из `@/features/tracer/types`.
- Produces:
  - `frame.ts`: `currentTable(frame): GhostTable | null`, `withTable(frame, table): Frame`, `ghostRows(rows: Row[], state?: RowState): { rows: GhostRow[]; hiddenRows: number }`, `rebuildTable(base: Pick<GhostTable,'id'|'title'|'x'|'y'>, rel: Relation, order?: RowKey[]): GhostTable`, `clearMarks(t): GhostTable`, `mapRows(t, fn): GhostTable`, `mapColumns(t, fn): GhostTable`, `totalRows(t): number`, `counterNear(t, id, text): Decoration`;
  - `labels.ts`: `stageLabel(stage: Stage): string`, `tableTitle(tableId: string, alias: string): string`;
  - фикстуры `bookScan()`, `fullPipelineTrace()`, `distinctTrace()`, `bigFilterTrace(n)`, `testCtx(rects?)` (`AnimatorContext` для тестов);
  - `scanAnimator: Animator<StageOf<'scan'>>`.

- [ ] **Step 1: Создать фикстуры трасс**

`src/features/overlay/__fixtures__/traces.ts` (данные совпадают с датасетом bookstore; numeric приходит из PGlite строкой):

```ts
import type { SchemaSnapshot } from '@/features/db/introspect';
import type { Relation, Row, Stage, Trace } from '@/features/tracer/types';
import type { AnimatorContext } from '../types';

const bookColumns = [
  { name: 'book_id', type: 'int8', source: { alias: 'b', column: 'book_id' } },
  { name: 'title', type: 'text', source: { alias: 'b', column: 'title' } },
  { name: 'price', type: 'numeric', source: { alias: 'b', column: 'price' } },
];

const row = (ctid: string, values: unknown[]): Row => ({ key: `b=${ctid}`, lineage: { b: ctid }, values });

// Пять книг: одна без цены (NULL), одна дешёвая
export const BOOKS: Row[] = [
  row('(0,1)', [1, 'Тихий Дон', '890.00']),
  row('(0,2)', [2, 'Python. К вершинам мастерства', '2400.00']),
  row('(0,3)', [3, 'Судьба человека', '350.00']),
  row('(0,7)', [7, 'Остров погибших кораблей', null]),
  row('(0,8)', [8, 'Путешествие к центру Земли', '610.00']),
];

export function bookScan(): Extract<Stage, { kind: 'scan' }> {
  return {
    id: 's0', kind: 'scan', alias: 'b', tableId: 'public.book',
    caption: 'FROM book: 5 строк', output: { columns: bookColumns, rows: BOOKS },
  };
}

const pick = (keys: string[]) => keys.map((k) => BOOKS.find((r) => r.key === k) as Row);

// select title, price, price * 0.9 as sale from book b where price > 500 order by price desc limit 2
export function fullPipelineTrace(): Trace {
  const afterWhere: Relation = { columns: bookColumns, rows: pick(['b=(0,1)', 'b=(0,2)', 'b=(0,8)']) };
  const projColumns = [
    { name: 'title', type: 'text', source: { alias: 'b', column: 'title' } },
    { name: 'price', type: 'numeric', source: { alias: 'b', column: 'price' } },
    { name: 'sale', type: 'numeric' },
  ];
  const proj = (k: string, title: string, price: string, sale: string): Row => ({ key: k, lineage: { b: k.slice(2) }, values: [title, price, sale] });
  const projected: Row[] = [
    proj('b=(0,1)', 'Тихий Дон', '890.00', '801.000'),
    proj('b=(0,2)', 'Python. К вершинам мастерства', '2400.00', '2160.000'),
    proj('b=(0,8)', 'Путешествие к центру Земли', '610.00', '549.000'),
  ];
  const sorted = [projected[1], projected[0], projected[2]];
  const stages: Stage[] = [
    bookScan(),
    {
      id: 's1', kind: 'filter', clause: 'where', predicateColumns: ['price'],
      verdicts: { 'b=(0,1)': true, 'b=(0,2)': true, 'b=(0,3)': false, 'b=(0,7)': null, 'b=(0,8)': true },
      caption: 'WHERE price > 500: осталось 3 из 5', output: afterWhere,
    },
    {
      id: 's2', kind: 'project', kept: ['title', 'price'], removed: ['book_id'], computed: ['sale'], renamed: {},
      caption: 'SELECT: 3 колонки', output: { columns: projColumns, rows: projected },
    },
    {
      id: 's3', kind: 'sort', order: sorted.map((r) => r.key), sortKeys: ['price'],
      caption: 'ORDER BY price DESC', output: { columns: projColumns, rows: sorted },
    },
    {
      id: 's4', kind: 'limit', kept: ['b=(0,2)', 'b=(0,1)'], cut: ['b=(0,8)'], limit: 2, offset: 0,
      caption: 'LIMIT 2: осталось 2 из 3', output: { columns: projColumns, rows: sorted.slice(0, 2) },
    },
  ];
  return {
    sql: 'select title, price, price * 0.9 as sale from book b where price > 500 order by price desc limit 2',
    statementType: 'select', mode: 'full', touched: { tableIds: ['public.book'], columns: ['public.book.price'] },
    stages, result: null, error: null, notices: [], timingMs: 12,
  };
}

// select distinct price from book b (только цены, у двух книг цена 610)
export function distinctTrace(): Trace {
  const priceCol = [{ name: 'price', type: 'numeric' }];
  const r = (k: string, p: string | null): Row => ({ key: k, lineage: { b: k.slice(2) }, values: [p] });
  const projected = [r('b=(0,1)', '890.00'), r('b=(0,8)', '610.00'), r('b=(0,9)', '610.00'), r('b=(0,7)', null)];
  const scanRows: Row[] = projected.map((p, i) => ({ ...p, values: [i, `книга ${i}`, p.values[0]] }));
  const stages: Stage[] = [
    { ...bookScan(), output: { columns: bookColumns, rows: scanRows }, caption: 'FROM book: 4 строки' },
    { id: 's1', kind: 'project', kept: ['price'], removed: ['book_id', 'title'], computed: [], renamed: {}, caption: 'SELECT price', output: { columns: priceCol, rows: projected } },
    {
      id: 's2', kind: 'distinct', on: null,
      stacks: [
        { winner: 'b=(0,1)', members: ['b=(0,1)'] },
        { winner: 'b=(0,8)', members: ['b=(0,8)', 'b=(0,9)'] },
        { winner: 'b=(0,7)', members: ['b=(0,7)'] },
      ],
      caption: 'DISTINCT: 3 уникальных из 4',
      output: { columns: priceCol, rows: [projected[0], projected[1], projected[3]] },
    },
  ];
  return { ...fullPipelineTrace(), sql: 'select distinct price from book b', stages };
}

// Большая стадия: n строк, WHERE оставляет чётные
export function bigFilterTrace(n: number): Trace {
  const rows: Row[] = Array.from({ length: n }, (_, i) => ({
    key: `b=(${Math.floor(i / 100)},${(i % 100) + 1})`, lineage: { b: `(${Math.floor(i / 100)},${(i % 100) + 1})` }, values: [i, `книга ${i}`, String(i)],
  }));
  const verdicts: Record<string, boolean> = {};
  rows.forEach((r, i) => { verdicts[r.key] = i % 2 === 0; });
  const kept = rows.filter((_, i) => i % 2 === 0);
  const stages: Stage[] = [
    { ...bookScan(), output: { columns: bookColumns, rows }, caption: `FROM book: ${n} строк`, compressed: n > 200 },
    { id: 's1', kind: 'filter', clause: 'where', predicateColumns: ['price'], verdicts, caption: `WHERE: осталось ${kept.length} из ${n}`, output: { columns: bookColumns, rows: kept } },
  ];
  return { ...fullPipelineTrace(), stages };
}

export const EMPTY_SCHEMA: SchemaSnapshot = { schemas: ['public'], tables: [], fks: [], sequences: [] };

// Контекст аниматоров для тестов: book стоит в (0, 0), рабочая зона справа
export function testCtx(rects: Record<string, { x: number; y: number; width: number; height: number }> = {
  'public.book': { x: 0, y: 0, width: 260, height: 400 },
}): AnimatorContext {
  return { nodeRect: (id) => rects[id] ?? null, workArea: { x: 500, y: 0 }, schema: EMPTY_SCHEMA };
}
```

- [ ] **Step 2: Написать падающие тесты**

`src/features/overlay/frame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BOOKS, bookScan } from './__fixtures__/traces';
import { clearMarks, currentTable, ghostRows, mapRows, rebuildTable, totalRows, withTable } from './frame';
import { COMPRESSED_VISIBLE_ROWS } from './geometry';
import { stageLabel, tableTitle } from './labels';

const base = { id: 't:b', title: 'book', x: 10, y: 20 };

describe('frame', () => {
  it('rebuildTable переносит колонки и строки, порядок по order', () => {
    const t = rebuildTable(base, bookScan().output, ['b=(0,8)', 'b=(0,1)']);
    expect(t.columns.map((c) => c.name)).toEqual(['book_id', 'title', 'price']);
    expect(t.rows.map((r) => r.key).slice(0, 2)).toEqual(['b=(0,8)', 'b=(0,1)']);
    expect(t.rows).toHaveLength(5);
    expect(t.hiddenRows).toBe(0);
  });

  it('ghostRows сжимает больше 200 строк до 20', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ ...BOOKS[0], key: `k${i}` }));
    const { rows, hiddenRows } = ghostRows(many);
    expect(rows).toHaveLength(COMPRESSED_VISIBLE_ROWS);
    expect(hiddenRows).toBe(230);
  });

  it('ровно 200 строк не сжимаются', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...BOOKS[0], key: `k${i}` }));
    expect(ghostRows(many).hiddenRows).toBe(0);
  });

  it('withTable заменяет таблицу с тем же id и добавляет новую', () => {
    const t = rebuildTable(base, bookScan().output);
    const f1 = withTable({ tables: [], decorations: [] }, t);
    const f2 = withTable(f1, { ...t, x: 99 });
    expect(f2.tables).toHaveLength(1);
    expect(currentTable(f2)?.x).toBe(99);
  });

  it('clearMarks снимает состояния, бейджи и группы', () => {
    const t = mapRows(rebuildTable(base, bookScan().output), () => ({ state: 'dropped', badge: '×2', group: 1 }));
    const c = clearMarks(t);
    expect(c.rows.every((r) => r.state === 'normal' && r.badge === undefined && r.group === undefined)).toBe(true);
  });

  it('totalRows учитывает скрытые строки', () => {
    expect(totalRows({ ...rebuildTable(base, bookScan().output), hiddenRows: 10 })).toBe(15);
  });

  it('подписи стадий и названия таблиц', () => {
    expect(stageLabel(bookScan())).toBe('FROM');
    expect(tableTitle('public.book', 'b')).toBe('book b');
    expect(tableTitle('public.book', 'book')).toBe('book');
    expect(tableTitle('shop.orders', 'o')).toBe('shop.orders o');
  });
});
```

`src/features/overlay/animators/scan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bookScan, testCtx } from '../__fixtures__/traces';
import { scanAnimator } from './scan';

describe('scanAnimator', () => {
  it('призрак появляется поверх ноды и уезжает в рабочую зону', () => {
    const phases = scanAnimator({ tables: [], decorations: [] }, bookScan(), 0, testCtx());
    expect(phases).toHaveLength(2);
    const [appear, move] = phases;
    expect(appear.frame.tables[0]).toMatchObject({ id: 't:b', title: 'book b', x: 0, y: 0 });
    expect(move.frame.tables[0]).toMatchObject({ x: 500, y: 0 });
    expect(move.frame.tables[0].rows).toHaveLength(5);
    expect(move.caption).toBe('FROM book: 5 строк');
    expect(phases.every((p) => p.stageIndex === 0)).toBe(true);
    expect(phases.every((p) => p.durationMs >= 400 && p.durationMs <= 900)).toBe(true);
  });

  it('без ноды на доске призрак сразу появляется в рабочей зоне', () => {
    const phases = scanAnimator({ tables: [], decorations: [] }, bookScan(), 0, testCtx({}));
    expect(phases[0].frame.tables[0]).toMatchObject({ x: 500, y: 0 });
  });

  it('второй scan встаёт правее первого', () => {
    const first = scanAnimator({ tables: [], decorations: [] }, bookScan(), 0, testCtx());
    const second = scanAnimator(first[1].frame, { ...bookScan(), alias: 'b2' }, 1, testCtx());
    const tables = second[1].frame.tables;
    expect(tables).toHaveLength(2);
    expect(tables[1].x).toBeGreaterThan(tables[0].x + 3 * 132);
  });
});
```

- [ ] **Step 3: Запустить, убедиться что падают**

Run: `pnpm vitest run --project node src/features/overlay/frame.test.ts src/features/overlay/animators/scan.test.ts`
Expected: FAIL (`Cannot find module './frame'`, `'./scan'`).

- [ ] **Step 4: Реализовать**

`src/features/overlay/labels.ts`:

```ts
import type { Stage } from '@/features/tracer/types';

// Короткое название стадии для чипа таймлайна и подсказок
export function stageLabel(stage: Stage): string {
  switch (stage.kind) {
    case 'scan': return 'FROM';
    case 'join': return stage.joinType === 'cross' ? 'CROSS JOIN' : `${stage.joinType.toUpperCase()} JOIN`;
    case 'filter': return stage.clause === 'where' ? 'WHERE' : 'HAVING';
    case 'group': return 'GROUP BY';
    case 'window': return 'OVER';
    case 'project': return 'SELECT';
    case 'distinct': return 'DISTINCT';
    case 'sort': return 'ORDER BY';
    case 'limit': return 'LIMIT';
    case 'setop': return stage.op.toUpperCase();
    case 'materialize': return `WITH ${stage.name}`;
    case 'recursion': return `RECURSIVE ${stage.name}`;
    case 'subquery': return 'ПОДЗАПРОС';
    case 'dml': return stage.op.toUpperCase();
    case 'ddl': return 'DDL';
    case 'error': return 'ОШИБКА';
  }
}

// 'public.book' + 'b' → 'book b'; схема показывается, если она не public
export function tableTitle(tableId: string, alias: string): string {
  const [schema, name] = tableId.includes('.') ? tableId.split('.', 2) : ['public', tableId];
  const shown = schema === 'public' ? name : `${schema}.${name}`;
  return alias === name ? shown : `${shown} ${alias}`;
}
```

`src/features/overlay/frame.ts`:

```ts
import type { Relation, Row, RowKey } from '@/features/tracer/types';
import { COMPRESS_THRESHOLD, COMPRESSED_VISIBLE_ROWS, ghostWidth } from './geometry';
import type { Decoration, Frame, GhostColumn, GhostRow, GhostTable, RowState } from './types';

// Рабочая таблица сцены: последняя добавленная
export function currentTable(frame: Frame): GhostTable | null {
  return frame.tables.length ? frame.tables[frame.tables.length - 1] : null;
}

export function withTable(frame: Frame, table: GhostTable): Frame {
  const idx = frame.tables.findIndex((t) => t.id === table.id);
  const tables = idx === -1 ? [...frame.tables, table] : frame.tables.map((t, i) => (i === idx ? table : t));
  return { ...frame, tables };
}

// Сжатый режим: больше 200 строк рисуем первые 20, остальное считаем
export function ghostRows(rows: Row[], state: RowState = 'normal'): { rows: GhostRow[]; hiddenRows: number } {
  const visible = rows.length > COMPRESS_THRESHOLD ? rows.slice(0, COMPRESSED_VISIBLE_ROWS) : rows;
  return {
    rows: visible.map((r) => ({ key: r.key, values: r.values, state })),
    hiddenRows: rows.length - visible.length,
  };
}

// Пересборка таблицы из выхода стадии: это гарантирует, что кадр совпадает с данными Postgres
export function rebuildTable(
  base: Pick<GhostTable, 'id' | 'title' | 'x' | 'y'>,
  rel: Relation,
  order?: RowKey[],
): GhostTable {
  let rows = rel.rows;
  if (order) {
    const pos = new Map(order.map((k, i) => [k, i]));
    rows = [...rows].sort((a, b) => (pos.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.key) ?? Number.MAX_SAFE_INTEGER));
  }
  const g = ghostRows(rows);
  return {
    id: base.id, title: base.title, x: base.x, y: base.y,
    columns: rel.columns.map((c) => ({ name: c.name, type: c.type, state: 'normal' as const })),
    rows: g.rows,
    hiddenRows: g.hiddenRows,
  };
}

export function mapRows(t: GhostTable, fn: (r: GhostRow, i: number) => Partial<GhostRow>): GhostTable {
  return { ...t, rows: t.rows.map((r, i) => ({ ...r, ...fn(r, i) })) };
}

export function mapColumns(t: GhostTable, fn: (c: GhostColumn, i: number) => Partial<GhostColumn>): GhostTable {
  return { ...t, columns: t.columns.map((c, i) => ({ ...c, ...fn(c, i) })) };
}

export function clearMarks(t: GhostTable): GhostTable {
  return {
    ...t,
    columns: t.columns.map((c) => ({ ...c, state: 'normal' as const })),
    rows: t.rows.map(({ key, values }) => ({ key, values, state: 'normal' as const })),
  };
}

export function totalRows(t: GhostTable): number {
  return t.rows.length + (t.hiddenRows ?? 0);
}

// Счётчик «было → стало» справа от таблицы
export function counterNear(t: GhostTable, id: string, text: string): Decoration {
  return { kind: 'counter', id, x: t.x + ghostWidth(t) + 16, y: t.y, text };
}
```

`src/features/overlay/animators/scan.ts`:

```ts
import { rebuildTable } from '../frame';
import { TABLE_GAP, ghostWidth } from '../geometry';
import { tableTitle } from '../labels';
import type { Animator, Frame, StageOf } from '../types';

// FROM t: призрак отделяется от таблицы на доске и уезжает в рабочую зону
export const scanAnimator: Animator<StageOf<'scan'>> = (prev, stage, stageIndex, ctx) => {
  const id = `t:${stage.alias}`;
  const title = tableTitle(stage.tableId, stage.alias);
  const others = prev.tables.filter((t) => t.id !== id);
  // следующая таблица встаёт правее уже стоящих в рабочей зоне
  const targetX = others.reduce((x, t) => Math.max(x, t.x + ghostWidth(t) + TABLE_GAP), ctx.workArea.x);
  const rect = ctx.nodeRect(stage.tableId);
  const start = rebuildTable({ id, title, x: rect?.x ?? targetX, y: rect?.y ?? ctx.workArea.y }, stage.output);
  const moved = { ...start, x: targetX, y: ctx.workArea.y };
  const appear: Frame = { tables: [...others, start], decorations: [] };
  const placed: Frame = { tables: [...others, moved], decorations: [] };
  return [
    { id: `${stageIndex}:appear`, stageIndex, caption: `Берём таблицу ${title}`, durationMs: 500, frame: appear },
    { id: `${stageIndex}:place`, stageIndex, caption: stage.caption, durationMs: 700, frame: placed },
  ];
};
```

- [ ] **Step 5: Запустить, убедиться что проходят**

Run: `pnpm vitest run --project node src/features/overlay/frame.test.ts src/features/overlay/animators/scan.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/features/overlay/frame.ts src/features/overlay/labels.ts src/features/overlay/__fixtures__/traces.ts src/features/overlay/animators/scan.ts src/features/overlay/frame.test.ts src/features/overlay/animators/scan.test.ts
git commit -m "feat(overlay): операции над кадром и аниматор FROM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(P6.3 и P6.6 закрываются в задаче 11, когда призраки видны на настоящей доске.)

---

### Task 4: Аниматор WHERE / HAVING

**Files:**
- Create: `src/features/overlay/animators/filter.ts`
- Test: `src/features/overlay/animators/filter.test.ts`

**Interfaces:**
- Consumes: `currentTable`, `clearMarks`, `mapRows`, `mapColumns`, `rebuildTable`, `totalRows`, `counterNear` (задача 3); фикстуры `fullPipelineTrace`, `bigFilterTrace`, `testCtx`.
- Produces: `filterAnimator: Animator<StageOf<'filter'>>`. Фазы: `check` (подсветка колонок условия + сканер на первой строке), `verdicts` (kept / dropped / unknown с бейджем `UNKNOWN`, сканер на последней строке), `drop` (пересборка из `stage.output` + счётчик `было → стало`).

- [ ] **Step 1: Написать падающий тест**

`src/features/overlay/animators/filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bigFilterTrace, fullPipelineTrace, testCtx } from '../__fixtures__/traces';
import type { Frame, StageOf } from '../types';
import { filterAnimator } from './filter';
import { scanAnimator } from './scan';

function afterScan(trace = fullPipelineTrace()): Frame {
  const phases = scanAnimator({ tables: [], decorations: [] }, trace.stages[0] as StageOf<'scan'>, 0, testCtx());
  return phases[phases.length - 1].frame;
}

describe('filterAnimator', () => {
  const trace = fullPipelineTrace();
  const stage = trace.stages[1] as StageOf<'filter'>;
  const phases = filterAnimator(afterScan(), stage, 1, testCtx());

  it('три фазы: проверка, вердикты, отсев', () => {
    expect(phases.map((p) => p.id)).toEqual(['1:check', '1:verdicts', '1:drop']);
  });

  it('подсвечивает колонку условия и ставит сканер на первую строку', () => {
    const t = phases[0].frame.tables[0];
    expect(t.columns.find((c) => c.name === 'price')?.state).toBe('highlight');
    expect(phases[0].frame.decorations).toContainEqual({ kind: 'scanner', table: 't:b', rowIndex: 0 });
  });

  it('TRUE зелёные, FALSE красные, NULL серые с UNKNOWN', () => {
    const rows = phases[1].frame.tables[0].rows;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey['b=(0,1)'].state).toBe('kept');
    expect(byKey['b=(0,3)'].state).toBe('dropped');
    expect(byKey['b=(0,7)'].state).toBe('unknown');
    expect(byKey['b=(0,7)'].badge).toBe('UNKNOWN');
    expect(phases[1].frame.decorations).toContainEqual({ kind: 'scanner', table: 't:b', rowIndex: 4 });
    expect(phases[1].caption).toContain('UNKNOWN');
  });

  it('после отсева остались строки выхода стадии и счётчик 5 → 3', () => {
    const t = phases[2].frame.tables[0];
    expect(t.rows.map((r) => r.key)).toEqual(['b=(0,1)', 'b=(0,2)', 'b=(0,8)']);
    expect(t.rows.every((r) => r.state === 'normal')).toBe(true);
    expect(phases[2].frame.decorations).toContainEqual(expect.objectContaining({ kind: 'counter', text: '5 → 3' }));
    expect(phases[2].caption).toBe(stage.caption);
    expect(t.x).toBe(500);
  });

  it('HAVING подписывается как HAVING', () => {
    const p = filterAnimator(afterScan(), { ...stage, clause: 'having' }, 1, testCtx());
    expect(p[0].caption.startsWith('HAVING')).toBe(true);
  });

  it('сжатый режим: счётчик показывает настоящие числа', () => {
    const big = bigFilterTrace(2000);
    const p = filterAnimator(afterScan(big), big.stages[1] as StageOf<'filter'>, 1, testCtx());
    const last = p[p.length - 1].frame;
    expect(last.tables[0].rows).toHaveLength(20);
    expect(last.tables[0].hiddenRows).toBe(980);
    expect(last.decorations).toContainEqual(expect.objectContaining({ kind: 'counter', text: '2000 → 1000' }));
  });

  it('без рабочей таблицы ничего не ломает', () => {
    const p = filterAnimator({ tables: [], decorations: [] }, stage, 1, testCtx());
    expect(p).toHaveLength(1);
    expect(p[0].frame.tables[0].rows).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `pnpm vitest run --project node src/features/overlay/animators/filter.test.ts`
Expected: FAIL (`Cannot find module './filter'`).

- [ ] **Step 3: Реализовать**

Сначала общий фолбэк, нужен тут и дальше. `src/features/overlay/animators/generic.ts`:

```ts
import type { Stage } from '@/features/tracer/types';
import { currentTable, rebuildTable, withTable } from '../frame';
import type { Animator } from '../types';

// Стадия без своей анимации: таблица мгновенно принимает вид выхода стадии
export const genericAnimator: Animator<Stage> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  const base = cur ?? { id: `stage:${stageIndex}`, title: 'результат', x: ctx.workArea.x, y: ctx.workArea.y };
  const table = rebuildTable(base, stage.output);
  return [{ id: `${stageIndex}:result`, stageIndex, caption: stage.caption, durationMs: 500, frame: withTable({ ...prev, decorations: [] }, table) }];
};
```

`src/features/overlay/animators/filter.ts`:

```ts
import { clearMarks, counterNear, currentTable, mapColumns, mapRows, rebuildTable, totalRows, withTable } from '../frame';
import type { Animator, RowState, StageOf } from '../types';
import { genericAnimator } from './generic';

// WHERE / HAVING: сканер проходит строки, каждая получает вердикт, отсеянные уходят
export const filterAnimator: Animator<StageOf<'filter'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  const clause = stage.clause === 'where' ? 'WHERE' : 'HAVING';
  const before = totalRows(cur);

  const marked = mapColumns(clearMarks(cur), (c) => ({
    state: stage.predicateColumns.includes(c.name) ? 'highlight' : 'normal',
  }));
  const check = { tables: withTable(prev, marked).tables, decorations: [{ kind: 'scanner' as const, table: cur.id, rowIndex: 0 }] };

  let unknown = 0;
  const judged = mapRows(marked, (r) => {
    const v = stage.verdicts[r.key];
    if (v === null) {
      unknown += 1;
      return { state: 'unknown' as RowState, badge: 'UNKNOWN' };
    }
    if (v === false) return { state: 'dropped' as RowState };
    if (v === true) return { state: 'kept' as RowState };
    return {};
  });
  const verdicts = {
    tables: withTable(prev, judged).tables,
    decorations: [{ kind: 'scanner' as const, table: cur.id, rowIndex: Math.max(0, judged.rows.length - 1) }],
  };

  const result = rebuildTable(cur, stage.output);
  const after = stage.output.rows.length;
  const drop = {
    tables: withTable(prev, result).tables,
    decorations: [counterNear(result, `${stageIndex}:counter`, `${before} → ${after}`)],
  };

  const verdictCaption = unknown > 0
    ? `${clause}: зелёные прошли, красные нет, серые дали UNKNOWN и тоже уходят`
    : `${clause}: зелёные прошли условие, красные нет`;

  return [
    { id: `${stageIndex}:check`, stageIndex, caption: `${clause}: проверяем условие для каждой строки`, durationMs: 500, frame: check },
    { id: `${stageIndex}:verdicts`, stageIndex, caption: verdictCaption, durationMs: 900, frame: verdicts },
    { id: `${stageIndex}:drop`, stageIndex, caption: stage.caption, durationMs: 600, frame: drop },
  ];
};
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `pnpm vitest run --project node src/features/overlay/animators/filter.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/overlay/animators/generic.ts src/features/overlay/animators/filter.ts src/features/overlay/animators/filter.test.ts
git commit -m "feat(overlay): аниматор WHERE/HAVING с вердиктами TRUE/FALSE/UNKNOWN

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Аниматор SELECT (проекция)

**Files:**
- Create: `src/features/overlay/animators/project.ts`
- Test: `src/features/overlay/animators/project.test.ts`

**Interfaces:**
- Consumes: функции `frame.ts`, `genericAnimator`, фикстура `fullPipelineTrace`.
- Produces: `projectAnimator: Animator<StageOf<'project'>>`. Фазы: `mark` (убираемые колонки `removed`, переименуемые `highlight`, вычисляемые добавлены справа со state `computed` и значениями из выхода стадии), `collapse` (пересборка из `stage.output`, вычисленные колонки остаются подсвечены `computed` на эту фазу).

- [ ] **Step 1: Написать падающий тест**

`src/features/overlay/animators/project.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fullPipelineTrace, testCtx } from '../__fixtures__/traces';
import type { Frame, StageOf } from '../types';
import { filterAnimator } from './filter';
import { projectAnimator } from './project';
import { scanAnimator } from './scan';

function afterWhere(): Frame {
  const t = fullPipelineTrace();
  const s = scanAnimator({ tables: [], decorations: [] }, t.stages[0] as StageOf<'scan'>, 0, testCtx());
  const f = filterAnimator(s[s.length - 1].frame, t.stages[1] as StageOf<'filter'>, 1, testCtx());
  return f[f.length - 1].frame;
}

describe('projectAnimator', () => {
  const stage = fullPipelineTrace().stages[2] as StageOf<'project'>;
  const phases = projectAnimator(afterWhere(), stage, 2, testCtx());

  it('две фазы: разметка и схлопывание', () => {
    expect(phases.map((p) => p.id)).toEqual(['2:mark', '2:collapse']);
  });

  it('убираемая колонка помечена, вычисляемая добавлена со значениями', () => {
    const t = phases[0].frame.tables[0];
    expect(t.columns.map((c) => [c.name, c.state])).toEqual([
      ['book_id', 'removed'], ['title', 'normal'], ['price', 'normal'], ['sale', 'computed'],
    ]);
    const tihiy = t.rows.find((r) => r.key === 'b=(0,1)');
    expect(tihiy?.values).toEqual([1, 'Тихий Дон', '890.00', '801.000']);
  });

  it('после схлопывания колонки как в выходе стадии', () => {
    const t = phases[1].frame.tables[0];
    expect(t.columns.map((c) => c.name)).toEqual(['title', 'price', 'sale']);
    expect(t.columns.find((c) => c.name === 'sale')?.state).toBe('computed');
    expect(t.rows.map((r) => r.values[0])).toEqual(['Тихий Дон', 'Python. К вершинам мастерства', 'Путешествие к центру Земли']);
    expect(phases[1].caption).toBe(stage.caption);
  });

  it('переименование подсвечивает исходную колонку', () => {
    const renamed = { ...stage, renamed: { title: 'name' } };
    const p = projectAnimator(afterWhere(), renamed, 2, testCtx());
    expect(p[0].frame.tables[0].columns.find((c) => c.name === 'title')?.state).toBe('highlight');
    expect(p[0].caption).toContain('title → name');
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `pnpm vitest run --project node src/features/overlay/animators/project.test.ts`
Expected: FAIL (`Cannot find module './project'`).

- [ ] **Step 3: Реализовать**

`src/features/overlay/animators/project.ts`:

```ts
import { clearMarks, currentTable, mapColumns, rebuildTable, withTable } from '../frame';
import type { Animator, GhostColumn, StageOf } from '../types';
import { genericAnimator } from './generic';

// SELECT: лишние колонки гаснут и схлопываются, вычисляемые «вырастают» справа
export const projectAnimator: Animator<StageOf<'project'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);

  const base = mapColumns(clearMarks(cur), (c) => {
    if (stage.removed.includes(c.name)) return { state: 'removed' };
    if (c.name in stage.renamed) return { state: 'highlight' };
    return { state: 'normal' };
  });

  // значения вычисляемых колонок берём из выхода стадии по ключу строки
  const outIndex = stage.computed.map((name) => stage.output.columns.findIndex((c) => c.name === name));
  const outByKey = new Map(stage.output.rows.map((r) => [r.key, r.values]));
  const computedCols: GhostColumn[] = stage.computed.map((name, i) => ({
    name, type: stage.output.columns[outIndex[i]]?.type, state: 'computed',
  }));
  const marked = {
    ...base,
    columns: [...base.columns, ...computedCols],
    rows: base.rows.map((r) => ({
      ...r,
      values: [...r.values, ...outIndex.map((ci) => (ci === -1 ? null : (outByKey.get(r.key)?.[ci] ?? null)))],
    })),
  };

  const collapsed = mapColumns(rebuildTable(cur, stage.output), (c) => ({
    state: stage.computed.includes(c.name) ? 'computed' : 'normal',
  }));

  const parts: string[] = [`оставляем ${stage.kept.length + stage.computed.length}`];
  if (stage.removed.length) parts.push(`убираем ${stage.removed.join(', ')}`);
  if (stage.computed.length) parts.push(`вычисляем ${stage.computed.join(', ')}`);
  const renames = Object.entries(stage.renamed).map(([from, to]) => `${from} → ${to}`);
  if (renames.length) parts.push(`переименовываем ${renames.join(', ')}`);

  return [
    { id: `${stageIndex}:mark`, stageIndex, caption: `SELECT: ${parts.join(', ')}`, durationMs: 600, frame: { tables: withTable(prev, marked).tables, decorations: [] } },
    { id: `${stageIndex}:collapse`, stageIndex, caption: stage.caption, durationMs: 700, frame: { tables: withTable(prev, collapsed).tables, decorations: [] } },
  ];
};
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `pnpm vitest run --project node src/features/overlay/animators/project.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/overlay/animators/project.ts src/features/overlay/animators/project.test.ts
git commit -m "feat(overlay): аниматор SELECT: убираемые, вычисляемые и переименованные колонки

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Аниматор DISTINCT и DISTINCT ON

**Files:**
- Create: `src/features/overlay/animators/distinct.ts`
- Test: `src/features/overlay/animators/distinct.test.ts`

**Interfaces:**
- Consumes: функции `frame.ts`, `genericAnimator`, фикстура `distinctTrace`.
- Produces: `distinctAnimator: Animator<StageOf<'distinct'>>`. Фазы: `stack` (члены стопки съезжаются под победителя, стопка окрашена в `group`, проигравшие `dropped`, победитель `kept` с бейджем `×N`), `collapse` (пересборка из выхода, победители сохраняют бейдж `×N`).

- [ ] **Step 1: Написать падающий тест**

`src/features/overlay/animators/distinct.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { distinctTrace, testCtx } from '../__fixtures__/traces';
import type { Frame, StageOf } from '../types';
import { distinctAnimator } from './distinct';
import { projectAnimator } from './project';
import { scanAnimator } from './scan';

function afterProject(): Frame {
  const t = distinctTrace();
  const s = scanAnimator({ tables: [], decorations: [] }, t.stages[0] as StageOf<'scan'>, 0, testCtx());
  const p = projectAnimator(s[s.length - 1].frame, t.stages[1] as StageOf<'project'>, 1, testCtx());
  return p[p.length - 1].frame;
}

describe('distinctAnimator', () => {
  const stage = distinctTrace().stages[2] as StageOf<'distinct'>;
  const phases = distinctAnimator(afterProject(), stage, 2, testCtx());

  it('дубли съезжаются под победителя', () => {
    const rows = phases[0].frame.tables[0].rows;
    expect(rows.map((r) => r.key)).toEqual(['b=(0,1)', 'b=(0,8)', 'b=(0,9)', 'b=(0,7)']);
    const winner = rows.find((r) => r.key === 'b=(0,8)');
    const loser = rows.find((r) => r.key === 'b=(0,9)');
    expect(winner).toMatchObject({ state: 'kept', badge: '×2' });
    expect(loser?.state).toBe('dropped');
    expect(winner?.group).toBe(loser?.group);
    expect(rows.find((r) => r.key === 'b=(0,1)')?.group).toBeUndefined();
  });

  it('после схлопывания остались победители, бейдж сохранился', () => {
    const rows = phases[1].frame.tables[0].rows;
    expect(rows.map((r) => r.key)).toEqual(['b=(0,1)', 'b=(0,8)', 'b=(0,7)']);
    expect(rows[1].badge).toBe('×2');
    expect(rows[0].badge).toBeUndefined();
  });

  it('DISTINCT ON упоминает ключи в подписи', () => {
    const p = distinctAnimator(afterProject(), { ...stage, on: ['price'] }, 2, testCtx());
    expect(p[0].caption).toContain('DISTINCT ON (price)');
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `pnpm vitest run --project node src/features/overlay/animators/distinct.test.ts`
Expected: FAIL (`Cannot find module './distinct'`).

- [ ] **Step 3: Реализовать**

`src/features/overlay/animators/distinct.ts`:

```ts
import type { RowKey } from '@/features/tracer/types';
import { clearMarks, currentTable, rebuildTable, withTable } from '../frame';
import type { Animator, GhostRow, StageOf } from '../types';
import { genericAnimator } from './generic';

// DISTINCT: одинаковые строки съезжаются в стопку и схлопываются в одну со счётчиком ×N
export const distinctAnimator: Animator<StageOf<'distinct'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  const clean = clearMarks(cur);

  const stackOf = new Map<RowKey, { winner: RowKey; members: RowKey[]; group: number }>();
  let group = 0;
  for (const s of stage.stacks) {
    if (s.members.length < 2) continue;
    const entry = { ...s, group: group++ };
    for (const m of s.members) stackOf.set(m, entry);
  }

  // новый порядок: победитель на своём месте, члены стопки сразу под ним
  const byKey = new Map(clean.rows.map((r) => [r.key, r]));
  const ordered: GhostRow[] = [];
  for (const r of clean.rows) {
    const s = stackOf.get(r.key);
    if (!s) {
      ordered.push(r);
      continue;
    }
    if (s.winner !== r.key) continue;
    for (const m of [s.winner, ...s.members.filter((k) => k !== s.winner)]) {
      const row = byKey.get(m);
      if (!row) continue;
      ordered.push(m === s.winner
        ? { ...row, state: 'kept', group: s.group, badge: `×${s.members.length}` }
        : { ...row, state: 'dropped', group: s.group });
    }
  }
  const stacked = { ...clean, rows: ordered };

  const result = rebuildTable(cur, stage.output);
  const collapsed = {
    ...result,
    rows: result.rows.map((r) => {
      const s = stackOf.get(r.key);
      return s && s.winner === r.key ? { ...r, badge: `×${s.members.length}` } : r;
    }),
  };

  const head = stage.on ? `DISTINCT ON (${stage.on.join(', ')})` : 'DISTINCT';
  return [
    { id: `${stageIndex}:stack`, stageIndex, caption: `${head}: одинаковые строки собираются в стопки`, durationMs: 800, frame: { tables: withTable(prev, stacked).tables, decorations: [] } },
    { id: `${stageIndex}:collapse`, stageIndex, caption: stage.caption, durationMs: 600, frame: { tables: withTable(prev, collapsed).tables, decorations: [] } },
  ];
};
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `pnpm vitest run --project node src/features/overlay/animators/distinct.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/overlay/animators/distinct.ts src/features/overlay/animators/distinct.test.ts
git commit -m "feat(overlay): аниматор DISTINCT со стопками дублей

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Аниматоры ORDER BY и LIMIT

**Files:**
- Create: `src/features/overlay/animators/sort.ts`, `src/features/overlay/animators/limit.ts`
- Test: `src/features/overlay/animators/sort.test.ts`, `src/features/overlay/animators/limit.test.ts`

**Interfaces:**
- Consumes: функции `frame.ts`, `genericAnimator`, фикстура `fullPipelineTrace`.
- Produces:
  - `sortAnimator: Animator<StageOf<'sort'>>`: фазы `keys` (колонки ключа `key`), `reorder` (строки в порядке `stage.order`, ключи подсвечены);
  - `limitAnimator: Animator<StageOf<'limit'>>`: фазы `scissors` (линии-ножницы, строки вне `kept` в состоянии `cut`), `cut` (пересборка + счётчик).

- [ ] **Step 1: Написать падающие тесты**

Общий хелпер, чтобы дойти до нужной стадии: `src/features/overlay/__fixtures__/runUpTo.ts`:

```ts
import type { Trace } from '@/features/tracer/types';
import { ANIMATORS } from '../animators';
import { genericAnimator } from '../animators/generic';
import type { Animator, AnimatorContext, Frame } from '../types';

// Прогоняет стадии [0, upTo) и возвращает последний кадр
export function runUpTo(trace: Trace, upTo: number, ctx: AnimatorContext): Frame {
  let frame: Frame = { tables: [], decorations: [] };
  trace.stages.slice(0, upTo).forEach((stage, i) => {
    const animator = (ANIMATORS[stage.kind] ?? genericAnimator) as Animator;
    const phases = animator(frame, stage, i, ctx);
    if (phases.length) frame = phases[phases.length - 1].frame;
  });
  return frame;
}
```

`src/features/overlay/animators/sort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fullPipelineTrace, testCtx } from '../__fixtures__/traces';
import { runUpTo } from '../__fixtures__/runUpTo';
import type { StageOf } from '../types';
import { sortAnimator } from './sort';

describe('sortAnimator', () => {
  const trace = fullPipelineTrace();
  const stage = trace.stages[3] as StageOf<'sort'>;
  const phases = sortAnimator(runUpTo(trace, 3, testCtx()), stage, 3, testCtx());

  it('сначала подсвечивает ключ сортировки, порядок ещё старый', () => {
    const t = phases[0].frame.tables[0];
    expect(t.columns.find((c) => c.name === 'price')?.state).toBe('key');
    expect(t.rows.map((r) => r.key)).toEqual(['b=(0,1)', 'b=(0,2)', 'b=(0,8)']);
  });

  it('потом строки переезжают в порядок стадии', () => {
    const t = phases[1].frame.tables[0];
    expect(t.rows.map((r) => r.key)).toEqual(['b=(0,2)', 'b=(0,1)', 'b=(0,8)']);
    expect(phases[1].caption).toBe('ORDER BY price DESC');
  });
});
```

`src/features/overlay/animators/limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fullPipelineTrace, testCtx } from '../__fixtures__/traces';
import { runUpTo } from '../__fixtures__/runUpTo';
import type { StageOf } from '../types';
import { limitAnimator } from './limit';

describe('limitAnimator', () => {
  const trace = fullPipelineTrace();
  const stage = trace.stages[4] as StageOf<'limit'>;
  const before = runUpTo(trace, 4, testCtx());

  it('ножницы после второй строки, третья отрезана', () => {
    const phases = limitAnimator(before, stage, 4, testCtx());
    expect(phases[0].frame.decorations).toContainEqual({ kind: 'scissors', table: 't:b', afterRow: 1 });
    expect(phases[0].frame.tables[0].rows.find((r) => r.key === 'b=(0,8)')?.state).toBe('cut');
    expect(phases[1].frame.tables[0].rows.map((r) => r.key)).toEqual(['b=(0,2)', 'b=(0,1)']);
    expect(phases[1].frame.decorations).toContainEqual(expect.objectContaining({ kind: 'counter', text: '3 → 2' }));
  });

  it('OFFSET даёт вторые ножницы сверху', () => {
    const withOffset = { ...stage, offset: 1, limit: 1, kept: ['b=(0,1)'], cut: ['b=(0,2)', 'b=(0,8)'] };
    const phases = limitAnimator(before, withOffset, 4, testCtx());
    const scissors = phases[0].frame.decorations.filter((d) => d.kind === 'scissors');
    expect(scissors).toEqual([
      { kind: 'scissors', table: 't:b', afterRow: 0 },
      { kind: 'scissors', table: 't:b', afterRow: 1 },
    ]);
    expect(phases[0].caption).toBe('LIMIT 1 OFFSET 1: отрезаем лишнее');
  });

  it('LIMIT больше числа строк не рисует нижние ножницы', () => {
    const all = { ...stage, limit: 10, kept: ['b=(0,2)', 'b=(0,1)', 'b=(0,8)'], cut: [] };
    const phases = limitAnimator(before, all, 4, testCtx());
    expect(phases[0].frame.decorations.filter((d) => d.kind === 'scissors')).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `pnpm vitest run --project node src/features/overlay/animators/sort.test.ts src/features/overlay/animators/limit.test.ts`
Expected: FAIL (`Cannot find module './sort'`, `'../animators'`).

- [ ] **Step 3: Реализовать аниматоры и временный реестр**

`src/features/overlay/animators/sort.ts`:

```ts
import { clearMarks, currentTable, mapColumns, rebuildTable, withTable } from '../frame';
import type { Animator, StageOf } from '../types';
import { genericAnimator } from './generic';

// ORDER BY: ключ подсвечивается, строки переезжают на новые места
export const sortAnimator: Animator<StageOf<'sort'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  const isKey = (name: string) => stage.sortKeys.includes(name);
  const keys = mapColumns(clearMarks(cur), (c) => ({ state: isKey(c.name) ? 'key' : 'normal' }));
  const reordered = mapColumns(rebuildTable(cur, stage.output, stage.order), (c) => ({ state: isKey(c.name) ? 'key' : 'normal' }));
  return [
    { id: `${stageIndex}:keys`, stageIndex, caption: `ORDER BY: сортируем по ${stage.sortKeys.join(', ')}`, durationMs: 400, frame: { tables: withTable(prev, keys).tables, decorations: [] } },
    { id: `${stageIndex}:reorder`, stageIndex, caption: stage.caption, durationMs: 900, frame: { tables: withTable(prev, reordered).tables, decorations: [] } },
  ];
};
```

`src/features/overlay/animators/limit.ts`:

```ts
import { clearMarks, counterNear, currentTable, mapRows, rebuildTable, totalRows, withTable } from '../frame';
import type { Animator, Decoration, StageOf } from '../types';
import { genericAnimator } from './generic';

// LIMIT / OFFSET: линии-ножницы, строки за ними гаснут и уходят
export const limitAnimator: Animator<StageOf<'limit'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  const before = totalRows(cur);
  const kept = new Set(stage.kept);
  const marked = mapRows(clearMarks(cur), (r) => (kept.has(r.key) ? {} : { state: 'cut' as const }));

  const scissors: Decoration[] = [];
  if (stage.offset > 0) scissors.push({ kind: 'scissors', table: cur.id, afterRow: stage.offset - 1 });
  if (stage.limit !== null && stage.offset + stage.limit < before) {
    scissors.push({ kind: 'scissors', table: cur.id, afterRow: stage.offset + stage.limit - 1 });
  }

  const result = rebuildTable(cur, stage.output);
  const head = [stage.limit !== null ? `LIMIT ${stage.limit}` : null, stage.offset > 0 ? `OFFSET ${stage.offset}` : null]
    .filter(Boolean)
    .join(' ');
  return [
    { id: `${stageIndex}:scissors`, stageIndex, caption: `${head}: отрезаем лишнее`, durationMs: 600, frame: { tables: withTable(prev, marked).tables, decorations: scissors } },
    { id: `${stageIndex}:cut`, stageIndex, caption: stage.caption, durationMs: 600, frame: { tables: withTable(prev, result).tables, decorations: [counterNear(result, `${stageIndex}:counter`, `${before} → ${stage.output.rows.length}`)] } },
  ];
};
```

`src/features/overlay/animators/error.ts`:

```ts
import type { Animator, StageOf } from '../types';

// Ошибка выполнения: кадр не меняется, подпись объясняет, что случилось
export const errorAnimator: Animator<StageOf<'error'>> = (prev, stage, stageIndex) => [
  { id: `${stageIndex}:error`, stageIndex, caption: `Ошибка ${stage.error.code}: ${stage.error.message}`, durationMs: 700, frame: { ...prev, decorations: [] } },
];
```

`src/features/overlay/animators/index.ts`:

```ts
import type { Stage } from '@/features/tracer/types';
import type { Animator } from '../types';
import { distinctAnimator } from './distinct';
import { errorAnimator } from './error';
import { filterAnimator } from './filter';
import { limitAnimator } from './limit';
import { projectAnimator } from './project';
import { scanAnimator } from './scan';
import { sortAnimator } from './sort';

// Реестр аниматоров по виду стадии. Виды без аниматора идут через genericAnimator
export const ANIMATORS: { [K in Stage['kind']]?: Animator<Extract<Stage, { kind: K }>> } = {
  scan: scanAnimator,
  filter: filterAnimator,
  project: projectAnimator,
  distinct: distinctAnimator,
  sort: sortAnimator,
  limit: limitAnimator,
  error: errorAnimator,
};
```

- [ ] **Step 4: Запустить, убедиться что проходят**

Run: `pnpm vitest run --project node src/features/overlay`
Expected: PASS, все тесты оверлея (35).

- [ ] **Step 5: Commit**

```bash
git add src/features/overlay/animators src/features/overlay/__fixtures__/runUpTo.ts
git commit -m "feat(overlay): аниматоры ORDER BY и LIMIT, реестр аниматоров

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: buildPlayback и сжатый режим

**Files:**
- Create: `src/features/overlay/playback.ts`
- Test: `src/features/overlay/playback.test.ts`

**Interfaces:**
- Consumes: `ANIMATORS`, `genericAnimator` (задача 7), фикстуры.
- Produces: `buildPlayback(trace: Trace, ctx: AnimatorContext): Playback`, `lastPhaseOfStage(p: Playback, stageIndex: number): number`, `stageOfPhase(p: Playback, phaseIndex: number): number`; реэкспорт `ANIMATORS` и типа `Playback` (по контракту они живут в `playback.ts`).

- [ ] **Step 1: Написать падающий тест**

`src/features/overlay/playback.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Trace } from '@/features/tracer/types';
import { bigFilterTrace, fullPipelineTrace, testCtx } from './__fixtures__/traces';
import { buildPlayback, lastPhaseOfStage, stageOfPhase } from './playback';

describe('buildPlayback', () => {
  it('полный конвейер даёт фазы всех стадий по порядку', () => {
    const p = buildPlayback(fullPipelineTrace(), testCtx());
    // scan 2 + filter 3 + project 2 + sort 2 + limit 2
    expect(p.phases).toHaveLength(11);
    expect(p.stageStarts).toEqual([0, 2, 5, 7, 9]);
    expect(p.phases.map((ph) => ph.stageIndex)).toEqual([0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('последний кадр совпадает с результатом запроса', () => {
    const p = buildPlayback(fullPipelineTrace(), testCtx());
    const last = p.phases[p.phases.length - 1].frame.tables[0];
    expect(last.rows.map((r) => r.values)).toEqual([
      ['Python. К вершинам мастерства', '2400.00', '2160.000'],
      ['Тихий Дон', '890.00', '801.000'],
    ]);
  });

  it('final-only даёт пустое проигрывание', () => {
    const t: Trace = { ...fullPipelineTrace(), mode: 'final-only', fallbackReason: 'LATERAL пока не умею' };
    expect(buildPlayback(t, testCtx())).toEqual({ phases: [], stageStarts: [] });
  });

  it('стадия без своего аниматора идёт через generic', () => {
    const t = fullPipelineTrace();
    const window = { ...t.stages[2], kind: 'window', partitions: [], computed: [] } as unknown as Trace['stages'][number];
    const p = buildPlayback({ ...t, stages: [t.stages[0], window] }, testCtx());
    expect(p.phases[p.phases.length - 1].id).toBe('1:result');
  });

  it('стадия на 500 строк рисует 20 строк и hiddenRows', () => {
    const p = buildPlayback(bigFilterTrace(500), testCtx());
    const scanEnd = p.phases[p.stageStarts[1] - 1].frame.tables[0];
    expect(scanEnd.rows).toHaveLength(20);
    expect(scanEnd.hiddenRows).toBe(480);
    const last = p.phases[p.phases.length - 1].frame.tables[0];
    expect(last.rows).toHaveLength(20);
    expect(last.hiddenRows).toBe(230);
  });

  it('lastPhaseOfStage и stageOfPhase', () => {
    const p = buildPlayback(fullPipelineTrace(), testCtx());
    expect(lastPhaseOfStage(p, 1)).toBe(4);
    expect(lastPhaseOfStage(p, 4)).toBe(10);
    expect(stageOfPhase(p, 6)).toBe(2);
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `pnpm vitest run --project node src/features/overlay/playback.test.ts`
Expected: FAIL (`Cannot find module './playback'`).

- [ ] **Step 3: Реализовать**

`src/features/overlay/playback.ts`:

```ts
import type { Trace } from '@/features/tracer/types';
import { ANIMATORS } from './animators';
import { genericAnimator } from './animators/generic';
import type { Animator, AnimatorContext, Frame, Phase, Playback } from './types';

export { ANIMATORS };
export type { Playback };

// Прогоняет стадии трассы через аниматоры и собирает плоский список фаз
export function buildPlayback(trace: Trace, ctx: AnimatorContext): Playback {
  if (trace.mode !== 'full' || trace.stages.length === 0) return { phases: [], stageStarts: [] };
  let frame: Frame = { tables: [], decorations: [] };
  const phases: Phase[] = [];
  const stageStarts: number[] = [];
  trace.stages.forEach((stage, i) => {
    const animator = (ANIMATORS[stage.kind] ?? genericAnimator) as Animator;
    const out = animator(frame, stage, i, ctx);
    stageStarts.push(phases.length);
    phases.push(...out);
    if (out.length) frame = out[out.length - 1].frame;
  });
  return { phases, stageStarts };
}

// Индекс последней фазы стадии: туда прыгает клик по чипу
export function lastPhaseOfStage(p: Playback, stageIndex: number): number {
  const next = p.stageStarts[stageIndex + 1];
  return (next ?? p.phases.length) - 1;
}

export function stageOfPhase(p: Playback, phaseIndex: number): number {
  return p.phases[phaseIndex]?.stageIndex ?? 0;
}
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `pnpm vitest run --project node src/features/overlay/playback.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Проверки, трекер, коммит**

Run: `pnpm check`
Expected: зелёный.

В `docs/PROGRESS.md` поставить `✅ (<дата>)` у **P6.7**, **P6.8**, **P6.9**, **P6.10**, **P6.11**, **P6.18** (аниматоры и сжатый режим на уровне кадров готовы; рендер сжатой полосы добавляется в задаче 10, если она ещё не сделана, P6.18 закрыть после задачи 10).

```bash
git add src/features/overlay/playback.ts src/features/overlay/playback.test.ts docs/PROGRESS.md
git commit -m "feat(overlay): buildPlayback и сжатый режим больших стадий

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Подсказка для пустого результата

**Files:**
- Create: `src/features/overlay/emptyHint.ts`, `src/features/results/EmptyHint.tsx`
- Modify: `src/features/results/ResultsPanel.tsx`
- Test: `src/features/overlay/emptyHint.test.ts`, `src/features/results/EmptyHint.test.tsx`

**Interfaces:**
- Consumes: `Trace`, `stageLabel` (задача 3), `useSceneStore` (задача 1).
- Produces: `emptyResultHint(trace: Trace): string | null`; компонент `EmptyHint(): JSX.Element | null` (читает трассу из стора).

- [ ] **Step 1: Написать падающие тесты**

`src/features/overlay/emptyHint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Trace } from '@/features/tracer/types';
import { fullPipelineTrace } from './__fixtures__/traces';
import { emptyResultHint } from './emptyHint';

const emptyResult = { fields: [], rows: [] };

function whereKillsAll(): Trace {
  const t = fullPipelineTrace();
  const stages = t.stages.slice(0, 2).map((s, i) => (i === 1 ? { ...s, output: { ...s.output, rows: [] } } : s));
  return { ...t, stages, result: emptyResult };
}

describe('emptyResultHint', () => {
  it('называет стадию, где пропали строки', () => {
    expect(emptyResultHint(whereKillsAll())).toBe('Строки пропали на шаге WHERE: было 5, стало 0.');
  });

  it('пустая таблица с самого начала', () => {
    const t = fullPipelineTrace();
    const scan = { ...t.stages[0], output: { ...t.stages[0].output, rows: [] } };
    expect(emptyResultHint({ ...t, stages: [scan], result: emptyResult })).toBe('В таблице book b нет строк: пусто с самого начала.');
  });

  it('непустой результат и final-only без подсказки', () => {
    expect(emptyResultHint({ ...fullPipelineTrace(), result: { fields: [], rows: [[1]] } })).toBeNull();
    expect(emptyResultHint({ ...whereKillsAll(), mode: 'final-only' })).toBeNull();
  });
});
```

`src/features/results/EmptyHint.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fullPipelineTrace } from '@/features/overlay/__fixtures__/traces';
import { useSceneStore } from '@/stores/scene';
import { EmptyHint } from './EmptyHint';

describe('EmptyHint', () => {
  beforeEach(() => useSceneStore.setState(useSceneStore.getInitialState(), true));

  it('показывает подсказку при пустом результате', () => {
    const t = fullPipelineTrace();
    const stages = t.stages.slice(0, 2).map((s, i) => (i === 1 ? { ...s, output: { ...s.output, rows: [] } } : s));
    useSceneStore.getState().setTrace({ ...t, stages, result: { fields: [], rows: [] } }, useSceneStore.getState().nextGeneration());
    render(<EmptyHint />);
    expect(screen.getByText('Строки пропали на шаге WHERE: было 5, стало 0.')).toBeTruthy();
  });

  it('ничего не рисует без трассы', () => {
    const { container } = render(<EmptyHint />);
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `pnpm vitest run --project node src/features/overlay/emptyHint.test.ts && pnpm vitest run --project dom src/features/results/EmptyHint.test.tsx`
Expected: FAIL (`Cannot find module './emptyHint'`).

- [ ] **Step 3: Реализовать**

`src/features/overlay/emptyHint.ts`:

```ts
import type { Trace } from '@/features/tracer/types';
import { stageLabel, tableTitle } from './labels';

// Если результат пустой, говорим, на какой стадии пропали строки
export function emptyResultHint(trace: Trace): string | null {
  if (trace.mode !== 'full' || !trace.result || trace.result.rows.length > 0) return null;
  let prev: number | null = null;
  for (const stage of trace.stages) {
    const n = stage.output.rows.length;
    if (n === 0) {
      if (prev === null && stage.kind === 'scan') {
        return `В таблице ${tableTitle(stage.tableId, stage.alias)} нет строк: пусто с самого начала.`;
      }
      return `Строки пропали на шаге ${stageLabel(stage)}: было ${prev ?? 0}, стало 0.`;
    }
    prev = n;
  }
  return null;
}
```

`src/features/results/EmptyHint.tsx`:

```tsx
import { emptyResultHint } from '@/features/overlay/emptyHint';
import { useSceneStore } from '@/stores/scene';

// Подсказка под «0 строк»: на каком шаге запрос потерял все строки
export function EmptyHint() {
  const trace = useSceneStore((s) => s.trace);
  const hint = trace ? emptyResultHint(trace) : null;
  if (!hint) return null;
  return (
    <p className="text-sm text-muted-foreground" data-testid="empty-hint">
      {hint}
    </p>
  );
}
```

В `src/features/results/ResultsPanel.tsx` найти ветку, которая рендерит пустой результат (условие `rows.length === 0` во вкладке «Результат»), и добавить сразу после текста «0 строк»:

```tsx
<EmptyHint />
```

и импорт `import { EmptyHint } from './EmptyHint';`. Если отдельной ветки для пустого результата нет, добавить её над таблицей результата:

```tsx
{result && result.rows.length === 0 ? (
  <div className="flex flex-col gap-1 p-3">
    <p className="text-sm">0 строк</p>
    <EmptyHint />
  </div>
) : null}
```

- [ ] **Step 4: Запустить, убедиться что проходят**

Run: `pnpm vitest run --project node src/features/overlay/emptyHint.test.ts && pnpm vitest run --project dom src/features/results/EmptyHint.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Проверки, трекер, коммит**

Run: `pnpm check`. В `docs/PROGRESS.md`: `✅ (<дата>)` у **P6.21**.

```bash
git add src/features/overlay/emptyHint.ts src/features/overlay/emptyHint.test.ts src/features/results/EmptyHint.tsx src/features/results/EmptyHint.test.tsx src/features/results/ResultsPanel.tsx docs/PROGRESS.md
git commit -m "feat(results): подсказка, на каком шаге пропали строки

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Рендер призраков и декораций

**Files:**
- Create: `src/features/overlay/GhostTable.tsx`, `src/features/overlay/Decorations.tsx`, `src/features/overlay/overlay.css`
- Test: `src/features/overlay/GhostTable.test.tsx`, `src/features/overlay/Decorations.test.tsx`

**Interfaces:**
- Consumes: типы, геометрия, `formatValue`, `columnKeys`; `motion`, `AnimatePresence` из `motion/react`; CSS-токены семантических цветов из Ф1 (`--color-kept`, `--color-dropped`, `--color-match`, `--color-null`, `--color-new`, `--color-changed`, `--color-deleted`, `--color-group-0` … `--color-group-7`).
- Produces: `GhostTableView({ table }: { table: GhostTable }): JSX.Element`, `Decorations({ frame }: { frame: Frame }): JSX.Element`. Атрибуты для тестов: `data-testid="ghost-table"` + `data-table-id`, `data-testid="ghost-row"` + `data-row-key` + `data-state`, `data-testid="ghost-hidden"`, `data-testid="deco-<kind>"`.

Почему не `layoutId`: layout-анимации motion меряют элементы через `getBoundingClientRect` в экранных координатах, а оверлей лежит внутри контейнера React Flow со `scale(zoom)`. При zoom ≠ 1 смещения получаются умноженными на масштаб. Поэтому позиции задаются явно в координатах доски (`animate={{ x, y }}`), а ключ строки (`RowKey`) даёт ту же непрерывность, что и `layoutId`.

- [ ] **Step 1: Написать падающие тесты**

`src/features/overlay/GhostTable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GhostTableView } from './GhostTable';
import type { GhostTable } from './types';

const table: GhostTable = {
  id: 't:b', title: 'book b', x: 10, y: 20,
  columns: [{ name: 'title', state: 'normal' }, { name: 'price', state: 'removed' }],
  rows: [
    { key: 'b=(0,1)', values: ['Тихий Дон', '890.00'], state: 'kept' },
    { key: 'b=(0,3)', values: ['Судьба человека', '350.00'], state: 'dropped' },
    { key: 'b=(0,5)', values: ['Судьба человека', '350.00'], state: 'normal' },
    { key: 'b=(0,7)', values: ['Остров', null], state: 'unknown', badge: 'UNKNOWN' },
    { key: 'b=(0,9)', values: ['', '1.00'], state: 'normal' },
  ],
  hiddenRows: 42,
};

describe('GhostTableView', () => {
  it('рисует заголовок, колонки и строки', () => {
    render(<GhostTableView table={table} />);
    expect(screen.getByTestId('ghost-table').getAttribute('data-table-id')).toBe('t:b');
    expect(screen.getByText('book b')).toBeTruthy();
    expect(screen.getAllByTestId('ghost-row')).toHaveLength(5);
  });

  it('дубликаты значений рендерятся отдельными строками', () => {
    render(<GhostTableView table={table} />);
    expect(screen.getAllByText('Судьба человека')).toHaveLength(2);
  });

  it('состояния строк в data-state, отсеянные зачёркнуты и с иконкой', () => {
    render(<GhostTableView table={table} />);
    const dropped = screen.getAllByTestId('ghost-row').find((r) => r.getAttribute('data-row-key') === 'b=(0,3)');
    expect(dropped?.getAttribute('data-state')).toBe('dropped');
    expect(dropped?.className).toContain('vs-row--dropped');
    expect(dropped?.querySelector('[aria-label="отсеяна"]')).toBeTruthy();
  });

  it('NULL отличается от пустой строки', () => {
    render(<GhostTableView table={table} />);
    expect(screen.getByText('NULL').className).toContain('vs-null');
    expect(screen.getByText("''").className).not.toContain('vs-null');
  });

  it('бейдж и полоса скрытых строк', () => {
    render(<GhostTableView table={table} />);
    expect(screen.getByText('UNKNOWN')).toBeTruthy();
    expect(screen.getByTestId('ghost-hidden').textContent).toBe('… ещё 42 строк');
  });

  it('убираемая колонка помечена классом', () => {
    render(<GhostTableView table={table} />);
    expect(screen.getByText('price').className).toContain('vs-col--removed');
  });
});
```

`src/features/overlay/Decorations.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Decorations } from './Decorations';
import type { Frame } from './types';

const t = {
  id: 't:b', title: 'book', x: 0, y: 0,
  columns: [{ name: 'author_id', state: 'normal' as const }],
  rows: [{ key: 'b=(0,1)', values: [1], state: 'normal' as const }],
};
const a = { ...t, id: 't:a', x: 400, rows: [{ key: 'a=(0,1)', values: [1], state: 'normal' as const }] };

describe('Decorations', () => {
  it('рисует сканер, ножницы, счётчик и линию пары', () => {
    const frame: Frame = {
      tables: [t, a],
      decorations: [
        { kind: 'scanner', table: 't:b', rowIndex: 0 },
        { kind: 'scissors', table: 't:b', afterRow: 0 },
        { kind: 'counter', id: 'c', x: 10, y: 10, text: '5 → 3' },
        { kind: 'pair-line', id: 'p', from: { table: 't:b', row: 'b=(0,1)', col: 'author_id' }, to: { table: 't:a', row: 'a=(0,1)', col: 'author_id' } },
        { kind: 'bracket', table: 't:b', fromRow: 0, toRow: 0, color: 2, label: 'Россия' },
        { kind: 'arrow', id: 'r', from: { x: 0, y: 0 }, to: { x: 50, y: 50 }, tone: 'danger' },
      ],
    };
    render(<Decorations frame={frame} />);
    expect(screen.getByTestId('deco-scanner')).toBeTruthy();
    expect(screen.getByTestId('deco-scissors')).toBeTruthy();
    expect(screen.getByTestId('deco-counter').textContent).toBe('5 → 3');
    expect(screen.getByTestId('deco-pair-line').getAttribute('d')).toMatch(/^M /);
    expect(screen.getByTestId('deco-bracket').textContent).toBe('Россия');
    expect(screen.getByTestId('deco-arrow')).toBeTruthy();
  });

  it('декорация на несуществующую таблицу пропускается', () => {
    render(<Decorations frame={{ tables: [], decorations: [{ kind: 'scanner', table: 'нет', rowIndex: 0 }] }} />);
    expect(screen.queryByTestId('deco-scanner')).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `pnpm vitest run --project dom src/features/overlay/GhostTable.test.tsx src/features/overlay/Decorations.test.tsx`
Expected: FAIL (`Cannot find module './GhostTable'`).

- [ ] **Step 3: Реализовать**

`src/features/overlay/GhostTable.tsx`:

```tsx
import { AnimatePresence, motion } from 'motion/react';
import { memo } from 'react';
import { formatValue } from './format';
import { COL_WIDTH, COLHEAD_HEIGHT, ROW_H, TITLE_HEIGHT, cellLeft, columnKeys, ghostHeight, ghostWidth, rowTop } from './geometry';
import type { GhostColumn, GhostRow, GhostTable } from './types';

// Иконка состояния: цвет не единственный сигнал
const STATE_ICON: Partial<Record<GhostRow['state'], { icon: string; label: string }>> = {
  kept: { icon: '✓', label: 'прошла' },
  dropped: { icon: '✕', label: 'отсеяна' },
  unknown: { icon: '?', label: 'UNKNOWN' },
  cut: { icon: '✂', label: 'отрезана' },
  new: { icon: '+', label: 'новая' },
  changed: { icon: '~', label: 'изменена' },
  deleted: { icon: '✕', label: 'удалена' },
};

const GhostRowView = memo(function GhostRowView({ row, index, columns, keys }: { row: GhostRow; index: number; columns: GhostColumn[]; keys: string[] }) {
  const icon = STATE_ICON[row.state];
  return (
    <motion.div
      data-testid="ghost-row"
      data-row-key={row.key}
      data-state={row.state}
      className={`vs-row vs-row--${row.state}`}
      style={{ height: ROW_H, ...(row.group !== undefined ? { ['--vs-group' as string]: `var(--color-group-${row.group % 8})` } : {}) }}
      initial={{ opacity: 0, y: rowTop(index) }}
      animate={{ opacity: 1, y: rowTop(index) }}
      exit={{ opacity: 0, y: rowTop(index) + ROW_H / 2 }}
    >
      {columns.map((c, ci) => {
        const { text, isNull } = formatValue(row.values[ci]);
        return (
          <div
            key={keys[ci]}
            className={`vs-cell vs-col--${c.state}${isNull ? ' vs-null' : ''}`}
            style={{ width: COL_WIDTH, transform: `translateX(${cellLeft(ci)}px)` }}
            title={row.cellNotes?.[ci]}
          >
            {text}
          </div>
        );
      })}
      {icon ? (
        <span className="vs-row-icon" aria-label={icon.label} role="img">
          {icon.icon}
        </span>
      ) : null}
      {row.badge ? <span className="vs-row-badge">{row.badge}</span> : null}
    </motion.div>
  );
});

// Призрачная таблица: двигается целиком, строки двигаются внутри неё
export const GhostTableView = memo(function GhostTableView({ table }: { table: GhostTable }) {
  const keys = columnKeys(table.columns);
  return (
    <motion.div
      data-testid="ghost-table"
      data-table-id={table.id}
      className={`vs-ghost${table.dashed ? ' vs-ghost--dashed' : ''}`}
      style={{ width: ghostWidth(table), height: ghostHeight(table) }}
      initial={{ opacity: 0, x: table.x, y: table.y }}
      animate={{ opacity: table.opacity ?? 1, x: table.x, y: table.y }}
      exit={{ opacity: 0 }}
    >
      <div className="vs-ghost-title" style={{ height: TITLE_HEIGHT }}>
        {table.title}
      </div>
      <div className="vs-ghost-head" style={{ top: TITLE_HEIGHT, height: COLHEAD_HEIGHT }}>
        {table.columns.map((c, ci) => (
          <div key={keys[ci]} className={`vs-colhead vs-col--${c.state}`} style={{ width: COL_WIDTH, transform: `translateX(${cellLeft(ci)}px)` }}>
            {c.name}
          </div>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {table.rows.map((row, i) => (
          <GhostRowView key={row.key} row={row} index={i} columns={table.columns} keys={keys} />
        ))}
      </AnimatePresence>
      {table.hiddenRows ? (
        <div data-testid="ghost-hidden" className="vs-ghost-hidden" style={{ top: rowTop(table.rows.length), height: ROW_H }}>
          … ещё {table.hiddenRows} строк
        </div>
      ) : null}
    </motion.div>
  );
});
```

`src/features/overlay/Decorations.tsx`:

```tsx
import { motion } from 'motion/react';
import { ROW_H, cellCenter, ghostWidth, rowTop } from './geometry';
import type { Decoration, Frame, GhostTable } from './types';

function findTable(frame: Frame, id: string): GhostTable | undefined {
  return frame.tables.find((t) => t.id === id);
}

function DecorationView({ d, frame }: { d: Decoration; frame: Frame }) {
  switch (d.kind) {
    case 'scanner': {
      const t = findTable(frame, d.table);
      if (!t) return null;
      return <motion.div data-testid="deco-scanner" className="vs-scanner" style={{ width: ghostWidth(t), x: t.x }} initial={false} animate={{ x: t.x, y: t.y + rowTop(d.rowIndex) + ROW_H }} />;
    }
    case 'scissors': {
      const t = findTable(frame, d.table);
      if (!t) return null;
      return (
        <motion.div data-testid="deco-scissors" className="vs-scissors" style={{ width: ghostWidth(t) + 24 }} initial={{ opacity: 0, x: t.x - 24, y: t.y + rowTop(d.afterRow + 1) }} animate={{ opacity: 1, x: t.x - 24, y: t.y + rowTop(d.afterRow + 1) }}>
          <span aria-hidden>✂</span>
        </motion.div>
      );
    }
    case 'counter':
      return (
        <motion.div data-testid="deco-counter" className="vs-counter" initial={{ opacity: 0, x: d.x, y: d.y }} animate={{ opacity: 1, x: d.x, y: d.y }}>
          {d.text}
        </motion.div>
      );
    case 'bracket': {
      const t = findTable(frame, d.table);
      if (!t) return null;
      const top = t.y + rowTop(d.fromRow);
      const height = (d.toRow - d.fromRow + 1) * ROW_H;
      return (
        <motion.div data-testid="deco-bracket" className="vs-bracket" style={{ height, ['--vs-group' as string]: `var(--color-group-${d.color % 8})` }} initial={{ opacity: 0, x: t.x - 18, y: top }} animate={{ opacity: 1, x: t.x - 18, y: top }}>
          {d.label ?? null}
        </motion.div>
      );
    }
    default:
      return null;
  }
}

// Линии пар и стрелки рисуются одним SVG поверх таблиц
function SvgLayer({ frame }: { frame: Frame }) {
  const lines = frame.decorations.flatMap((d) => {
    if (d.kind === 'pair-line') {
      const ft = findTable(frame, d.from.table);
      const tt = findTable(frame, d.to.table);
      const a = ft && cellCenter(ft, d.from.row, d.from.col);
      const b = tt && cellCenter(tt, d.to.row, d.to.col);
      if (!a || !b) return [];
      const mx = (a.x + b.x) / 2;
      return [<path key={d.id} data-testid="deco-pair-line" className="vs-pair-line" d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`} />];
    }
    if (d.kind === 'arrow') {
      return [<line key={d.id} data-testid="deco-arrow" className={`vs-arrow vs-arrow--${d.tone}`} x1={d.from.x} y1={d.from.y} x2={d.to.x} y2={d.to.y} markerEnd="url(#vs-arrowhead)" />];
    }
    return [];
  });
  if (lines.length === 0) return null;
  return (
    <svg className="vs-svg-layer" width={1} height={1} overflow="visible" aria-hidden>
      <defs>
        <marker id="vs-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {lines}
    </svg>
  );
}

export function Decorations({ frame }: { frame: Frame }) {
  return (
    <>
      <SvgLayer frame={frame} />
      {frame.decorations.map((d, i) => (
        <DecorationView key={'id' in d ? d.id : `${d.kind}:${'table' in d ? d.table : ''}:${i}`} d={d} frame={frame} />
      ))}
    </>
  );
}
```

`src/features/overlay/overlay.css` (подключается импортом в `OverlayLayer.tsx`):

```css
/* Призрачные таблицы и декорации оверлея.
   Двигаем только transform и opacity; длительность берём из --vs-dur */
.vs-overlay { position: absolute; left: 0; top: 0; pointer-events: none; --vs-dur: 0.5s; }
.vs-ghost { position: absolute; left: 0; top: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--card); box-shadow: 0 8px 24px rgb(0 0 0 / 0.18); overflow: hidden; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }
.vs-ghost--dashed { border-style: dashed; }
.vs-ghost-title { display: flex; align-items: center; padding: 0 10px; font-weight: 600; font-family: var(--font-sans, ui-sans-serif); border-bottom: 1px solid var(--border); }
.vs-ghost-head { position: absolute; left: 0; right: 0; border-bottom: 1px solid var(--border); background: var(--muted); }
.vs-colhead, .vs-cell { position: absolute; top: 0; height: 100%; display: flex; align-items: center; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: transform var(--vs-dur) ease-in-out, opacity var(--vs-dur) ease-in-out; }
.vs-row { position: absolute; left: 0; right: 0; top: 0; border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent); }
.vs-row--kept { background: color-mix(in oklab, var(--color-kept) 18%, transparent); }
.vs-row--dropped { background: color-mix(in oklab, var(--color-dropped) 18%, transparent); text-decoration: line-through; }
.vs-row--unknown { background: color-mix(in oklab, var(--color-null) 22%, transparent); opacity: 0.8; }
.vs-row--cut { opacity: 0.35; }
.vs-row--matched { background: color-mix(in oklab, var(--color-match) 18%, transparent); }
.vs-row--new { background: color-mix(in oklab, var(--color-new) 18%, transparent); }
.vs-row--changed { background: color-mix(in oklab, var(--color-changed) 22%, transparent); }
.vs-row--deleted { background: color-mix(in oklab, var(--color-deleted) 18%, transparent); text-decoration: line-through; }
.vs-row[style*='--vs-group'] { box-shadow: inset 3px 0 0 var(--vs-group); }
.vs-row-icon { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); font-size: 11px; }
.vs-row-badge { position: absolute; right: 20px; top: 50%; transform: translateY(-50%); font-size: 10px; padding: 0 4px; border-radius: 4px; background: var(--secondary); }
.vs-col--removed { opacity: 0.35; text-decoration: line-through; }
.vs-col--highlight, .vs-col--key { background: color-mix(in oklab, var(--color-match) 20%, transparent); }
.vs-col--computed, .vs-col--added { background: color-mix(in oklab, var(--color-new) 18%, transparent); }
.vs-null { font-style: italic; color: var(--muted-foreground); outline: 1px dashed var(--color-null); outline-offset: -4px; border-radius: 4px; }
.vs-ghost-hidden { position: absolute; left: 0; right: 0; display: flex; align-items: center; justify-content: center; color: var(--muted-foreground); font-style: italic; }
.vs-scanner { position: absolute; left: 0; top: 0; height: 2px; background: var(--color-match); box-shadow: 0 0 8px var(--color-match); }
.vs-scissors { position: absolute; left: 0; top: 0; border-top: 2px dashed var(--color-dropped); }
.vs-scissors span { position: absolute; left: 0; top: -12px; font-size: 16px; }
.vs-counter { position: absolute; left: 0; top: 0; padding: 2px 8px; border-radius: 999px; background: var(--primary); color: var(--primary-foreground); font-size: 12px; font-weight: 600; white-space: nowrap; }
.vs-bracket { position: absolute; left: 0; top: 0; width: 12px; border: 2px solid var(--vs-group); border-right: none; border-radius: 6px 0 0 6px; font-size: 10px; }
.vs-svg-layer { position: absolute; left: 0; top: 0; color: var(--color-match); }
.vs-pair-line { fill: none; stroke: var(--color-match); stroke-width: 2; }
.vs-arrow { stroke-width: 2; }
.vs-arrow--info { stroke: var(--color-match); }
.vs-arrow--danger { stroke: var(--color-dropped); color: var(--color-dropped); }
@media (prefers-reduced-motion: reduce) {
  .vs-colhead, .vs-cell { transition: none; }
}
```

- [ ] **Step 4: Запустить, убедиться что проходят**

Run: `pnpm vitest run --project dom src/features/overlay/GhostTable.test.tsx src/features/overlay/Decorations.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Проверки, трекер, коммит**

Run: `pnpm check`. В `docs/PROGRESS.md`: `✅ (<дата>)` у **P6.18** (если не закрыт в задаче 8).

```bash
git add src/features/overlay/GhostTable.tsx src/features/overlay/Decorations.tsx src/features/overlay/overlay.css src/features/overlay/GhostTable.test.tsx src/features/overlay/Decorations.test.tsx docs/PROGRESS.md
git commit -m "feat(overlay): рендер призрачных таблиц и декораций

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: OverlayLayer поверх доски

**Files:**
- Create: `src/features/overlay/context.ts`, `src/features/overlay/OverlayErrorBoundary.tsx`, `src/features/overlay/OverlayLayer.tsx`
- Modify: `src/features/board/BoardCanvas.tsx`
- Test: `src/features/overlay/context.test.ts`, `src/features/overlay/OverlayErrorBoundary.test.tsx`

**Interfaces:**
- Consumes: `buildPlayback` (задача 8), `GhostTableView`, `Decorations` (задача 10), `useSceneStore` (задача 1), `useBoardStore` (Ф3: `schema`, `setDimmed`), `useReactFlow` и `ViewportPortal` из `@xyflow/react`, `MotionConfig`, `AnimatePresence`, `useReducedMotion` из `motion/react`.
- Produces:
  - `makeAnimatorContext(api: FlowApi, schema: SchemaSnapshot): AnimatorContext`, где `FlowApi = { getInternalNode(id: string): { internals: { positionAbsolute: { x: number; y: number } }; measured: { width?: number; height?: number } } | undefined; getNodes(): unknown[]; getNodesBounds(nodes: unknown[]): { x: number; y: number; width: number; height: number } }`; константа `WORK_AREA_GAP = 160`;
  - `OverlayErrorBoundary({ resetKey, onError, children })`;
  - `OverlayLayer(): JSX.Element | null` (рендерится только внутри `<ReactFlow>`).

- [ ] **Step 1: Написать падающие тесты**

`src/features/overlay/context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_SCHEMA } from './__fixtures__/traces';
import { WORK_AREA_GAP, makeAnimatorContext } from './context';

const api = {
  getInternalNode: (id: string) =>
    id === 'public.book'
      ? { internals: { positionAbsolute: { x: 40, y: 60 } }, measured: { width: 260, height: 300 } }
      : undefined,
  getNodes: () => [{ id: 'public.book' }],
  getNodesBounds: () => ({ x: 40, y: 60, width: 900, height: 500 }),
};

describe('makeAnimatorContext', () => {
  it('nodeRect берёт абсолютную позицию и измеренный размер ноды', () => {
    const ctx = makeAnimatorContext(api, EMPTY_SCHEMA);
    expect(ctx.nodeRect('public.book')).toEqual({ x: 40, y: 60, width: 260, height: 300 });
    expect(ctx.nodeRect('public.nope')).toBeNull();
  });

  it('рабочая зона правее всех таблиц доски', () => {
    const ctx = makeAnimatorContext(api, EMPTY_SCHEMA);
    expect(ctx.workArea).toEqual({ x: 40 + 900 + WORK_AREA_GAP, y: 60 });
  });

  it('пустая доска: рабочая зона в начале координат', () => {
    const ctx = makeAnimatorContext({ ...api, getNodes: () => [] }, EMPTY_SCHEMA);
    expect(ctx.workArea).toEqual({ x: 0, y: 0 });
  });
});
```

`src/features/overlay/OverlayErrorBoundary.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OverlayErrorBoundary } from './OverlayErrorBoundary';

function Boom(): never {
  throw new Error('сцена упала');
}

describe('OverlayErrorBoundary', () => {
  it('ловит ошибку сцены, зовёт onError и ничего не рисует', () => {
    const onError = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <OverlayErrorBoundary resetKey={1} onError={onError}>
        <Boom />
      </OverlayErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(container.textContent).toBe('');
    spy.mockRestore();
  });

  it('после смены resetKey снова рендерит детей', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <OverlayErrorBoundary resetKey={1} onError={() => {}}>
        <Boom />
      </OverlayErrorBoundary>,
    );
    rerender(
      <OverlayErrorBoundary resetKey={2} onError={() => {}}>
        <p>ок</p>
      </OverlayErrorBoundary>,
    );
    expect(screen.getByText('ок')).toBeTruthy();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `pnpm vitest run --project node src/features/overlay/context.test.ts && pnpm vitest run --project dom src/features/overlay/OverlayErrorBoundary.test.tsx`
Expected: FAIL (`Cannot find module './context'`).

- [ ] **Step 3: Реализовать контекст и границу ошибок**

`src/features/overlay/context.ts`:

```ts
import type { SchemaSnapshot } from '@/features/db/introspect';
import type { AnimatorContext } from './types';

export const WORK_AREA_GAP = 160;

// Минимум API React Flow, который нужен аниматорам (удобно подменять в тестах)
export interface FlowApi {
  getInternalNode(id: string): { internals: { positionAbsolute: { x: number; y: number } }; measured: { width?: number; height?: number } } | undefined;
  getNodes(): unknown[];
  getNodesBounds(nodes: unknown[]): { x: number; y: number; width: number; height: number };
}

export function makeAnimatorContext(api: FlowApi, schema: SchemaSnapshot): AnimatorContext {
  const nodes = api.getNodes();
  const bounds = nodes.length ? api.getNodesBounds(nodes) : null;
  return {
    schema,
    // рабочая зона сцены: свободное место справа от всех таблиц доски
    workArea: bounds ? { x: bounds.x + bounds.width + WORK_AREA_GAP, y: bounds.y } : { x: 0, y: 0 },
    nodeRect(tableId) {
      const n = api.getInternalNode(tableId);
      if (!n) return null;
      return {
        x: n.internals.positionAbsolute.x,
        y: n.internals.positionAbsolute.y,
        width: n.measured.width ?? 0,
        height: n.measured.height ?? 0,
      };
    },
  };
}
```

`src/features/overlay/OverlayErrorBoundary.tsx`:

```tsx
import { Component, type ReactNode } from 'react';

interface Props {
  resetKey: unknown;
  onError: (error: Error) => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
  key: unknown;
}

// Ошибка рендера сцены не должна ронять доску и редактор: сцена просто закрывается
export class OverlayErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    if (import.meta.env.DEV) console.error('[overlay] ошибка сцены', error);
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
```

- [ ] **Step 4: Запустить, убедиться что проходят**

Run: `pnpm vitest run --project node src/features/overlay/context.test.ts && pnpm vitest run --project dom src/features/overlay/OverlayErrorBoundary.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Реализовать OverlayLayer**

`src/features/overlay/OverlayLayer.tsx`:

```tsx
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import { AnimatePresence, MotionConfig, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useBoardStore } from '@/stores/board';
import { effectiveSpeed, useSceneStore } from '@/stores/scene';
import { makeAnimatorContext } from './context';
import { Decorations } from './Decorations';
import { GhostTableView } from './GhostTable';
import { frameBounds } from './geometry';
import { OverlayErrorBoundary } from './OverlayErrorBoundary';
import { buildPlayback } from './playback';
import './overlay.css';

// Доля длительности фазы, которую занимает движение; остаток пауза, чтобы глаз успел
const MOTION_SHARE = 0.85;

export function OverlayLayer() {
  const trace = useSceneStore((s) => s.trace);
  const playback = useSceneStore((s) => s.playback);
  const phaseIndex = useSceneStore((s) => s.phaseIndex);
  const instant = useSceneStore((s) => s.instant);
  const speed = useSceneStore(effectiveSpeed);
  const followCamera = useSceneStore((s) => s.followCamera);
  const schema = useBoardStore((s) => s.schema);
  const rf = useReactFlow();
  const reduced = useReducedMotion() ?? false;
  const lastCamera = useRef('');

  // новая трасса → новое проигрывание
  useEffect(() => {
    const scene = useSceneStore.getState();
    if (!trace || !schema) {
      scene.setPlayback(null);
      return;
    }
    scene.setPlayback(buildPlayback(trace, makeAnimatorContext(rf, schema)));
  }, [trace, schema, rf]);

  const active = !!playback && playback.phases.length > 0;

  // пока идёт сцена, базовая доска приглушена (один CSS-класс на контейнере)
  useEffect(() => {
    useBoardStore.getState().setDimmed(active);
    return () => useBoardStore.getState().setDimmed(false);
  }, [active]);

  const phase = active ? playback.phases[Math.min(phaseIndex, playback.phases.length - 1)] : null;
  const durationSec = !phase || instant || reduced ? 0 : ((phase.durationMs / speed) * MOTION_SHARE) / 1000;

  // «камера следит»: вписываем сцену, только если её границы изменились
  useEffect(() => {
    if (!phase || !followCamera) return;
    const b = frameBounds(phase.frame);
    if (!b) return;
    const key = `${Math.round(b.x)}:${Math.round(b.y)}:${Math.round(b.width)}:${Math.round(b.height)}`;
    if (key === lastCamera.current) return;
    lastCamera.current = key;
    void rf.fitBounds(b, { padding: 0.2, duration: durationSec * 1000 });
  }, [phase, followCamera, rf, durationSec]);

  if (!phase) return null;
  return (
    <ViewportPortal>
      <OverlayErrorBoundary resetKey={trace} onError={() => useSceneStore.getState().close()}>
        <MotionConfig reducedMotion="user" transition={{ duration: durationSec, ease: 'easeInOut' }}>
          <div className="vs-overlay" data-testid="overlay" style={{ ['--vs-dur' as string]: `${durationSec}s` }}>
            <AnimatePresence>
              {phase.frame.tables.map((t) => (
                <GhostTableView key={t.id} table={t} />
              ))}
            </AnimatePresence>
            <Decorations frame={phase.frame} />
          </div>
        </MotionConfig>
      </OverlayErrorBoundary>
    </ViewportPortal>
  );
}
```

- [ ] **Step 6: Встроить в доску**

В `src/features/board/BoardCanvas.tsx` добавить импорт `import { OverlayLayer } from '@/features/overlay/OverlayLayer';` и дочерний элемент внутри `<ReactFlow ...>` рядом с `Background` / `Controls` / `MiniMap`:

```tsx
<OverlayLayer />
```

Проверить, что `BoardCanvas` не подписан ни на одно поле `useSceneStore` (`grep -n "useSceneStore" src/features/board/BoardCanvas.tsx` ничего не находит). Если подписка есть, убрать: доска не должна перерисовываться при смене фаз.

- [ ] **Step 7: Ручная проверка в браузере**

Run: `pnpm dev`, открыть урок с датасетом bookstore, набрать `select title, price from book where price > 500 order by price desc limit 3`.
Expected: призрак `book` появляется поверх таблицы на доске и уезжает вправо, доска приглушается, WHERE оставляет 7 строк (счётчик `11 → 7`), ORDER BY переставляет строки, ножницы отрезают до 3 строк: «Изучаем Python», «Python. К вершинам мастерства», «Простой Python». Pan/zoom во время сцены двигают призраков вместе с доской.

- [ ] **Step 8: Проверки, трекер, коммит**

Run: `pnpm check`. В `docs/PROGRESS.md`: `✅ (<дата>)` у **P6.2**, **P6.3**, **P6.6**, **P6.12**, **P6.19**.

```bash
git add src/features/overlay/context.ts src/features/overlay/context.test.ts src/features/overlay/OverlayErrorBoundary.tsx src/features/overlay/OverlayErrorBoundary.test.tsx src/features/overlay/OverlayLayer.tsx src/features/board/BoardCanvas.tsx docs/PROGRESS.md
git commit -m "feat(overlay): слой сцены поверх доски с общей камерой

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Плеер и таймлайн

**Files:**
- Create: `src/features/timeline/usePlayer.ts`, `src/features/timeline/Timeline.tsx`
- Modify: `src/features/shell/BoardPane.tsx` (панель таймлайна)
- Test: `src/features/timeline/usePlayer.test.tsx`, `src/features/timeline/Timeline.test.tsx`

**Interfaces:**
- Consumes: `useSceneStore`, `effectiveSpeed` (задача 1), `lastPhaseOfStage`, `stageOfPhase` (задача 8), `stageLabel` (задача 3); shadcn `Button`, `Slider`, `ToggleGroup`/`ToggleGroupItem` из `@/components/ui/*`.
- Produces: `usePlayer(): void` (таймер фаз), `Timeline(): JSX.Element`. Атрибуты: `data-testid="timeline"`, `"stage-chip"` (+ `data-active`), `"timeline-caption"`, `"player-toggle"`, `"player-prev"`, `"player-next"`, `"player-scrub"`, `"final-only-note"`.

- [ ] **Step 1: Написать падающие тесты**

`src/features/timeline/usePlayer.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phase, Playback } from '@/features/overlay/types';
import { useSceneStore } from '@/stores/scene';
import { usePlayer } from './usePlayer';

const pb = (n: number, ms = 500): Playback => ({
  phases: Array.from({ length: n }, (_, i): Phase => ({ id: `p${i}`, stageIndex: 0, caption: '', durationMs: ms, frame: { tables: [], decorations: [] } })),
  stageStarts: [0],
});

describe('usePlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSceneStore.setState(useSceneStore.getInitialState(), true);
  });
  afterEach(() => vi.useRealTimers());

  it('автоплей идёт на 2x и останавливается на последней фазе', () => {
    renderHook(() => usePlayer());
    act(() => useSceneStore.getState().setPlayback(pb(3)));
    act(() => vi.advanceTimersByTime(250));
    expect(useSceneStore.getState().phaseIndex).toBe(1);
    act(() => vi.advanceTimersByTime(250));
    expect(useSceneStore.getState().phaseIndex).toBe(2);
    act(() => vi.advanceTimersByTime(250));
    expect(useSceneStore.getState().playing).toBe(false);
  });

  it('обычное проигрывание учитывает скорость 0.5x', () => {
    renderHook(() => usePlayer());
    act(() => {
      useSceneStore.getState().setAutoplay(false);
      useSceneStore.getState().setSpeed(0.5);
      useSceneStore.getState().setPlayback(pb(3));
      useSceneStore.getState().seek(0);
      useSceneStore.getState().play();
    });
    act(() => vi.advanceTimersByTime(999));
    expect(useSceneStore.getState().phaseIndex).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(useSceneStore.getState().phaseIndex).toBe(1);
  });

  it('смена playback перезапускает таймер', () => {
    renderHook(() => usePlayer());
    act(() => useSceneStore.getState().setPlayback(pb(5)));
    act(() => vi.advanceTimersByTime(200));
    act(() => useSceneStore.getState().setPlayback(pb(2, 1000)));
    act(() => vi.advanceTimersByTime(400));
    expect(useSceneStore.getState().phaseIndex).toBe(0);
    act(() => vi.advanceTimersByTime(100));
    expect(useSceneStore.getState().phaseIndex).toBe(1);
  });
});
```

`src/features/timeline/Timeline.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fullPipelineTrace, testCtx } from '@/features/overlay/__fixtures__/traces';
import { buildPlayback } from '@/features/overlay/playback';
import { useSceneStore } from '@/stores/scene';
import { Timeline } from './Timeline';

function load(autoplay = false) {
  const trace = fullPipelineTrace();
  const s = useSceneStore.getState();
  s.setAutoplay(autoplay);
  s.setTrace(trace, s.nextGeneration());
  useSceneStore.getState().setPlayback(buildPlayback(trace, testCtx()));
}

describe('Timeline', () => {
  beforeEach(() => useSceneStore.setState(useSceneStore.getInitialState(), true));

  it('чипы стадий в логическом порядке, активна последняя', () => {
    load();
    render(<Timeline />);
    const chips = screen.getAllByTestId('stage-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['FROM', 'WHERE', 'SELECT', 'ORDER BY', 'LIMIT']);
    expect(chips[4].getAttribute('data-active')).toBe('true');
  });

  it('клик по чипу прыгает к концу стадии мгновенно', () => {
    load();
    render(<Timeline />);
    fireEvent.click(screen.getAllByTestId('stage-chip')[1]);
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(4);
    expect(st.instant).toBe(true);
    expect(screen.getByTestId('timeline-caption').textContent).toBe('WHERE price > 500: осталось 3 из 5');
  });

  it('подпись в aria-live', () => {
    load();
    render(<Timeline />);
    expect(screen.getByTestId('timeline-caption').getAttribute('aria-live')).toBe('polite');
  });

  it('кнопки шагов и плей', () => {
    load();
    render(<Timeline />);
    fireEvent.click(screen.getByTestId('player-prev'));
    expect(useSceneStore.getState().phaseIndex).toBe(9);
    fireEvent.click(screen.getByTestId('player-next'));
    expect(useSceneStore.getState().phaseIndex).toBe(10);
    fireEvent.click(screen.getByTestId('player-toggle'));
    expect(useSceneStore.getState().playing).toBe(true);
  });

  it('final-only показывает причину', () => {
    const s = useSceneStore.getState();
    act(() => s.setTrace({ ...fullPipelineTrace(), mode: 'final-only', fallbackReason: 'JOIN LATERAL' }, s.nextGeneration()));
    render(<Timeline />);
    expect(screen.getByTestId('final-only-note').textContent).toBe('Пошаговый разбор для этой конструкции пока не умею: JOIN LATERAL');
    expect(screen.queryAllByTestId('stage-chip')).toHaveLength(0);
  });

  it('без трассы таймлайн пустой и не падает', () => {
    render(<Timeline />);
    expect(screen.getByTestId('timeline').textContent).toContain('Напиши запрос');
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `pnpm vitest run --project dom src/features/timeline`
Expected: FAIL (`Cannot find module './usePlayer'`, `'./Timeline'`).

- [ ] **Step 3: Реализовать usePlayer**

`src/features/timeline/usePlayer.ts`:

```ts
import { useEffect } from 'react';
import { effectiveSpeed, useSceneStore } from '@/stores/scene';

// Таймер проигрывания: через длительность фазы (с учётом скорости) переходим к следующей
export function usePlayer(): void {
  const playing = useSceneStore((s) => s.playing);
  const phaseIndex = useSceneStore((s) => s.phaseIndex);
  const playback = useSceneStore((s) => s.playback);
  const speed = useSceneStore(effectiveSpeed);
  const duration = playback?.phases[phaseIndex]?.durationMs ?? 0;

  useEffect(() => {
    if (!playing || !playback) return;
    const id = window.setTimeout(() => useSceneStore.getState().advance(), duration / speed);
    return () => window.clearTimeout(id);
  }, [playing, phaseIndex, playback, duration, speed]);
}
```

- [ ] **Step 4: Реализовать Timeline**

`src/features/timeline/Timeline.tsx`:

```tsx
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { stageLabel } from '@/features/overlay/labels';
import { lastPhaseOfStage, stageOfPhase } from '@/features/overlay/playback';
import { useSceneStore } from '@/stores/scene';
import { usePlayer } from './usePlayer';

export function Timeline() {
  usePlayer();
  const trace = useSceneStore((s) => s.trace);
  const playback = useSceneStore((s) => s.playback);
  const phaseIndex = useSceneStore((s) => s.phaseIndex);
  const playing = useSceneStore((s) => s.playing);
  const speed = useSceneStore((s) => s.speed);
  const autoplay = useSceneStore((s) => s.autoplay);
  const followCamera = useSceneStore((s) => s.followCamera);
  const store = useSceneStore.getState;

  if (!trace) {
    return (
      <div data-testid="timeline" className="flex h-full items-center px-3 text-sm text-muted-foreground">
        Напиши запрос, и здесь появятся шаги его выполнения
      </div>
    );
  }

  if (trace.mode === 'final-only') {
    return (
      <div data-testid="timeline" className="flex h-full items-center px-3 text-sm">
        <p data-testid="final-only-note" aria-live="polite">
          Пошаговый разбор для этой конструкции пока не умею: {trace.fallbackReason ?? 'неизвестная конструкция'}
        </p>
      </div>
    );
  }

  const phases = playback?.phases ?? [];
  const current = phases[phaseIndex];
  const activeStage = playback ? stageOfPhase(playback, phaseIndex) : -1;

  return (
    <div data-testid="timeline" className="flex h-full flex-col gap-1 px-3 py-1">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-1" role="list" aria-label="Шаги выполнения запроса">
          {trace.stages.map((stage, i) => (
            <button
              key={stage.id}
              type="button"
              role="listitem"
              data-testid="stage-chip"
              data-active={i === activeStage}
              aria-current={i === activeStage ? 'step' : undefined}
              className="rounded-md border px-2 py-0.5 font-mono text-xs data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
              onClick={() => playback && store().seek(lastPhaseOfStage(playback, i))}
            >
              {stageLabel(stage)}
            </button>
          ))}
        </div>
        <Button data-testid="player-prev" size="icon" variant="ghost" aria-label="Шаг назад" onClick={() => store().step(-1)}>
          <SkipBack />
        </Button>
        <Button data-testid="player-toggle" size="icon" variant="ghost" aria-label={playing ? 'Пауза' : 'Играть'} onClick={() => store().toggle()}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button data-testid="player-next" size="icon" variant="ghost" aria-label="Шаг вперёд" onClick={() => store().step(1)}>
          <SkipForward />
        </Button>
        <ToggleGroup
          type="single"
          size="sm"
          value={String(speed)}
          onValueChange={(v) => v && store().setSpeed(Number(v) as 0.5 | 1 | 2)}
          aria-label="Скорость"
        >
          <ToggleGroupItem value="0.5">0.5x</ToggleGroupItem>
          <ToggleGroupItem value="1">1x</ToggleGroupItem>
          <ToggleGroupItem value="2">2x</ToggleGroupItem>
        </ToggleGroup>
        <Button size="sm" variant={autoplay ? 'secondary' : 'ghost'} aria-pressed={autoplay} onClick={() => store().setAutoplay(!autoplay)}>
          Автоплей
        </Button>
        <Button size="sm" variant={followCamera ? 'secondary' : 'ghost'} aria-pressed={followCamera} onClick={() => store().setFollowCamera(!followCamera)}>
          Камера следит
        </Button>
      </div>
      {phases.length > 1 ? (
        <Slider
          data-testid="player-scrub"
          min={0}
          max={phases.length - 1}
          step={1}
          value={[phaseIndex]}
          onValueChange={(v) => store().seek(v[0] ?? 0)}
          aria-label="Позиция в сцене"
        />
      ) : null}
      <p data-testid="timeline-caption" aria-live="polite" className="truncate text-sm">
        {current?.caption ?? ''}
      </p>
    </div>
  );
}
```

Если в проекте shadcn-компоненты `slider` или `toggle-group` ещё не сгенерированы, добавить: `pnpm dlx shadcn@latest add slider toggle-group`.

- [ ] **Step 5: Запустить, убедиться что проходят**

Run: `pnpm vitest run --project dom src/features/timeline`
Expected: PASS, 9 tests.

- [ ] **Step 6: Встроить в правую колонку**

В `src/features/shell/BoardPane.tsx` в панели таймлайна (вторая панель вертикальной `ResizablePanelGroup`, между доской и редактором) отрендерить:

```tsx
<Timeline />
```

с импортом `import { Timeline } from '@/features/timeline/Timeline';`. Если в панели был временный плейсхолдер таймлайна, заменить его.

- [ ] **Step 7: Проверки, трекер, коммит**

Run: `pnpm check`. В `docs/PROGRESS.md`: `✅ (<дата>)` у **P6.5**, **P6.13**, **P6.14**, **P6.15**, **P6.16**.

```bash
git add src/features/timeline src/features/shell/BoardPane.tsx src/components/ui docs/PROGRESS.md
git commit -m "feat(timeline): плеер шагов: чипы, скраб, скорость, автоплей, подписи

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Горячие клавиши доски и закрытие сцены

**Files:**
- Create: `src/features/board/useBoardHotkeys.ts`
- Modify: `src/features/shell/BoardPane.tsx`, `src/features/editor/useLiveTrace.ts`
- Test: `src/features/board/useBoardHotkeys.test.tsx`

**Interfaces:**
- Consumes: `useSceneStore` (задача 1).
- Produces: `useBoardHotkeys(ref: React.RefObject<HTMLElement | null>): void`: `Space` → `toggle()`, `←` → `step(-1)`, `→` → `step(1)`, `Esc` → `close()`; срабатывает только если фокус внутри контейнера и цель события не поле ввода (`input`, `textarea`, `[contenteditable]`, `.cm-editor`).

- [ ] **Step 1: Написать падающий тест**

`src/features/board/useBoardHotkeys.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Playback } from '@/features/overlay/types';
import { useSceneStore } from '@/stores/scene';
import { useBoardHotkeys } from './useBoardHotkeys';

function Board() {
  const ref = useRef<HTMLDivElement>(null);
  useBoardHotkeys(ref);
  return (
    <div ref={ref} tabIndex={0} data-testid="board">
      <input data-testid="field" />
    </div>
  );
}

const pb: Playback = {
  phases: [0, 1, 2].map((i) => ({ id: `p${i}`, stageIndex: 0, caption: '', durationMs: 500, frame: { tables: [], decorations: [] } })),
  stageStarts: [0],
};

describe('useBoardHotkeys', () => {
  beforeEach(() => {
    useSceneStore.setState(useSceneStore.getInitialState(), true);
    useSceneStore.getState().setAutoplay(false);
    useSceneStore.getState().setPlayback(pb);
  });

  it('стрелки шагают, пробел играет, Esc закрывает', () => {
    render(<Board />);
    const board = screen.getByTestId('board');
    fireEvent.keyDown(board, { key: 'ArrowLeft' });
    expect(useSceneStore.getState().phaseIndex).toBe(1);
    fireEvent.keyDown(board, { key: 'ArrowRight' });
    expect(useSceneStore.getState().phaseIndex).toBe(2);
    fireEvent.keyDown(board, { key: ' ' });
    expect(useSceneStore.getState().playing).toBe(true);
    fireEvent.keyDown(board, { key: 'Escape' });
    expect(useSceneStore.getState().playback).toBeNull();
  });

  it('пробел в поле ввода не трогает плеер', () => {
    render(<Board />);
    fireEvent.keyDown(screen.getByTestId('field'), { key: ' ' });
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'ArrowLeft' });
    const st = useSceneStore.getState();
    expect(st.playing).toBe(false);
    expect(st.phaseIndex).toBe(2);
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `pnpm vitest run --project dom src/features/board/useBoardHotkeys.test.tsx`
Expected: FAIL (`Cannot find module './useBoardHotkeys'`).

- [ ] **Step 3: Реализовать**

`src/features/board/useBoardHotkeys.ts`:

```ts
import { type RefObject, useEffect } from 'react';
import { useSceneStore } from '@/stores/scene';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest('input, textarea, select, [contenteditable="true"], .cm-editor');
}

// Клавиши плеера работают, когда фокус на доске и не в поле ввода
export function useBoardHotkeys(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const scene = useSceneStore.getState();
      if (e.key === ' ') {
        e.preventDefault();
        scene.toggle();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scene.step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        scene.step(1);
      } else if (e.key === 'Escape') {
        scene.close();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [ref]);
}
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `pnpm vitest run --project dom src/features/board/useBoardHotkeys.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Подключить к доске и редактору**

В `src/features/shell/BoardPane.tsx` обернуть панель доски (ту, где рендерится `BoardCanvas`) в фокусируемый контейнер:

```tsx
const boardRef = useRef<HTMLDivElement>(null);
useBoardHotkeys(boardRef);
// ...
<div ref={boardRef} tabIndex={0} data-testid="board" className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
  <BoardCanvas />
</div>
```

с импортами `useRef` из `react` и `useBoardHotkeys` из `@/features/board/useBoardHotkeys`. Если `data-testid="board"` уже стоит на другом элементе, перенести его на этот контейнер.

В `src/features/editor/useLiveTrace.ts` в обработчике изменения текста (до парсинга) добавить ветку пустого запроса:

```ts
if (text.trim() === '') {
  useSceneStore.getState().close();
  return;
}
```

Затем проверить, что после успешной трассы хук делает `useSceneStore.getState().setTrace(trace, generation)` с поколением из `nextGeneration()`, полученным до начала трассировки (это контракт Ф4/Ф5; если вызова нет, добавить его сразу после `await sandbox.preview((db) => traceStatement(stmt, db, opts))`).

- [ ] **Step 6: Проверки, трекер, коммит**

Run: `pnpm check`. В `docs/PROGRESS.md`: `✅ (<дата>)` у **P6.17**.

```bash
git add src/features/board/useBoardHotkeys.ts src/features/board/useBoardHotkeys.test.tsx src/features/shell/BoardPane.tsx src/features/editor/useLiveTrace.ts docs/PROGRESS.md
git commit -m "feat(board): клавиши плеера на доске, Esc и пустой запрос закрывают сцену

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: E2E сцены, отсутствие перерисовки доски и замер fps

**Files:**
- Create: `src/lib/renderCount.ts`, `tests/e2e/overlay.spec.ts`, `tests/e2e/overlay-perf.spec.ts`
- Modify: `src/features/board/TableNode.tsx`, `playwright.config.ts`, `package.json`

**Interfaces:**
- Consumes: всё вышеперечисленное; селекторы `data-testid` из задач 10-13; редактор CodeMirror (`.cm-content`, Ф4).
- Produces: `bumpRenderCount(name: string): void` и `window.__vsRenderCounts: Record<string, number>` (только `import.meta.env.DEV`); скрипт `pnpm e2e:perf`.

- [ ] **Step 1: Счётчик рендеров**

`src/lib/renderCount.ts`:

```ts
declare global {
  interface Window {
    __vsRenderCounts?: Record<string, number>;
  }
}

// Только для dev и e2e: считает рендеры компонента, в проде вызов ничего не делает
export function bumpRenderCount(name: string): void {
  if (!import.meta.env.DEV) return;
  const counts = (window.__vsRenderCounts ??= {});
  counts[name] = (counts[name] ?? 0) + 1;
}
```

В `src/features/board/TableNode.tsx` первой строкой тела компонента `TableNode` добавить `bumpRenderCount('tableNode');` и импорт `import { bumpRenderCount } from '@/lib/renderCount';`.

- [ ] **Step 2: Перф-тесты только по флагу**

В `playwright.config.ts` в объект `defineConfig({...})` добавить:

```ts
grepInvert: process.env.PERF ? undefined : /@perf/,
```

В `package.json` в `scripts` добавить:

```json
"e2e:perf": "PERF=1 playwright test --grep @perf"
```

- [ ] **Step 3: Написать e2e-тест сцен**

`tests/e2e/overlay.spec.ts`:

```ts
import { expect, type Page, test } from '@playwright/test';

const QUERY = 'select title, price from book where price > 500 order by price desc limit 3';

async function openBoard(page: Page) {
  await page.goto('/');
  await page.getByTestId('lesson-link').first().click();
  await expect(page.getByTestId('board')).toBeVisible();
  // ждём, пока песочница поднимет Postgres и доска нарисует таблицы
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });
}

async function typeQuery(page: Page, sql: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(sql);
}

test('сцена WHERE → ORDER BY → LIMIT проигрывается до результата', async ({ page }) => {
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('stage-chip')).toHaveText(['FROM', 'WHERE', 'SELECT', 'ORDER BY', 'LIMIT'], { timeout: 5_000 });
  // автоплей на 2x доходит до конца: в призраке три строки
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть');
});

test('клик по чипу WHERE показывает 7 строк мгновенно', async ({ page }) => {
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
  await page.getByTestId('stage-chip').nth(1).click();
  await expect(page.getByTestId('ghost-row')).toHaveCount(7);
  await expect(page.getByTestId('timeline-caption')).toContainText('WHERE');
});

test('базовая доска не перерисовывается во время сцены', async ({ page }) => {
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
  const before = await page.evaluate(() => window.__vsRenderCounts?.tableNode ?? 0);
  // проигрываем сцену заново и скрабим: TableNode не должен рендериться
  await page.getByTestId('player-toggle').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('stage-chip').nth(0).click();
  await page.getByTestId('stage-chip').nth(3).click();
  const after = await page.evaluate(() => window.__vsRenderCounts?.tableNode ?? 0);
  expect(after).toBe(before);
});

test('Esc на доске закрывает сцену и снимает приглушение', async ({ page }) => {
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('overlay')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('board').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('overlay')).toHaveCount(0);
});
```

- [ ] **Step 4: Написать перф-тест**

`tests/e2e/overlay-perf.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// Запуск: pnpm e2e:perf (в CI не гоняется: headless-браузер не даёт честных fps)
test('@perf pan/zoom во время анимации держит ≥55 fps', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('lesson-link').first().click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => useSceneSpeedForPerf());

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.type('select title, price from book where price > 500 order by price desc');

  // считаем кадры requestAnimationFrame 2 секунды, пока крутим колесо над доской
  const fps = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (t: number) => {
          frames += 1;
          if (t - start < 2000) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (t - start));
        };
        requestAnimationFrame(tick);
      }),
  );
  const box = await page.getByTestId('board').boundingBox();
  if (!box) throw new Error('доска не найдена');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.wheel(0, i % 2 === 0 ? 120 : -120);
    await page.waitForTimeout(80);
  }
  expect(await fps).toBeGreaterThanOrEqual(55);
});

// Медленная скорость, чтобы анимация шла всё время замера
function useSceneSpeedForPerf() {
  localStorage.setItem('vs-scene', JSON.stringify({ state: { speed: 0.5, autoplay: true, followCamera: false }, version: 0 }));
}
```

Важно: `page.evaluate(() => useSceneSpeedForPerf())` не видит функцию из файла теста. Заменить вызов на встроенный код перед `page.goto` через `addInitScript`:

```ts
await page.addInitScript(() => {
  localStorage.setItem('vs-scene', JSON.stringify({ state: { speed: 0.5, autoplay: true, followCamera: false }, version: 0 }));
});
```

Итоговый файл после правки:

```ts
import { expect, test } from '@playwright/test';

// Запуск: pnpm e2e:perf (в CI не гоняется: headless-браузер не даёт честных fps)
test('@perf pan/zoom во время анимации держит ≥55 fps', async ({ page }) => {
  // медленная скорость, чтобы анимация шла всё время замера
  await page.addInitScript(() => {
    localStorage.setItem('vs-scene', JSON.stringify({ state: { speed: 0.5, autoplay: true, followCamera: false }, version: 0 }));
  });
  await page.goto('/');
  await page.getByTestId('lesson-link').first().click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });

  await page.locator('.cm-content').click();
  await page.keyboard.type('select title, price from book where price > 500 order by price desc');
  await expect(page.getByTestId('overlay')).toBeVisible({ timeout: 10_000 });

  // считаем кадры requestAnimationFrame 2 секунды, пока крутим колесо над доской
  const fps = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (t: number) => {
          frames += 1;
          if (t - start < 2000) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (t - start));
        };
        requestAnimationFrame(tick);
      }),
  );
  const box = await page.getByTestId('board').boundingBox();
  if (!box) throw new Error('доска не найдена');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.wheel(0, i % 2 === 0 ? 120 : -120);
    await page.waitForTimeout(80);
  }
  expect(await fps).toBeGreaterThanOrEqual(55);
});
```

Записать в репозиторий только итоговый вариант.

- [ ] **Step 5: Запустить e2e**

Run: `pnpm e2e tests/e2e/overlay.spec.ts`
Expected: PASS, 4 tests. Если тест «базовая доска не перерисовывается» падает, найти подписку доски на `useSceneStore` или пересоздание `nodes` при смене фаз (React DevTools Profiler → Highlight updates) и устранить её, тест не ослаблять.

Run (локально, на M1 или быстрее): `pnpm e2e:perf`
Expected: PASS, fps ≥ 55. Результат замера записать в коммит-сообщение.

- [ ] **Step 6: Проверки, трекер, коммит**

Run: `pnpm check`. В `docs/PROGRESS.md`: `✅ (<дата>)` у **P6.20**. Проверить, что все пункты P6.2-P6.21 стоят в ✅, и поставить ✅ у строки «Ф6 Оверлей и плеер» в сводке.

```bash
git add src/lib/renderCount.ts src/features/board/TableNode.tsx tests/e2e/overlay.spec.ts tests/e2e/overlay-perf.spec.ts playwright.config.ts package.json docs/PROGRESS.md
git commit -m "test(overlay): e2e сцен, проверка перерисовки доски и замер fps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Покрытие пунктов трекера

- P6.2 OverlayLayer с камерой из viewport: задача 11.
- P6.3 Призраки из позиций нод, приглушение оригиналов: задачи 3 и 11.
- P6.4 Модель сцены и интерфейс аниматора: задача 1.
- P6.5 Раннер фаз (play, pause, шаг, скорость): задачи 1 и 12.
- P6.6 Аниматор scan: задачи 3 и 11.
- P6.7 Аниматор filter: задача 4.
- P6.8 Аниматор project: задача 5.
- P6.9 Аниматор distinct: задача 6.
- P6.10 Аниматор sort: задача 7.
- P6.11 Аниматор limit: задача 7.
- P6.12 «Камера следит», рабочая зона: задача 11.
- P6.13 Таймлайн: задача 12.
- P6.14 Автоплей 2x: задачи 1 и 12.
- P6.15 Скраб назад мгновенный: задачи 1 и 12.
- P6.16 aria-live, reduced motion: задачи 10, 11, 12.
- P6.17 Esc, Space, стрелки: задача 13.
- P6.18 Сжатый режим: задачи 3, 8, 10.
- P6.19 ErrorBoundary: задача 11.
- P6.20 Доска не ре-рендерится, fps: задача 14.
- P6.21 Пустой результат с подсказкой: задача 9.
