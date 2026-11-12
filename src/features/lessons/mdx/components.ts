import { BTreeScene } from './BTreeScene';
import { Callout, Cheatsheet, DontDoThis, TlDr } from './Callouts';
import { MvccPage } from './MvccPage';
import { Nesting } from './Nesting';
import { Scene, Step } from './Scene';
import { SqlBlock } from './SqlBlock';
import { C, T } from './TermLinks';
import { TwoSessionsBlock } from './TwoSessionsBlock';

// Компоненты, доступные в MDX без импорта. По этому же списку tests/content/lessons.test.ts проверяет теги уроков
export const mdxComponents = {
  BTreeScene,
  pre: SqlBlock,
  TlDr,
  Callout,
  DontDoThis,
  Cheatsheet,
  Scene,
  Step,
  T,
  C,
  Nesting,
  MvccPage,
  TwoSessions: TwoSessionsBlock,
};
