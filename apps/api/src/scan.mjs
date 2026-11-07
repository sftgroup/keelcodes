/**
 * The shared on-chain adoption scan — the single source of truth for "which
 * events count, and how they fold into counters".
 *
 * Both readers of "how is Keel being adopted" import from here:
 *   - `tools/metrics/collect.mjs` (the committed dashboard), via `lib.mjs`;
 *   - `apps/api/src/indexer.mjs` (the console's live overview).
 * Keeping the chain list, event topics and the fold in one place is what makes
 * the dashboard and the panel agree — they are literally the same code path.
 *
 * Everything here is pure (no network, no filesystem) so it is unit-testable.
 */

/**
 * The chains the adoption scan reads. The hook and EntryPoint live at the same
 * deterministic addresses on all three, so only the deploy block is
 * chain-specific: it is the height of the block whose timestamp is recorded in
 * `contracts/deployments/<id>.json`, i.e. the earliest block that can hold a
 * `SessionInstalled`. `logChunk` is the largest `eth_getLogs` range the default
 * public RPC accepts (Base caps at 500); the RPC itself is overridable per chain
 * via `rpcEnv` so a deployment can point at a private endpoint without a code
 * change.
 */
export const CHAINS = [
  {
    id: 56,
    key: 'bsc',
    name: 'BSC',
    hook: '0x466b5DC3796D44b0B63FdF2d3bC7a8Ea371a891F',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    deployBlock: 126011779,
    logChunk: 2000,
    rpcEnv: 'KEEL_RPC_56',
    defaultRpc: 'https://bsc-rpc.publicnode.com',
  },
  {
    id: 8453,
    key: 'base',
    name: 'Base',
    hook: '0x466b5DC3796D44b0B63FdF2d3bC7a8Ea371a891F',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    deployBlock: 52239325,
    logChunk: 500,
    rpcEnv: 'KEEL_RPC_8453',
    defaultRpc: 'https://mainnet.base.org',
  },
  {
    id: 1,
    key: 'eth',
    name: 'ETH',
    hook: '0x466b5DC3796D44b0B63FdF2d3bC7a8Ea371a891F',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    deployBlock: 26131539,
    logChunk: 10000,
    rpcEnv: 'KEEL_RPC_1',
    defaultRpc: 'https://ethereum-rpc.publicnode.com',
  },
];

/**
 * The two on-chain events the adoption counters are derived from:
 *   - `SessionInstalled(address indexed account, bytes32 indexed sessionId,
 *     bytes32 indexed commitment, uint256 version, uint256 validAfter,
 *     uint256 validUntil, uint256 ruleCount)` on the Keel hook — one per
 *     session; `topics[1]` is the account, `topics[2]` the session id,
 *     `topics[3]` the commitment and the four scalars are the (non-indexed)
 *     data words.
 *   - `UserOperationEvent(bytes32, address, address sender, uint256, bool,
 *     uint256, uint256)` on the canonical EntryPoint — one per UserOp;
 *     `topics[2]` is the sender.
 */
export const CHAIN_TOPICS = {
  sessionInstalled: '0x24e2c054e4fc056c7f8f6be1fc22d4636ab738c03d5034217b68d32dd139a46d',
  userOperationEvent: '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f',
};

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** The lowercase address a 32-byte indexed topic encodes, or null. */
export function topicAddress(topic) {
  const value = String(topic ?? '');
  return BYTES32.test(value) ? `0x${value.slice(26).toLowerCase()}` : null;
}

/** A 20-byte address left-padded into an indexed topic. */
export function addressTopic(address) {
  return `0x${String(address).toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

/** Distinct accounts that installed at least one session, from hook logs. */
export function sessionAccounts(logs) {
  const accounts = new Set();
  for (const log of logs ?? []) {
    const account = topicAddress(log?.topics?.[1]);
    if (account) accounts.add(account);
  }
  return [...accounts].sort();
}

/**
 * Folds one incremental scan into a chain's running state. Counters accumulate
 * from the deploy block, so the numbers are "since Keel went live on this chain"
 * rather than a trailing window — the scans are deltas, which is what keeps the
 * `eth_getLogs` range bounded as the chains grow.
 *
 * @param {{ id: number, key: string, name: string }} chain
 * @param {object | undefined} previous prior state for this chain, if any
 * @param {{ sessionLogs: unknown[], userOpLogs: unknown[], cursorBlock: number }} scan
 */
export function mergeChainScan(chain, previous, scan) {
  const accounts = new Set(previous?.accounts ?? []);
  let installs = previous?.installs ?? 0;
  for (const log of scan.sessionLogs ?? []) {
    const account = topicAddress(log?.topics?.[1]);
    if (account) accounts.add(account);
    installs += 1;
  }
  return {
    id: chain.id,
    key: chain.key,
    name: chain.name,
    cursorBlock: scan.cursorBlock,
    accounts: [...accounts].sort(),
    installs,
    userops: (previous?.userops ?? 0) + (scan.userOpLogs?.length ?? 0),
  };
}

/** Splits `0x`-prefixed hex into 32-byte words; `[]` for empty/odd data. */
export function dataWords(data) {
  const hex = String(data ?? '').replace(/^0x/, '');
  if (hex.length === 0 || hex.length % 64 !== 0) return [];
  const words = [];
  for (let at = 0; at < hex.length; at += 64) words.push(`0x${hex.slice(at, at + 64)}`);
  return words;
}

/**
 * Decodes a `SessionInstalled` log. The commitment is the third indexed topic;
 * the four scalars are the non-indexed data words. Returns null if the log does
 * not carry the expected shape, so a malformed log is skipped rather than
 * throwing mid-scan.
 */
export function decodeSessionInstalled(log) {
  const account = topicAddress(log?.topics?.[1]);
  const sessionId = BYTES32.test(String(log?.topics?.[2] ?? '')) ? log.topics[2] : null;
  const commitment = BYTES32.test(String(log?.topics?.[3] ?? '')) ? log.topics[3] : null;
  const words = dataWords(log?.data);
  if (!account || !sessionId || !commitment || words.length < 4) return null;
  return {
    account,
    sessionId,
    commitment,
    // uint256 → Number: these are timestamps/counters far below 2^53, and
    // keeping them numeric keeps event records JSON-serialisable.
    version: Number(BigInt(words[0])),
    validAfter: Number(BigInt(words[1])),
    validUntil: Number(BigInt(words[2])),
    ruleCount: Number(BigInt(words[3])),
  };
}

/** The sender of a `UserOperationEvent`, from `topics[2]`. */
export function decodeUserOp(log) {
  return topicAddress(log?.topics?.[2]);
}

/**
 * Session status derived at read time from the validity window — the same rule
 * the console's live hook reader uses, and the same the contract enforces:
 * `pending` before `validAfter`, `expired` at/after `validUntil`, else `active`.
 * A zero bound means "no bound" (contract semantics).
 */
export function sessionStatus(validAfter, validUntil, nowSeconds) {
  if (validAfter !== 0 && nowSeconds < validAfter) return 'pending';
  if (validUntil !== 0 && nowSeconds >= validUntil) return 'expired';
  return 'active';
}

/**
 * Turns raw logs into the flat event records the store persists and the panels
 * filter. `timestamps` maps a block number to its unix time (seconds), so time
 * filters never have to guess from a block height.
 *
 * @param {{ key: string, name: string }} chain
 * @param {{ sessionLogs: unknown[], userOpLogs: unknown[] }} scan
 * @param {Map<number, number>} timestamps block number → unix seconds
 */
export function toEvents(chain, scan, timestamps = new Map()) {
  const events = [];
  for (const log of scan.sessionLogs ?? []) {
    const decoded = decodeSessionInstalled(log);
    if (!decoded) continue;
    const blockNumber = blockOf(log);
    events.push({
      chain: chain.key,
      chainName: chain.name,
      type: 'session',
      account: decoded.account,
      sessionId: decoded.sessionId,
      blockNumber,
      timestamp: timestamps.get(blockNumber) ?? null,
      txHash: log?.transactionHash ?? null,
      ...decoded,
    });
  }
  for (const log of scan.userOpLogs ?? []) {
    const account = decodeUserOp(log);
    if (!account) continue;
    const blockNumber = blockOf(log);
    events.push({
      chain: chain.key,
      chainName: chain.name,
      type: 'userop',
      account,
      blockNumber,
      timestamp: timestamps.get(blockNumber) ?? null,
      txHash: log?.transactionHash ?? null,
    });
  }
  return events;
}

/** Block height of a log, as a number (null when absent/unparseable). */
export function blockOf(log) {
  const raw = log?.blockNumber;
  if (typeof raw === 'number') return raw;
  try {
    return Number(BigInt(raw));
  } catch {
    return null;
  }
}

/**
 * Labels accounts with their integrating project, from the maintained registry
 * (`metrics/adopters.json`). Entries without addresses simply label nothing.
 *
 * @param {Array<{ name?: string, url?: string, addresses?: string[] }> | null} adopters
 * @returns {Map<string, { name: string, url: string | null }>} address → project
 */
export function buildLabelMap(adopters) {
  const map = new Map();
  for (const adopter of Array.isArray(adopters) ? adopters : []) {
    const name = typeof adopter?.name === 'string' && adopter.name.length > 0 ? adopter.name : null;
    if (!name) continue;
    const url = typeof adopter?.url === 'string' ? adopter.url : null;
    for (const address of Array.isArray(adopter?.addresses) ? adopter.addresses : []) {
      const key = String(address).toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(key)) map.set(key, { name, url });
    }
  }
  return map;
}

/**
 * Aggregates session/userop events into one row per account — the account list
 * the console renders. `status` summarises the account's sessions (active if any
 * is live, else pending, else expired); an account with sessions but no userops
 * is still listed, since "installed Keel" is itself adoption.
 *
 * @param {Array<Record<string, any>>} events
 * @param {Map<string, { name: string, url: string | null }>} labels
 * @param {number} nowSeconds
 */
export function foldAccounts(events, labels = new Map(), nowSeconds = 0) {
  const byAccount = new Map();
  for (const event of events ?? []) {
    if (!event?.account) continue;
    let row = byAccount.get(event.account);
    if (!row) {
      row = {
        address: event.account,
        label: null,
        chains: new Set(),
        sessions: 0,
        installs: 0,
        userops: 0,
        lastActivity: null,
        statuses: [],
      };
      byAccount.set(event.account, row);
    }
    row.chains.add(event.chain);
    if (event.type === 'session') {
      row.sessions += 1;
      row.installs += 1;
      row.statuses.push(sessionStatus(event.validAfter ?? 0, event.validUntil ?? 0, nowSeconds));
    } else if (event.type === 'userop') {
      row.userops += 1;
    }
    if (typeof event.timestamp === 'number') {
      row.lastActivity = row.lastActivity === null ? event.timestamp : Math.max(row.lastActivity, event.timestamp);
    }
  }

  return [...byAccount.values()]
    .map((row) => ({
      address: row.address,
      label: labels.get(row.address) ?? null,
      chains: [...row.chains].sort(),
      sessions: row.sessions,
      installs: row.installs,
      userops: row.userops,
      lastActivity: row.lastActivity,
      status: summarizeStatus(row.statuses),
    }))
    .sort((a, b) => b.installs - a.installs || a.address.localeCompare(b.address));
}

function summarizeStatus(statuses) {
  if (statuses.includes('active')) return 'active';
  if (statuses.includes('pending')) return 'pending';
  return 'expired';
}

/**
 * Filters the account rows by the console's controls. Every filter is optional;
 * a blank value means "all". `q` matches the address, `label` the project name.
 *
 * @param {Array<Record<string, any>>} rows
 * @param {{ chain?: string, label?: string, status?: string, q?: string }} filters
 */
export function filterAccounts(rows, filters = {}) {
  const chain = blank(filters.chain);
  const label = blank(filters.label);
  const status = blank(filters.status);
  const q = blank(filters.q)?.toLowerCase();
  return (rows ?? []).filter((row) => {
    if (chain && !row.chains.includes(chain)) return false;
    if (label && row.label?.name !== label) return false;
    if (status && row.status !== status) return false;
    if (q && !row.address.toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * Filters raw events by chain / account / type / time window. `since` and
 * `until` are unix seconds (inclusive / exclusive); events without a timestamp
 * are dropped only when a time bound is requested.
 *
 * @param {Array<Record<string, any>>} events
 * @param {{ chain?: string, account?: string, type?: string, since?: number, until?: number, limit?: number }} filters
 */
export function filterEvents(events, filters = {}) {
  const chain = blank(filters.chain);
  const account = blank(filters.account)?.toLowerCase();
  const type = blank(filters.type);
  const { since, until } = filters;
  const matched = (events ?? []).filter((event) => {
    if (chain && event.chain !== chain) return false;
    if (account && event.account?.toLowerCase() !== account) return false;
    if (type && event.type !== type) return false;
    if (since !== undefined || until !== undefined) {
      if (typeof event.timestamp !== 'number') return false;
      if (since !== undefined && event.timestamp < since) return false;
      if (until !== undefined && event.timestamp >= until) return false;
    }
    return true;
  });
  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : matched.length;
  return matched.slice(-limit); // newest last in storage, so last-N is newest-N
}

/**
 * A daily series over the last `days` days, derived from event timestamps — the
 * "accounts / installs / userops over time" the overview chart renders. Events
 * without a timestamp are skipped; a day with no events is a zero, not a gap.
 *
 * @param {Array<Record<string, any>>} events
 * @param {{ days?: number, nowSeconds: number }} options
 */
export function buildSeries(events, { days = 30, nowSeconds }) {
  const daySeconds = 86_400;
  const start = Math.floor(Number(nowSeconds) / daySeconds) * daySeconds - (days - 1) * daySeconds;
  const buckets = new Map();
  for (let i = 0; i < days; i += 1) {
    buckets.set(isoDay(start + i * daySeconds), { date: isoDay(start + i * daySeconds), accounts: new Set(), installs: 0, userops: 0 });
  }
  for (const event of events ?? []) {
    if (typeof event?.timestamp !== 'number' || event.timestamp < start) continue;
    const bucket = buckets.get(isoDay(event.timestamp));
    if (!bucket) continue;
    bucket.accounts.add(event.account);
    if (event.type === 'session') bucket.installs += 1;
    else if (event.type === 'userop') bucket.userops += 1;
  }
  return [...buckets.values()].map((bucket) => ({
    date: bucket.date,
    accounts: bucket.accounts.size,
    installs: bucket.installs,
    userops: bucket.userops,
  }));
}

function isoDay(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function blank(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
