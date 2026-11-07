/**
 * Read models for the adoption endpoints. Pure: given the stored adoption
 * state (and the label registry), they shape the JSON the console renders, so
 * the shaping is unit-testable without a server or a chain.
 */

import { buildSeries, filterAccounts, filterEvents, foldAccounts } from './scan.mjs';

/** The overview: cumulative per-chain counters, totals, and the daily series. */
export function buildOverview({ adoption, projects = [], days = 30, nowSeconds, indexer = { enabled: false, intervalMs: 0 } }) {
  const sources = adoption?.chains ?? [];
  const chains = sources.map((chain) => ({
    id: chain.id,
    key: chain.key,
    name: chain.name,
    accounts: (chain.accounts ?? []).length,
    installs: chain.installs ?? 0,
    userops: chain.userops ?? 0,
    cursorBlock: chain.cursorBlock ?? null,
  }));

  // Totals come from the cumulative counters (the same ones the dashboard
  // reads), not from the event log — the log is capped, the counters are not.
  const union = new Set();
  for (const chain of sources) for (const account of chain.accounts ?? []) union.add(account);

  return {
    generatedAt: adoption?.updatedAt ?? null,
    indexer,
    totals: {
      accounts: union.size,
      installs: chains.reduce((sum, chain) => sum + chain.installs, 0),
      userops: chains.reduce((sum, chain) => sum + chain.userops, 0),
      projects: projects.length,
    },
    chains,
    series: buildSeries(adoption?.events ?? [], { days, nowSeconds }),
    projects,
  };
}

/** The account list, folded from events and narrowed by the console's filters. */
export function buildAccounts({ adoption, labels = new Map(), filters = {}, nowSeconds }) {
  const events = adoption?.events ?? [];
  // A time window narrows *which events* are folded, so "accounts" means
  // "accounts seen in the window", not "accounts whose history we trim".
  const { since, until, ...rest } = filters;
  const windowed = since !== undefined || until !== undefined ? filterEvents(events, { since, until }) : events;
  const rows = foldAccounts(windowed, labels, nowSeconds);
  return { total: rows.length, accounts: filterAccounts(rows, rest) };
}

/** The event log, newest first, narrowed by chain / account / type / window. */
export function buildEvents({ adoption, filters = {} }) {
  const matched = filterEvents(adoption?.events ?? [], filters);
  return { events: [...matched].reverse() };
}
