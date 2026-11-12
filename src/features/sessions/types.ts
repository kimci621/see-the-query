export interface ScenarioStep {
  session: 'a' | 'b';
  caption: string;
  sql: string;
  fire?: boolean;
  settlesAt?: number;
  settledNote?: string;
  expect?: { rows?: unknown[][] };
  expectError?: string;
  note?: string;
}

export interface Scenario {
  id: string;
  title: string;
  intro: string;
  setup: string;
  cleanup?: string;
  steps: ScenarioStep[];
}
