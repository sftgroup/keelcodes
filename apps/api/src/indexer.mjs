/**
 * The on-chain adoption indexer — the console backend's read side.
 *
 * It runs the *same* incremental scan as `tools/metrics/collect.mjs` (chain
 * list, event topics, cursor semantics and the fold all come from `scan.mjs`),
 * so the console's overview and the committed dashboard can never show
 * different numbers. On top of the counters it also records each event with its
 * block's timestamp, which is what the overview's time series and time-window
 * filters need and the dashboard never asked for.
 *
 * It is off by default (`KEEL_INDEX_ENABLED=1` turns it on) so a local
 * self-host stack never makes surprise public-RPC calls. All I/O goes through an
 * injectable `fetchImpl`, so the tests run without a network.
 */

import {
  CHAINS,
  CHAIN_TOPICS,
  addressTopic,
  blockOf,
  mergeChainScan,
  sessionAccounts,
  toEvents,
} from './scan.mjs';

const hexBlock = (value) => `0x${BigInt(value).toString(16)}`;

/**
 * @param {object} options
 * @param {ReturnType<import('./store.mjs').createStore>} options.store
 * @param {typeof CHAINS} [options.chains]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.confirmations] blocks to keep short of the head
 * @param {number} [options.maxEvents] cap on the retained event log
 * @param {(line: string) => void} [options.log]
 */
export function createIndexer({
  store,
  chains = CHAINS,
  env = process.env,
  fetchImpl = fetch,
  confirmations = 12,
  maxEvents = 5000,
  log = () => {},
}) {
  const urlFor = (chain) => env[chain.rpcEnv] || chain.defaultRpc;

  /** A JSON-RPC call, retrying a couple of times — public endpoints reject bursts. */
  async function rpc(url, method, params, attempts = 3) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
        return body.result;
      } catch (error) {
        if (attempt >= attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  /** `eth_getLogs` over a range, split into chunks the RPC will accept. */
  async function getLogs(url, { address, topics, fromBlock, toBlock, chunk }) {
    const logs = [];
    for (let start = fromBlock; start <= toBlock; start += chunk) {
      const end = Math.min(start + chunk - 1, toBlock);
      const page = await rpc(url, 'eth_getLogs', [
        { address, topics, fromBlock: hexBlock(start), toBlock: hexBlock(end) },
      ]);
      logs.push(...page);
    }
    return logs;
  }

  /** Unix-second timestamps for a set of block heights, fetched once each. */
  async function blockTimestamps(url, blocks) {
    const pairs = await Promise.all(
      [...blocks].map(async (height) => {
        try {
          const block = await rpc(url, 'eth_getBlockByNumber', [hexBlock(height), false]);
          return block?.timestamp === undefined ? null : [height, Number(BigInt(block.timestamp))];
        } catch {
          return null; // a missing timestamp degrades the time view, never the counters
        }
      }),
    );
    return new Map(pairs.filter((pair) => pair !== null));
  }

  /**
   * Brings every chain up to date and persists the result. A chain whose RPC
   * fails keeps its previous state — the counters are cumulative, so resetting
   * them would be a lie.
   */
  async function run() {
    const adoption = store.getAdoption();
    const priorById = new Map((adoption.chains ?? []).map((chain) => [chain.id, chain]));
    let events = [...(adoption.events ?? [])];
    const nextChains = [];

    for (const chain of chains) {
      const prior = priorById.get(chain.id);
      const url = urlFor(chain);
      try {
        const head = Number(BigInt(await rpc(url, 'eth_blockNumber', []))) - confirmations;
        const from = (prior?.cursorBlock ?? chain.deployBlock - 1) + 1;
        if (from > head) {
          log(`· ${chain.name}: no new blocks (cursor ${from - 1}, head ${head})`);
          if (prior) nextChains.push(prior);
          continue;
        }

        const sessionLogs = await getLogs(url, {
          address: chain.hook,
          topics: [CHAIN_TOPICS.sessionInstalled],
          fromBlock: from,
          toBlock: head,
          chunk: chain.logChunk,
        });
        const accounts = new Set([...(prior?.accounts ?? []), ...sessionAccounts(sessionLogs)]);
        const userOpLogs =
          accounts.size === 0
            ? []
            : await getLogs(url, {
                address: chain.entryPoint,
                topics: [CHAIN_TOPICS.userOperationEvent, null, [...accounts].map(addressTopic)],
                fromBlock: from,
                toBlock: head,
                chunk: chain.logChunk,
              });

        const blocks = new Set(
          [...sessionLogs, ...userOpLogs].map((entry) => blockOf(entry)).filter((height) => height !== null),
        );
        const timestamps = await blockTimestamps(url, blocks);

        events.push(...toEvents(chain, { sessionLogs, userOpLogs }, timestamps));
        nextChains.push(mergeChainScan(chain, prior, { sessionLogs, userOpLogs, cursorBlock: head }));
        log(
          `· ${chain.name}: blocks ${from}–${head} → +${sessionLogs.length} session installs, +${userOpLogs.length} UserOps`,
        );
      } catch (error) {
        log(`! ${chain.name}: ${error instanceof Error ? error.message : error} — keeping previous counters`);
        if (prior) nextChains.push(prior);
      }
    }

    if (events.length > maxEvents) events = events.slice(events.length - maxEvents);
    return store.setAdoption({ chains: nextChains, events, updatedAt: new Date().toISOString() });
  }

  return { run };
}

/** Schedules `run()` immediately and then on `intervalMs`; returns a stop fn. */
export function startIndexer(indexer, intervalMs) {
  const timer = setInterval(() => {
    indexer.run().catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  indexer.run().catch(() => {});
  return () => clearInterval(timer);
}
