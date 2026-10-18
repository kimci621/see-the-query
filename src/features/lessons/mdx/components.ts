import { Callout, Cheatsheet, DontDoThis, TlDr } from './Callouts';
import { Scene, Step } from './Scene';
import { SqlBlock } from './SqlBlock';
import { C, T } from './TermLinks';

// Компоненты, доступные в MDX без импорта. Список имён дублирует tests/content/lessons.test.ts (MDX_TAGS)
export const mdxComponents = { pre: SqlBlock, TlDr, Callout, DontDoThis, Cheatsheet, Scene, Step, T, C };
