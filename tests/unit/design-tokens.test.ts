import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/index.css', 'utf8');

const SEMANTIC = ['kept', 'dropped', 'match', 'null', 'new', 'changed', 'deleted'];
const TOKENS = [
  ...SEMANTIC.flatMap((t) => [t, `${t}-bg`]),
  'board-dot',
  ...Array.from({ length: 8 }, (_, i) => `group-${i + 1}`),
];

// Содержимое первого блока с данным селектором
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match?.[2] ?? '';
}

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
