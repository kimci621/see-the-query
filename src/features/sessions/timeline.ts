import type { Scenario } from './types';

export interface TimelineFrame {
  session: 'a' | 'b';
  index: number;
  state: 'done' | 'running' | 'pending';
  text: string;
}

export function buildTimeline(scenario: Scenario, afterStep = 0): TimelineFrame[] {
  return scenario.steps.map((step, index) => ({
    session: step.session,
    index,
    state:
      index > afterStep
        ? 'pending'
        : step.fire && (step.settlesAt ?? Infinity) > afterStep
          ? 'running'
          : 'done',
    text: step.caption,
  }));
}

export function visibleSnapshot(scenario: Scenario, afterStep: number): string[] {
  const latest = new Map<'a' | 'b', string>();
  scenario.steps.slice(0, afterStep + 1).forEach((step) => {
    const note = step.fire && (step.settlesAt ?? Infinity) <= afterStep ? step.settledNote : step.note;
    if (note) latest.set(step.session, note);
  });
  return (['a', 'b'] as const).flatMap((session) => {
    const note = latest.get(session);
    return note ? [note] : [];
  });
}
