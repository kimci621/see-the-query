import { readFileSync } from 'node:fs';

const css = readFileSync('src/index.css', 'utf8');

// Содержимое первого блока с данным селектором
export function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match?.[2] ?? '';
}

// Токены темы: для .dark поверх :root, ссылки var(--x) раскрываются
export function tokens(selector: ':root' | '.dark'): Record<string, string> {
  const result: Record<string, string> = {};
  const sources = selector === '.dark' ? [':root', '.dark'] : [':root'];
  for (const source of sources) {
    for (const [, name, value] of block(source).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      result[name as string] = (value as string).trim();
    }
  }
  for (const name of Object.keys(result)) {
    result[name] = (result[name] as string).replace(
      /var\(--([\w-]+)\)/,
      (_, ref: string) => result[ref] ?? '',
    );
  }
  return result;
}

type Rgb = [number, number, number];

// oklch -> OKLab -> линейный sRGB (Björn Ottosson), значения в [0,1]
function oklchToLinear(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const decode = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

// Цвет в гамма-sRGB [0,1] и альфа
function parse(color: string): { rgb: Rgb; alpha: number } {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/.exec(color.trim());
  if (!m) throw new Error(`Не oklch: ${color}`);
  const [l, c, h] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const alpha = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
  const rgb = oklchToLinear(l, c, h).map((x) => encode(clamp(x))) as Rgb;
  return { rgb, alpha };
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

// Полупрозрачный цвет поверх непрозрачного, смешение в гамма-sRGB, как в браузере
function over(color: string, back: Rgb): Rgb {
  const { rgb, alpha } = parse(color);
  return rgb.map((x, i) => x * alpha + (back[i] as number) * (1 - alpha)) as Rgb;
}

// Контраст WCAG. bg - один цвет или слои снизу вверх (card, потом muted/50, потом touched/10)
export function contrast(fg: string, bg: string | string[]): number {
  const [base = '', ...layers] = typeof bg === 'string' ? [bg] : bg;
  const back = layers.reduce((acc, layer) => over(layer, acc), parse(base).rgb);
  const mixed = over(fg, back);
  const [hi, lo] = [luminance(mixed), luminance(back)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
