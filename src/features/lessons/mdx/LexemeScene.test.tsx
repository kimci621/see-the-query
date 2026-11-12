import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LexemeSceneData } from '@/features/scenes/lexemes';
import { LexemePlayer } from './LexemeScene';

const data: LexemeSceneData = {
  text: 'Книги о чтении',
  config: 'russian',
  tokens: [
    { id: '0', text: 'Книги', kind: 'lexeme', lexemes: ['книг'] },
    { id: '1', text: 'о', kind: 'stop', lexemes: [] },
    { id: '2', text: 'чтении', kind: 'lexeme', lexemes: ['чтен'] },
  ],
  lexemes: [
    { lexeme: 'книг', positions: [1] },
    { lexeme: 'чтен', positions: [3] },
  ],
  vector: "'книг':1 'чтен':3",
};

describe('сцена полнотекстового поиска', () => {
  it('объявляет шаги, обозначает стоп-слово и сохраняет фокус', () => {
    render(<LexemePlayer data={data} />);
    const scene = screen.getByRole('region', { name: 'Разбор текста для поиска' });
    expect(screen.getByRole('status')).toHaveTextContent('Шаг 1 из 4: Исходный текст');
    const next = within(scene).getByRole('button', { name: 'Дальше' });
    next.focus();
    fireEvent.click(next);
    expect(screen.getByRole('status')).toHaveTextContent('Шаг 2 из 4: Разбор и стоп-слова');
    expect(within(scene).getByText('стоп-слово')).toBeVisible();
    fireEvent.keyDown(scene, { key: 'ArrowRight' });
    expect(within(scene).getByText('книг')).toBeVisible();
    fireEvent.keyDown(scene, { key: 'ArrowRight' });
    expect(screen.getByRole('status')).toHaveTextContent('Шаг 4 из 4: Итоговый tsvector');
    expect(within(scene).getByText("'книг':1 'чтен':3")).toBeVisible();
    expect(within(scene).getByRole('button', { name: 'Назад' })).toHaveFocus();
    for (let i = 0; i < 3; i++) fireEvent.keyDown(scene, { key: 'ArrowLeft' });
    expect(next).toHaveFocus();
  });
});
