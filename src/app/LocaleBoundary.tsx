import { useLayoutEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { resolveLocale } from '@/lib/i18n';
import { useSettingsStore } from '@/stores/settings';

export function LocaleBoundary() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const selected = resolveLocale(search, locale);

  useLayoutEffect(() => {
    document.documentElement.lang = selected;
    if (locale !== selected) setLocale(selected);
    const params = new URLSearchParams(search);
    if (params.get('lang') !== selected || params.getAll('lang').length !== 1) {
      params.set('lang', selected);
      void navigate({ pathname, search: `?${params}`, hash }, { replace: true });
    }
  }, [hash, locale, navigate, pathname, search, selected, setLocale]);

  return <Outlet />;
}
