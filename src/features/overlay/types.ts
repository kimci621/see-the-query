import type { SchemaSnapshot } from '@/features/db/introspect';
import type { Column, RowKey, Stage } from '@/features/tracer/types';

// Состояние строки на сцене: от него зависят цвет, иконка и зачёркивание
export type RowState =
  | 'normal'
  | 'kept'
  | 'dropped'
  | 'unknown'
  | 'null-filled'
  | 'new'
  | 'changed'
  | 'deleted'
  | 'cut'
  | 'matched';

export interface GhostColumn {
  name: string;
  type?: string;
  source?: Column['source']; // откуда колонка: различает одноимённые колонки JOIN
  state: 'normal' | 'highlight' | 'removed' | 'computed' | 'key' | 'added' | 'error';
}

export interface GhostRow {
  key: RowKey;
  values: unknown[];
  state: RowState;
  group?: number;
  badge?: string;
  cellNotes?: Record<number, string>;
  cellMarks?: Record<number, 'default' | 'changed'>;
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
  // колонки, которые нода на доске прячет в «+N колонки» (свёртка, спека 3.4): 'b.pages'
  fold?: string[];
  // заглушки «+N колонки», как у нод: по одной на таблицу-источник, at - сколько показанных
  // колонок стоит левее заглушки (после последней колонки своей таблицы)
  folds?: { at: number; count: number }[];
  // номера показанных колонок в выходе стадии: по ним номера колонок трассировщика ложатся на призрак
  shown?: number[];
}

export type Decoration =
  | {
      kind: 'pair-line';
      id: string;
      from: { table: string; row: RowKey; col: string };
      to: { table: string; row: RowKey; col: string };
    }
  | { kind: 'scanner'; table: string; rowIndex: number }
  | { kind: 'scissors'; table: string; afterRow: number }
  | { kind: 'counter'; id: string; x: number; y: number; text: string }
  | { kind: 'bracket'; table: string; fromRow: number; toRow: number; color: number; label?: string }
  | {
      kind: 'arrow';
      id: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
      tone: 'info' | 'danger';
    };

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
  // имена колонок, которые нода таблицы прячет в «+N колонки»: призрак берёт ту же свёртку
  folded(tableId: string): string[];
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
