export interface SqlMeta {
  run: boolean;
  apply: boolean;
  noexec: boolean;
  expectRows?: number;
  expectError?: string;
  trace?: 'full' | 'final-only';
}

const ROWS = /^rows:(\d+)$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;

// Разбирает мету fenced-блока: «run expect=rows:9 trace=final-only».
// Опечатка в мете = ошибка автора урока, поэтому всё незнакомое бросает исключение
export function parseSqlMeta(meta: string): SqlMeta {
  const out: SqlMeta = { run: false, apply: false, noexec: false };
  const seen = new Set<string>();
  for (const token of meta.split(/\s+/)) {
    if (token === '') continue;
    const eq = token.indexOf('=');
    const key = eq === -1 ? token : token.slice(0, eq);
    const value = eq === -1 ? null : token.slice(eq + 1);
    // второй expect молча перезаписал бы первый, и тест проверял бы не то, что видит автор
    if (seen.has(key)) throw new Error(`Мета: «${key}» повторяется`);
    seen.add(key);

    if ((key === 'run' || key === 'apply' || key === 'noexec') && value === null) {
      out[key] = true;
      continue;
    }
    if (key === 'expect' && value !== null) {
      const rows = ROWS.exec(value)?.[1];
      if (rows === undefined) throw new Error(`Мета «${token}»: ожидается expect=rows:N`);
      out.expectRows = Number(rows);
      continue;
    }
    if (key === 'expectError' && value !== null && SQLSTATE.test(value)) {
      out.expectError = value;
      continue;
    }
    if (key === 'trace' && (value === 'full' || value === 'final-only')) {
      out.trace = value;
      continue;
    }
    throw new Error(`Неизвестная мета «${token}»`);
  }

  if (out.expectRows !== undefined && out.expectError !== undefined) {
    throw new Error('Мета: expect и expectError в одном блоке не бывают');
  }
  if (out.noexec && (out.run || out.apply || out.expectRows !== undefined || out.expectError !== undefined)) {
    throw new Error('Мета: noexec не сочетается с run, apply и ожиданиями');
  }
  return out;
}
