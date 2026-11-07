/**
 * The integrating-project registry — `metrics/adopters.json`, the hand-kept
 * list the metrics dashboard already counts.
 *
 * The console's overview extends the same file with an optional `addresses`
 * list per project, so an on-chain account can be attributed to the project
 * that owns it and the account list can be filtered by integrator. The registry
 * stays a repo file (one source for both the dashboard count and the panel
 * labels); a deployment points the API at it with `KEEL_ADOPTERS_FILE`.
 */

import { readFileSync } from 'node:fs';
import { buildLabelMap } from './scan.mjs';

/** Parses the registry text into its `adopters` array; `[]` on anything unreadable. */
export function parseAdopters(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.adopters) ? parsed.adopters : [];
  } catch {
    return [];
  }
}

/** Reads the registry from `file`; `[]` when unset or unreadable (never throws). */
export function loadAdopters(file) {
  if (!file) return [];
  try {
    return parseAdopters(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

/** address → { name, url }, for labelling accounts in the overview. */
export function labelsFrom(adopters) {
  return buildLabelMap(adopters);
}

/** Distinct project names, sorted — the options for the "integrator" filter. */
export function projectNames(adopters) {
  const names = new Set();
  for (const adopter of Array.isArray(adopters) ? adopters : []) {
    if (typeof adopter?.name === 'string' && adopter.name.length > 0) names.add(adopter.name);
  }
  return [...names].sort();
}
