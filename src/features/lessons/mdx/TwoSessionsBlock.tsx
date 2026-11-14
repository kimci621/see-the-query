import { SCENARIOS } from '@content/scenarios';
import { scenarioForLocale } from '@content/scenarios/localize';
import { TwoSessions } from '@/features/sessions/TwoSessions';
import { useSettingsStore } from '@/stores/settings';

export function TwoSessionsBlock({ id }: { id: string }) {
  const locale = useSettingsStore((s) => s.locale);
  const scenario = SCENARIOS.find((item) => item.id === id);
  if (!scenario)
    return (
      <p role="alert">{locale === 'en' ? `Scenario “${id}” not found.` : `Сценарий «${id}» не найден.`}</p>
    );
  return <TwoSessions scenario={scenarioForLocale(scenario, locale)} />;
}
