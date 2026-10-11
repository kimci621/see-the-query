// Позиции libpg-query - байты UTF-8, а CodeMirror и JS-строки - кодовые единицы UTF-16.

export function byteToChar(text: string, byteOffset: number): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    if (bytes >= byteOffset) return i;
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff)
      bytes += 4; // сурогатная пара: два code unit = 4 байта
    else bytes += 3;
  }
  return text.length;
}

export function charToByte(text: string, charOffset: number): number {
  let bytes = 0;
  const end = Math.min(charOffset, text.length);
  for (let i = 0; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++; // второй code unit пары не считать отдельно
    } else bytes += 3;
  }
  return bytes;
}
