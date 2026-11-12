import type { DbClient } from '@/features/db/types';

export interface SearchToken {
  id: string;
  text: string;
  kind: 'lexeme' | 'stop' | 'ignored';
  lexemes: string[];
}

export interface LexemeSceneData {
  text: string;
  config: string;
  tokens: SearchToken[];
  lexemes: Array<{ lexeme: string; positions: number[] }>;
  vector: string;
}

// Вызывающий выполняет запросы внутри sandbox.preview; конфигурация и текст передаются параметрами.
export async function loadLexemes(db: DbClient, config: string, text: string): Promise<LexemeSceneData> {
  // ponytail: для читаемой сцены ограничиваем текст и токены; длинным документам нужна постраничная навигация.
  if (Array.from(text).length > 5000) throw new Error('Для сцены нужно не более 5000 символов.');
  const args = [config, text];
  const debug = await db.query(
    "select token, lexemes from ts_debug($1::regconfig, $2) where alias <> 'blank' limit 121",
    args,
  );
  if (debug.rows.length > 120) throw new Error('Для сцены нужно не более 120 токенов.');
  const tokens: SearchToken[] = debug.rows.map(([token, result], index) => {
    const lexemes = Array.isArray(result) ? result.map(String) : [];
    return {
      id: String(index),
      text: String(token),
      kind: result === null ? 'ignored' : lexemes.length === 0 ? 'stop' : 'lexeme',
      lexemes,
    };
  });
  const output = await db.query('select to_tsvector($1::regconfig, $2)::text', args);
  const parsed = await db.query('select lexeme, positions from unnest(to_tsvector($1::regconfig, $2))', args);
  return {
    text,
    config,
    tokens,
    vector: String(output.rows[0]?.[0] ?? ''),
    lexemes: parsed.rows.map(([lexeme, positions]) => ({
      lexeme: String(lexeme),
      positions: Array.isArray(positions) ? positions.map(Number) : [],
    })),
  };
}
