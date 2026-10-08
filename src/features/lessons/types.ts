import type { DatasetId } from '../db/datasets';

export interface LessonMeta {
  id: string;
  title: string;
  chapter: string;
  number: string;
  order: number;
  dataset: DatasetId;
  board?: { tables?: string[]; layout?: 'auto' | Record<string, { x: number; y: number }> };
  initialQuery?: string;
  docs: string[];
  course?: string[];
  tags: string[];
  mvp?: boolean;
  path: string;
}
