import { Callout, Cheatsheet, DontDoThis, TlDr } from './Callouts';
import { Scene, Step } from './Scene';
import { SqlBlock } from './SqlBlock';
import { C, T } from './TermLinks';

// Компоненты, доступные в MDX без импорта. По этому же списку tests/content/lessons.test.ts проверяет теги уроков
export const mdxComponents = { pre: SqlBlock, TlDr, Callout, DontDoThis, Cheatsheet, Scene, Step, T, C };
