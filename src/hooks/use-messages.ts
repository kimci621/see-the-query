import { type Message, message } from '@/lib/messages';
import { useSettingsStore } from '@/stores/settings';

export function useMessages() {
  const locale = useSettingsStore((s) => s.locale);
  return (key: Message) => message(locale, key);
}
