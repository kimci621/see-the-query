import { useEffect, useMemo, useState } from 'react';
import { initParser, isParserReady, parseSql } from '@/features/sql/parser';

export type ParseResult = ReturnType<typeof parseSql>;

// Готовность WASM-парсера: запускает загрузку и перерисовывает потребителя после неё
export function useParserReady(): boolean {
  const [ready, setReady] = useState(isParserReady);
  useEffect(() => {
    if (!isParserReady()) void initParser().then(() => setReady(true));
  }, []);
  return ready;
}

// Один разбор текста на изменение. null, пока парсер не загружен или текст пуст
export function useParsedText(text: string): ParseResult | null {
  const ready = useParserReady();
  return useMemo(() => (ready && text.trim() !== '' ? parseSql(text) : null), [ready, text]);
}
