/**
 * The console backend — a tiny HTTP/JSON service the self-hosted console talks
 * to for what it cannot read from the chain: the session index (which module
 * version a session belongs to, §7.5), the settlement ledger, and the adoption
 * overview (the on-chain scan the indexer maintains off the same rules as the
 * metrics dashboard).
 *
 * Zero dependencies, so `node src/server.mjs` is the whole runtime. Writes are
 * guarded by `KEEL_API_TOKEN` when it is set; reads are open (the console is a
 * public page and everything it reads is already public on-chain or public
 * settlement data). CORS is limited to `KEEL_API_ORIGIN` when set.
 */

import { createServer as createHttpServer } from 'node:http';
import { createStore, PROTOCOLS, TELEMETRY_KINDS, isAddress } from './store.mjs';
import { labelsFrom, loadAdopters, projectNames } from './adopters.mjs';
import { createIndexer, startIndexer } from './indexer.mjs';
import { buildAccounts, buildEvents, buildOverview } from './views.mjs';

const MAX_BODY = 1_000_000;

const ACCOUNT_STATUSES = ['active', 'expired', 'pending'];
const EVENT_TYPES = ['session', 'userop'];

/** A clamped integer query param, or undefined when absent/not a number. */
function intParam(value, { min, max } = {}) {
  if (value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  if (min !== undefined && parsed < min) return min;
  if (max !== undefined && parsed > max) return max;
  return parsed;
}

/** A time query param accepted as unix seconds or an ISO date → unix seconds. */
function timeParam(value) {
  if (value === null || value === '') return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.floor(numeric);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

/** An optional query param, trimmed; undefined when blank. */
function textParam(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function send(res, status, body, origin) {
  const payload = JSON.stringify(body);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  };
  if (origin) headers['access-control-allow-origin'] = origin;
  res.writeHead(status, headers);
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('payload too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('body must be valid JSON');
  }
}

/**
 * Builds the request handler. Exported separately from the listener so tests
 * can drive it without binding a port.
 */
export function createHandler({
  store,
  token,
  origin = '*',
  labels = new Map(),
  projects = [],
  indexer = null,
  indexerIntervalMs = 0,
  now = Date.now,
}) {
  const readOnly = () => !token;
  const authorized = (req) => readOnly() || req.headers['x-keel-token'] === token;
  const nowSeconds = () => Math.floor(now() / 1000);

  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const key = `${req.method} ${url.pathname}`;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-keel-token',
      });
      return res.end();
    }

    try {
      if (key === 'GET /health') {
        return send(res, 200, { ok: true, service: '@keelcodes/api' }, origin);
      }

      if (key === 'GET /sessions') {
        return send(res, 200, { sessions: store.listSessions(url.searchParams.get('account')) }, origin);
      }

      if (key === 'GET /settlement/ledger') {
        return send(res, 200, { entries: store.listLedger(url.searchParams.get('account')) }, origin);
      }

      if (key === 'GET /telemetry') {
        return send(res, 200, { counters: store.counters() }, origin);
      }

      // Adoption reads — the on-chain scan the indexer maintains. Like the
      // other reads these are open: every figure already comes from public
      // chain data.
      if (key === 'GET /overview') {
        const days = intParam(url.searchParams.get('days'), { min: 1, max: 365 }) ?? 30;
        return send(
          res,
          200,
          buildOverview({
            adoption: store.getAdoption(),
            projects,
            days,
            nowSeconds: nowSeconds(),
            indexer: { enabled: indexer !== null, intervalMs: indexerIntervalMs },
          }),
          origin,
        );
      }

      if (key === 'GET /accounts') {
        const status = textParam(url.searchParams.get('status'));
        if (status && !ACCOUNT_STATUSES.includes(status)) {
          throw new Error(`status must be one of ${ACCOUNT_STATUSES.join(', ')}`);
        }
        return send(
          res,
          200,
          buildAccounts({
            adoption: store.getAdoption(),
            labels,
            nowSeconds: nowSeconds(),
            filters: {
              chain: textParam(url.searchParams.get('chain')),
              label: textParam(url.searchParams.get('label')),
              status,
              q: textParam(url.searchParams.get('q')),
              since: timeParam(url.searchParams.get('since')),
              until: timeParam(url.searchParams.get('until')),
            },
          }),
          origin,
        );
      }

      if (key === 'GET /events') {
        const account = textParam(url.searchParams.get('account'));
        if (account && !isAddress(account)) throw new Error('account must be an address');
        const type = textParam(url.searchParams.get('type'));
        if (type && !EVENT_TYPES.includes(type)) {
          throw new Error(`type must be one of ${EVENT_TYPES.join(', ')}`);
        }
        return send(
          res,
          200,
          buildEvents({
            adoption: store.getAdoption(),
            filters: {
              chain: textParam(url.searchParams.get('chain')),
              account,
              type,
              since: timeParam(url.searchParams.get('since')),
              until: timeParam(url.searchParams.get('until')),
              limit: intParam(url.searchParams.get('limit'), { min: 1, max: 1000 }),
            },
          }),
          origin,
        );
      }

      // Everything below mutates, so it needs the token when one is configured.
      if (!authorized(req)) {
        return send(res, 401, { error: 'unauthorized' }, origin);
      }

      if (key === 'POST /sessions') {
        return send(res, 201, { session: store.upsertSession(await readJson(req)) }, origin);
      }

      if (key === 'POST /settlement/intents') {
        return send(res, 201, { entry: store.addIntent(await readJson(req)) }, origin);
      }

      if (key === 'POST /telemetry') {
        const body = await readJson(req);
        if (!TELEMETRY_KINDS.includes(body?.kind)) {
          throw new Error(`kind must be one of ${TELEMETRY_KINDS.join(', ')}`);
        }
        return send(res, 202, { counters: store.increment(body.kind, body.by ?? 1) }, origin);
      }

      if (key === 'POST /index') {
        if (indexer === null) throw new Error('indexer is not enabled (set KEEL_INDEX_ENABLED=1)');
        const adoption = await indexer.run();
        return send(res, 202, { ok: true, updatedAt: adoption.updatedAt }, origin);
      }

      return send(res, 404, { error: `no route for ${key}` }, origin);
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : String(error) }, origin);
    }
  };
}

/** Wires the environment into a listening server. */
export function createServer(env = process.env) {
  const store = createStore({ file: env.KEEL_API_STORE });

  // The label registry (metrics/adopters.json) attributes on-chain accounts to
  // the project that owns them; unset, accounts simply carry no label.
  const adopters = loadAdopters(env.KEEL_ADOPTERS_FILE);

  const indexerEnabled = env.KEEL_INDEX_ENABLED === '1' || env.KEEL_INDEX_ENABLED === 'true';
  const indexerIntervalMs = Number(env.KEEL_INDEX_INTERVAL_MS ?? 900_000);
  const indexer = indexerEnabled
    ? createIndexer({ store, env, log: (line) => console.log(`[index] ${line}`) })
    : null;

  const handler = createHandler({
    store,
    token: env.KEEL_API_TOKEN,
    origin: env.KEEL_API_ORIGIN ?? '*',
    labels: labelsFrom(adopters),
    projects: projectNames(adopters),
    indexer,
    indexerIntervalMs,
  });

  if (indexer) startIndexer(indexer, indexerIntervalMs);

  return createHttpServer((req, res) => void handler(req, res));
}

// Re-exported so callers can validate without reaching into the store module.
export { PROTOCOLS, TELEMETRY_KINDS, isAddress };

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.KEEL_API_PORT ?? 8080);
  createServer().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`@keelcodes/api listening on :${port}`);
  });
}
