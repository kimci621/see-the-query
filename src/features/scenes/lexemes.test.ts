import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { loadLexemes } from './lexemes';

describe('сцена полнотекстового поиска', () => {
  it('показывает стоп-слова, лексемы и позиции из PostgreSQL', async () => {
    await withDataset('empty', async (db) => {
      const scene = await inPreview(db, () =>
        loadLexemes(db, 'russian', 'Книги о Python: читаем, читали, будем читать'),
      );
      expect(scene.tokens.find((token) => token.text === 'о')).toMatchObject({ kind: 'stop', lexemes: [] });
      expect(
        scene.tokens.filter((token) => token.lexemes.includes('чита')).map((token) => token.text),
      ).toEqual(['читаем', 'читали', 'читать']);
      expect(scene.lexemes.find((item) => item.lexeme === 'чита')?.positions).toEqual([4, 5, 7]);
      expect(scene.vector).toContain("'чита':4,5,7");
      const simple = await inPreview(db, () => loadLexemes(db, 'simple', 'Книги о Python'));
      expect(simple.tokens.find((token) => token.text === 'о')?.kind).toBe('lexeme');
    });
  });

  it('не угадывает токены по пробелам и ограничивает размер сцены', async () => {
    await withDataset('empty', async (db) => {
      const scene = await inPreview(db, () => loadLexemes(db, 'russian', 'кошка-собака и дом'));
      expect(scene.tokens.map((token) => token.text)).toEqual([
        'кошка-собака',
        'кошка',
        'собака',
        'и',
        'дом',
      ]);
      expect(scene.tokens.find((token) => token.text === 'и')?.kind).toBe('stop');
      expect(scene.lexemes.find((item) => item.lexeme === 'дом')?.positions).toEqual([5]);
      await expect(loadLexemes(db, 'simple', 'x '.repeat(121))).rejects.toThrow(/120/);
    });
  });
});
