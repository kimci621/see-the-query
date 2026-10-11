import { describe, expect, it } from 'vitest';
import { byteToChar, charToByte } from './offsets';

// Запрос из спайка Ф0: байтовая позиция b.title - 28, символьная - 22
const CYR = "select 'Привет' as x, b.title from book b";

describe('byteToChar / charToByte', () => {
  it('байт 28 в кириллическом запросе - символ 22', () => {
    expect(byteToChar(CYR, 28)).toBe(22);
    expect(CYR.slice(22, 22 + 7)).toBe('b.title');
  });

  it('переводы согласованы по всей строке', () => {
    for (let i = 0; i <= CYR.length; i++) {
      const byte = charToByte(CYR, i);
      expect(byteToChar(CYR, byte)).toBe(i);
    }
  });

  it('ASCII без сдвига, эмодзи - четыре байта', () => {
    expect(charToByte('abc', 3)).toBe(3);
    expect(charToByte('a\u{1F600}b', 2)).toBe(5);
    expect(byteToChar('a\u{1F600}b', 5)).toBe(2);
  });

  it('смещение за концом строки даёт длину', () => {
    expect(byteToChar('abc', 100)).toBe(3);
    expect(charToByte('abc', 100)).toBe(3);
  });
});
