import { useEffect, useRef } from 'react';

export type HotkeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;
export type Hotkey = 'mod+k' | 'mod+\\' | '?';

// Сочетания с буквами проверяем по event.code: на русской раскладке ⌘K даёт key = 'л'
export function matchHotkey(e: HotkeyEvent, combo: Hotkey): boolean {
  const mod = e.metaKey || e.ctrlKey;
  switch (combo) {
    case 'mod+k':
      return mod && !e.altKey && e.code === 'KeyK';
    case 'mod+\\':
      return mod && !e.altKey && e.code === 'Backslash';
    case '?':
      return !mod && !e.altKey && e.key === '?';
  }
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  const editable = target.getAttribute('contenteditable');
  return target.isContentEditable || editable === '' || editable === 'true';
}

export function useGlobalHotkeys(handlers: {
  commandMenu?: () => void;
  focusMode?: () => void;
  help?: () => void;
}) {
  // Обработчики в ref, чтобы не переподписываться на каждый рендер
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const h = ref.current;
      if (matchHotkey(e, 'mod+k') && h.commandMenu) {
        e.preventDefault();
        h.commandMenu();
      } else if (matchHotkey(e, 'mod+\\') && h.focusMode) {
        e.preventDefault();
        h.focusMode();
      } else if (matchHotkey(e, '?') && h.help && !isTypingTarget(e.target)) {
        e.preventDefault();
        h.help();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
