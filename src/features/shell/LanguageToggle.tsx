import { useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { resolveLocale } from '@/lib/i18n';
import { useSettingsStore } from '@/stores/settings';

export function LanguageToggle() {
  const location = useLocation();
  const navigate = useNavigate();
  const saved = useSettingsStore((s) => s.locale);
  const locale = resolveLocale(location.search, saved);
  const label = locale === 'ru' ? 'Переключить язык на английский' : 'Switch language to Russian';

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      onClick={() => {
        const params = new URLSearchParams(location.search);
        params.set('lang', locale === 'ru' ? 'en' : 'ru');
        void navigate({ pathname: location.pathname, search: `?${params}`, hash: location.hash });
      }}
    >
      {locale.toUpperCase()}
    </Button>
  );
}
