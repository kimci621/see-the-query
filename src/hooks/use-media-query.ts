import { useEffect, useState } from 'react';
import { useRootFont } from './use-root-font';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  // Смена шрифта браузера двигает пороги в em, но change matchMedia не шлёт: перепроверяем сами
  const rootFont = useRootFont();

  // biome-ignore lint/correctness/useExhaustiveDependencies: rootFont служит только триггером перепроверки
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    // запрос мог смениться между рендером и подпиской
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query, rootFont]);

  return matches;
}
