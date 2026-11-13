export type Locale = 'ru' | 'en';

export function isLocale(value: unknown): value is Locale {
  return value === 'ru' || value === 'en';
}

export function resolveLocale(search: string, persisted: unknown): Locale {
  const requested = new URLSearchParams(search).get('lang');
  if (isLocale(requested)) return requested;
  return isLocale(persisted) ? persisted : 'ru';
}

export function lessonHref(id: string, locale: Locale): string {
  return `/l/${encodeURIComponent(id)}?lang=${locale}`;
}
