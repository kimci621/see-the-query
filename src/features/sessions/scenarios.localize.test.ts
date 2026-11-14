import { SCENARIOS } from '@content/scenarios';
import { scenarioForLocale } from '@content/scenarios/localize';
import { describe, expect, it } from 'vitest';

describe('перевод сценариев двух сессий', () => {
  it.each(SCENARIOS)('$id: переводит весь текст и сохраняет команды и ожидания', (scenario) => {
    const english = scenarioForLocale(scenario, 'en');
    expect(english).not.toBe(scenario);
    expect(english.title).toBeTruthy();
    expect(english.intro).toBeTruthy();
    expect(`${english.title} ${english.intro}`).not.toMatch(/[А-Яа-яЁё]/);
    expect(english.steps).toHaveLength(scenario.steps.length);
    english.steps.forEach((step, index) => {
      const original = scenario.steps[index];
      expect(step.caption).toBeTruthy();
      if (original.note) expect(step.note).toBeTruthy();
      if (original.settledNote) expect(step.settledNote).toBeTruthy();
      expect(`${step.caption} ${step.note ?? ''} ${step.settledNote ?? ''}`).not.toMatch(/[А-Яа-яЁё]/);
      const { caption: _caption, note: _note, settledNote: _settled, ...technical } = step;
      const {
        caption: _originalCaption,
        note: _originalNote,
        settledNote: _originalSettled,
        ...originalTechnical
      } = original;
      expect(technical).toEqual(originalTechnical);
    });
    expect(english.setup).toBe(scenario.setup);
    expect(english.cleanup).toBe(scenario.cleanup);
  });

  it('не скрывает отсутствие английского перевода', () => {
    expect(() => scenarioForLocale({ ...SCENARIOS[0], id: 'missing' }, 'en')).toThrow();
  });
});
