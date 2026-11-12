import { SCENARIOS } from '@content/scenarios';
import { TwoSessions } from '@/features/sessions/TwoSessions';

export function TwoSessionsBlock({ id }: { id: string }) {
  const scenario = SCENARIOS.find((item) => item.id === id);
  if (!scenario) return <p role="alert">Сценарий «{id}» не найден.</p>;
  return <TwoSessions scenario={scenario} />;
}
