import type { Prober } from '../probe';
import type { Target } from './shared';

export async function sequenceValues(
  prober: Prober,
  target: Target,
): Promise<Map<string, number | string | null>> {
  const table = target.sql.replaceAll("'", "''");
  const result = await prober.run(`
    SELECT a.attname, pg_sequence_last_value(pg_get_serial_sequence('${table}', a.attname)::regclass)::text
    FROM pg_attribute a
    WHERE a.attrelid = '${table}'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND pg_get_serial_sequence('${table}', a.attname) IS NOT NULL
    ORDER BY a.attnum
  `);
  return new Map(
    result.rows.map(([column, value]) => {
      const number = Number(value);
      return [
        column as string,
        value === null ? null : Number.isSafeInteger(number) ? number : String(value),
      ];
    }),
  );
}
