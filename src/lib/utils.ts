export { cn } from 'cn';

// Подпись модификатора в подсказках клавиш: ⌘ на Mac, Ctrl на остальных
export function modKey(): '⌘' | 'Ctrl' {
  const nav = navigator as Navigator & { userAgentData?: { platform: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform) ? '⌘' : 'Ctrl';
}
