import { describe, expect, it } from 'vitest';
import { lessonHref, resolveLocale } from '@/lib/i18n';

describe('язык ссылки и настроек', () => {
  it.each([
    ['?lang=en', 'ru', 'en'],
    ['?lang=ru', 'en', 'ru'],
    ['', 'en', 'en'],
    ['?lang=fr', 'en', 'en'],
    ['?lang=fr', 'bad', 'ru'],
    ['', undefined, 'ru'],
    ['?lang=fr&lang=en', 'ru', 'ru'],
  ] as const)('%s + %s → %s', (search, saved, expected) => {
    expect(resolveLocale(search, saved)).toBe(expected);
  });

  it('ссылка на урок сохраняет выбранный язык', () => {
    expect(lessonHref('inner-join', 'en')).toBe('/l/inner-join?lang=en');
    expect(lessonHref('inner-join', 'ru')).toBe('/l/inner-join?lang=ru');
  });
});
