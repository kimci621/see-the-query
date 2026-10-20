export interface FormattedCell {
  text: string;
  kind: 'null' | 'empty' | 'value';
}

const MAX_LEN = 60;

// Текст ячейки для доски и панели результата. NULL и '' разные вещи, поэтому у них свой kind
export function formatCell(value: unknown, type?: string): FormattedCell {
  if (value === null || value === undefined) return { text: 'NULL', kind: 'null' };
  if (value === '') return { text: "''", kind: 'empty' };
  const text = toText(value, type);
  return { text: text.length > MAX_LEN ? `${text.slice(0, MAX_LEN - 1)}…` : text, kind: 'value' };
}

function toText(value: unknown, type?: string): string {
  // PGlite отдаёт date как полночь UTC, timestamp/timestamptz как Date
  if (value instanceof Date) {
    return type === 'date'
      ? value.toISOString().slice(0, 10)
      : value
          .toISOString()
          .replace('T', ' ')
          .replace(/\.\d{3}Z$/, 'Z');
  }
  if (Array.isArray(value)) {
    // элементы как одиночные значения своего типа: date[] без времени
    const item = type?.endsWith('[]') ? type.slice(0, -2) : type;
    return `{${value.map((v) => (v === null ? 'NULL' : toText(v, item))).join(',')}}`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
