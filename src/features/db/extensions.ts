import { pageinspect } from '@electric-sql/pglite/contrib/pageinspect';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

// Регистрация доступна в Node и worker; установка остаётся за уроком или сценой.
export const SANDBOX_EXTENSIONS = { pg_trgm, pageinspect };
