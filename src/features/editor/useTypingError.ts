import { useEffect, useState } from 'react';
import { useEditorStore } from '@/stores/editor';

// Пауза набора: после неё недописанное имя уже ошибка, а не слово на полпути
export const TYPING_PAUSE_MS = 800;
// На полуслове Postgres отвечает «нет колонки ti» или «нет таблицы au»: это ещё не ошибка ученика
const TYPING_CODES = new Set(['42703', '42P01']);

// Ошибка недописанного имени: код 42703/42P01, каретка в конце слова, и пауза ещё не прошла.
// Пока так, плашка, карточка и редактор держат нейтральный тон «Недописан» (спека 3.6)
export function useTypingError(code: string | undefined): boolean {
  const text = useEditorStore((s) => s.text);
  const cursor = useEditorStore((s) => s.cursor);
  const relevant = code !== undefined && TYPING_CODES.has(code);
  // текст, над которым пауза уже прошла. Без нашей ошибки таймер не ставим: лишний рендер
  // редактора пересобрал бы расширения CodeMirror и стёр подчёркивание разбора
  const [pausedOn, setPausedOn] = useState<string | null>(null);
  useEffect(() => {
    if (!relevant) return;
    const timer = setTimeout(() => setPausedOn(text), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, relevant]);
  if (!relevant || pausedOn === text) return false;
  return /[\p{L}\p{N}_]$/u.test(text.slice(0, cursor)) && !/^[\p{L}\p{N}_]/u.test(text.slice(cursor));
}
