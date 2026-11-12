import type { DbClient } from './types';

export interface RawVersion {
  lp: number;
  lpFlags: number;
  xmin: number;
  xmax: number;
  ctid: string | null;
}
export type VersionState = 'live' | 'dead' | 'aborted' | 'locked' | 'unused' | 'redirect';
export interface XidFacts {
  committed: number[];
  aborted: number[];
  lockers: number[];
}

// ponytail: факты известны только для учебной сцены; для произвольной страницы нужны infomask и MultiXact.
export function classifyVersions(
  items: RawVersion[],
  facts: XidFacts,
): Array<{ lp: number; state: VersionState }> {
  return items.map((item) => {
    let state: VersionState;
    if (item.lpFlags === 0) state = 'unused';
    else if (item.lpFlags === 2) state = 'redirect';
    else if (item.lpFlags === 3) state = 'dead';
    else if (facts.aborted.includes(item.xmin)) state = 'aborted';
    else if (item.xmax === 0 || facts.aborted.includes(item.xmax)) state = 'live';
    else if (facts.lockers.includes(item.xmax)) state = 'locked';
    else if (facts.committed.includes(item.xmax)) state = 'dead';
    else state = 'live';
    return { lp: item.lp, state };
  });
}

export async function readHeapPage(db: DbClient, tableId: string, page: number): Promise<RawVersion[]> {
  await db.query('create extension if not exists pageinspect');
  const result = await db.query(
    `select lp::int, lp_flags::int, t_xmin::text, t_xmax::text, t_ctid::text
     from heap_page_items(get_raw_page($1, $2::bigint)) order by lp`,
    [tableId, page],
  );
  return result.rows.map(([lp, flags, xmin, xmax, ctid]) => ({
    lp: Number(lp),
    lpFlags: Number(flags),
    xmin: Number(xmin ?? 0),
    xmax: Number(xmax ?? 0),
    ctid: ctid === null ? null : String(ctid),
  }));
}
