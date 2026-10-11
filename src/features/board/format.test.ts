import { describe, expect, it } from 'vitest';
import { formatCell } from './format';

describe('formatCell', () => {
  it('NULL и пустая строка различаются', () => {
    expect(formatCell(null)).toEqual({ text: 'NULL', kind: 'null' });
    expect(formatCell(undefined)).toEqual({ text: 'NULL', kind: 'null' });
    expect(formatCell('')).toEqual({ text: "''", kind: 'empty' });
    expect(formatCell('NULL')).toEqual({ text: 'NULL', kind: 'value' });
  });

  it('date без времени, timestamptz в UTC', () => {
    expect(formatCell(new Date(Date.UTC(1940, 0, 1)), 'date').text).toBe('1940-01-01');
    expect(formatCell(new Date('2024-03-01T07:00:00.000Z'), 'timestamp with time zone').text).toBe(
      '2024-03-01 07:00:00Z',
    );
  });

  it('массивы как литерал Postgres, jsonb как JSON, числа и булевы как есть', () => {
    expect(formatCell(['классика', 'роман'], 'text[]').text).toBe('{классика,роман}');
    expect(formatCell([1, null]).text).toBe('{1,NULL}');
    expect(formatCell({ lang: 'ru' }, 'jsonb').text).toBe('{"lang":"ru"}');
    expect(formatCell('890.00', 'numeric(10,2)').text).toBe('890.00');
    expect(formatCell(42).text).toBe('42');
    expect(formatCell(true).text).toBe('true');
  });

  it('длинный текст обрезается', () => {
    const cell = formatCell('я'.repeat(100));
    expect(cell.text).toHaveLength(60);
    expect(cell.text.endsWith('…')).toBe(true);
  });
});
