import { describe, expect, it } from 'vitest';
import { contrast, tokens } from './contrast';

const SQL = ['keyword', 'string', 'number', 'comment', 'identifier', 'operator', 'function'];

// [текст, фон, минимум]
const TEXT: [string, string, number][] = [
  ['kept', 'kept-bg', 4.5],
  ['dropped', 'dropped-bg', 4.5],
  ['match', 'match-bg', 4.5],
  ['null', 'null-bg', 4.5],
  ['new', 'new-bg', 4.5],
  ['changed', 'changed-bg', 4.5],
  ['deleted', 'deleted-bg', 4.5],
  ['kept', 'background', 4.5],
  // заголовок ошибки стоит на destructive/10
  ['destructive', 'background', 5.0],
  ['muted-foreground', 'muted', 4.5],
  ['touched', 'background', 4.5],
  ['touched-fg', 'touched', 4.5],
  ...SQL.map((t): [string, string, number] => [`sql-${t}`, 'background', 4.5]),
  // код в уроках лежит на --muted
  ...SQL.map((t): [string, string, number] => [`sql-${t}`, 'muted', 4.5]),
];

// Нетекстовые индикаторы
const NON_TEXT: [string, string, number][] = [
  ['ring', 'background', 3.0],
  ['sidebar-ring', 'sidebar', 3.0],
  ['touched', 'card', 3.0],
];

// Текст на слоях фона снизу вверх: [текст, слои, минимум]; 'muted/50' = --muted с альфой 50%
const LAYERED: [string, string[], number][] = [
  // тип колонки (11px) на подсвеченной шапке таблицы: card, bg-muted/50, bg-touched/10
  ['muted-foreground', ['card', 'muted/50', 'touched/10'], 4.5],
  // тип колонки на обычной шапке
  ['muted-foreground', ['card', 'muted/50'], 4.5],
];

const withAlpha = (t: Record<string, string>, ref: string) => {
  const [name = '', alpha] = ref.split('/');
  const color = t[name] ?? '';
  return alpha ? color.replace(/\)$/, ` / ${alpha}%)`) : color;
};

describe('контраст токенов (WCAG AA)', () => {
  it('самопроверка: чёрный на белом ≈ 21', () => {
    expect(contrast('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 0);
    expect(Math.abs(contrast('oklch(0 0 0)', 'oklch(1 0 0)') - 21)).toBeLessThan(0.1);
  });

  it('полупрозрачный цвет смешивается с фоном', () => {
    expect(contrast('oklch(1 0 0 / 0%)', 'oklch(0 0 0)')).toBeCloseTo(1, 5);
  });

  it('слои фона: белый на белом с чёрным 50% сверху ≈ 3.98, как серый на белом', () => {
    expect(Math.abs(contrast('oklch(1 0 0)', ['oklch(1 0 0)', 'oklch(0 0 0 / 50%)']) - 3.98)).toBeLessThan(
      0.05,
    );
  });

  it('полупрозрачный чёрный 50% на белом: серый 0.5 в гамма-sRGB, 1.05 / (0.214 + 0.05) ≈ 3.98', () => {
    expect(Math.abs(contrast('oklch(0 0 0 / 50%)', 'oklch(1 0 0)') - 3.98)).toBeLessThan(0.05);
  });

  describe.each([':root', '.dark'] as const)('%s', (theme) => {
    const t = tokens(theme);
    it.each([...TEXT, ...NON_TEXT])('%s на %s ≥ %s', (fg, bg, min) => {
      const [f, b] = [t[fg], t[bg]];
      expect(f, `нет --${fg}`).toBeDefined();
      expect(b, `нет --${bg}`).toBeDefined();
      const ratio = contrast(f as string, b as string);
      expect(ratio, `--${fg} на --${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    });

    it.each(LAYERED)('%s на слоях %j ≥ %s', (fg, layers, min) => {
      const ratio = contrast(
        t[fg] as string,
        layers.map((l) => withAlpha(t, l)),
      );
      expect(ratio, `--${fg} на ${layers.join(' + ')}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    });
  });
});
