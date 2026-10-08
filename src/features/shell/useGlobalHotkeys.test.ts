import { describe, expect, it } from 'vitest';
import { type HotkeyEvent, isTypingTarget, matchHotkey } from './useGlobalHotkeys';

const ev = (patch: Partial<HotkeyEvent>): HotkeyEvent => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...patch,
});

describe('matchHotkey', () => {
  it('⌘K и Ctrl+K', () => {
    expect(matchHotkey(ev({ key: 'k', code: 'KeyK', metaKey: true }), 'mod+k')).toBe(true);
    expect(matchHotkey(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), 'mod+k')).toBe(true);
    expect(matchHotkey(ev({ key: 'k', code: 'KeyK' }), 'mod+k')).toBe(false);
  });

  it('⌘K на русской раскладке (key = л) срабатывает по физической клавише', () => {
    expect(matchHotkey(ev({ key: 'л', code: 'KeyK', metaKey: true }), 'mod+k')).toBe(true);
  });

  it('⌘\\ по физической клавише Backslash', () => {
    expect(matchHotkey(ev({ key: '\\', code: 'Backslash', metaKey: true }), 'mod+\\')).toBe(true);
    expect(matchHotkey(ev({ key: 'ё', code: 'Backslash', metaKey: true }), 'mod+\\')).toBe(true);
  });

  it('? без модификаторов ⌘/Ctrl/Alt', () => {
    expect(matchHotkey(ev({ key: '?', code: 'Slash', shiftKey: true }), '?')).toBe(true);
    expect(matchHotkey(ev({ key: '?', code: 'Digit7', shiftKey: true }), '?')).toBe(true);
    expect(matchHotkey(ev({ key: '?', metaKey: true }), '?')).toBe(false);
  });
});

describe('isTypingTarget', () => {
  it('поле ввода, textarea и contenteditable считаются набором текста', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    expect(isTypingTarget(div)).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
