import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { block } from './contrast';

const css = readFileSync('src/index.css', 'utf8');

const SEMANTIC = ['kept', 'dropped', 'match', 'null', 'new', 'changed', 'deleted'];
const TOKENS = [
  ...SEMANTIC.flatMap((t) => [t, `${t}-bg`]),
  'board-dot',
  'touched',
  'touched-fg',
  ...['keyword', 'string', 'number', 'comment', 'identifier', 'operator', 'function'].map((t) => `sql-${t}`),
  ...Array.from({ length: 8 }, (_, i) => `group-${i + 1}`),
];

describe('дизайн-токены', () => {
  it.each(TOKENS)('--%s задан в светлой и тёмной теме', (token) => {
    expect(block(':root')).toContain(`--${token}:`);
    expect(block('.dark')).toContain(`--${token}:`);
  });

  it.each(TOKENS)('--%s доступен в Tailwind как цвет', (token) => {
    expect(css).toContain(`--color-${token}: var(--${token});`);
  });

  it('шрифты Geist подключены в теме', () => {
    expect(css).toContain("--font-sans: 'Geist Variable'");
    expect(css).toContain("--font-mono: 'Geist Mono Variable'");
  });
});
