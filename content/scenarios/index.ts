import type { Scenario } from '@/features/sessions/types';
import { isolation } from './isolation';
import { locks } from './locks';
import { transactions } from './transactions';

export const SCENARIOS: Scenario[] = [...transactions, ...isolation, ...locks];
