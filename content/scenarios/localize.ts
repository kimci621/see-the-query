import type { Scenario } from '@/features/sessions/types';
import type { Locale } from '@/lib/i18n';

type Translation = {
  title: string;
  intro: string;
  steps: Array<{ caption: string; note?: string; settledNote?: string }>;
};

const ENGLISH: Record<string, Translation> = {
  'tx-basic': {
    title: 'Committing a transaction',
    intro: 'Session B reads a price before and after session A commits a change.',
    steps: [
      { caption: 'Starts a transaction' },
      { caption: 'Changes the price of book 1', note: 'A sees the new price, 1.00.' },
      { caption: 'Reads the price before commit', note: 'B sees the old price, 890.00.' },
      { caption: 'Commits the change' },
      { caption: 'Reads the price again', note: 'B sees the committed price, 1.00.' },
    ],
  },
  'tx-rollback': {
    title: 'Rolling back a transaction',
    intro: 'The change in A is rolled back and is not visible to B.',
    steps: [
      { caption: 'Starts a transaction' },
      { caption: 'Temporarily changes the price', note: 'A sees the temporary price, 1.00.' },
      { caption: 'Reads the price before rollback', note: 'B sees the old price, 890.00.' },
      { caption: 'Rolls back the change', note: 'A rolled back the change.' },
      { caption: 'Reads the price again', note: 'B still sees 890.00.' },
    ],
  },
  savepoint: {
    title: 'Errors and SAVEPOINT',
    intro: 'Rolling back to a savepoint lets the transaction continue after an error.',
    steps: [
      { caption: 'Starts a transaction' },
      { caption: 'Creates a savepoint' },
      { caption: 'Attempts to make the bonus negative', note: 'The CHECK constraint rejected the change.' },
      { caption: 'Rolls back to the savepoint', note: 'A can continue the transaction.' },
      { caption: 'Counts customers', note: 'A sees 6 customers.' },
      { caption: 'Ends the transaction' },
    ],
  },
  'non-repeatable-read': {
    title: 'Read Committed',
    intro: 'Each SELECT gets a new snapshot of committed data.',
    steps: [
      { caption: 'Starts a transaction' },
      { caption: 'Reads the price', note: 'B sees 890.00.' },
      { caption: 'Starts a transaction' },
      { caption: 'Changes the price' },
      { caption: 'Commits the change', note: 'A committed the price 1.00.' },
      { caption: 'Reads again', note: 'B sees the new price, 1.00, in the same transaction.' },
      { caption: 'Ends the transaction' },
    ],
  },
  'repeatable-read': {
    title: 'Repeatable Read',
    intro: 'A repeated read uses the same snapshot; a conflicting write raises an error.',
    steps: [
      { caption: 'Starts a transaction' },
      { caption: 'Reads the price', note: 'B sees 890.00 in its snapshot.' },
      { caption: 'Starts a transaction' },
      { caption: 'Changes the price' },
      { caption: 'Commits the change', note: 'A committed the price 1.00.' },
      { caption: 'Reads the original snapshot', note: 'B still sees 890.00.' },
      { caption: 'Attempts to change the same row', note: 'B received serialization error 40001.' },
      { caption: 'Rolls back the transaction', note: 'B rolled back the transaction and can retry it.' },
    ],
  },
  'lock-for-update': {
    title: 'Waiting for a row lock',
    intro: 'The second session waits until the first ends its transaction with FOR UPDATE.',
    steps: [
      { caption: 'Starts a transaction' },
      { caption: 'Locks book 1', note: 'A holds the lock on book 1.' },
      { caption: 'Starts a transaction' },
      {
        caption: 'Attempts to lock the same book',
        note: 'B waits for A’s transaction to end.',
        settledNote: 'B acquired the lock after A committed.',
      },
      { caption: 'Commits the transaction', note: 'A released the lock.' },
      { caption: 'Reads the price', note: 'B sees the price 890.00 and holds the lock.' },
      { caption: 'Ends the transaction', note: 'B released the lock.' },
    ],
  },
  deadlock: {
    title: 'Deadlock',
    intro:
      'In this example B is rolled back; under other conditions PostgreSQL may choose another transaction. The detection intervals are set to make the example repeatable.',
    steps: [
      { caption: 'Starts a transaction' },
      { caption: 'Sets the detection interval' },
      { caption: 'Changes book 1', note: 'A holds the row for book 1.' },
      { caption: 'Starts a transaction' },
      { caption: 'Sets the detection interval' },
      { caption: 'Changes book 2', note: 'B holds the row for book 2.' },
      {
        caption: 'Waits for the row for book 2',
        note: 'A waits for the row held by B.',
        settledNote: 'A continued after B’s transaction was rolled back.',
      },
      {
        caption: 'Attempts to change book 1',
        note: 'PostgreSQL detected a cycle and rolled back B’s transaction.',
      },
      { caption: 'Reads its new price for book 2', note: 'A sees its price, 3.00.' },
      { caption: 'Rolls back the transaction', note: 'A rolled back its changes.' },
      { caption: 'Closes the failed transaction', note: 'B rolled back after the error.' },
    ],
  },
};

export function scenarioForLocale(scenario: Scenario, locale: Locale): Scenario {
  if (locale === 'ru') return { ...scenario, steps: scenario.steps.map((step) => ({ ...step })) };
  const translation = ENGLISH[scenario.id];
  if (!translation || translation.steps.length !== scenario.steps.length) {
    throw new Error(`Нет полного перевода сценария ${scenario.id}`);
  }
  return {
    ...scenario,
    title: translation.title,
    intro: translation.intro,
    steps: scenario.steps.map((step, index) => ({ ...step, ...translation.steps[index] })),
  };
}
