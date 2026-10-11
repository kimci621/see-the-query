import type { Node } from '@pgsql/types';
import { deparseSync } from 'pgsql-deparser';

// Обёртка над deparseSync (Ф5 собирает здесь пробы). WITH TIES теряется - контракты, раздел 1.
export function deparse(node: Node): string {
  return deparseSync(node);
}
