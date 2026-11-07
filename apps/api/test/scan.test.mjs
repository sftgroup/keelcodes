import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addressTopic,
  buildLabelMap,
  buildSeries,
  CHAIN_TOPICS,
  decodeSessionInstalled,
  foldAccounts,
  filterAccounts,
  filterEvents,
  sessionStatus,
  toEvents,
} from '../src/scan.mjs';
import { buildAccounts, buildEvents, buildOverview } from '../src/views.mjs';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const OTHER = `0x${'22'.repeat(20)}`;
const SESSION = `0x${'ab'.repeat(32)}`;
const COMMITMENT = 'cc'.repeat(32);

const word = (value) => BigInt(value).toString(16).padStart(64, '0');

/** A `SessionInstalled` log with the given scalars (the commitment is indexed). */
function sessionLog({ account = ACCOUNT, sessionId = SESSION, commitment = `0x${COMMITMENT}`, version = 1, validAfter = 0, validUntil = 0, ruleCount = 2, blockNumber = 10 } = {}) {
  return {
    address: '0xhook',
    topics: [CHAIN_TOPICS.sessionInstalled, addressTopic(account), sessionId, commitment],
    data: `0x${word(version)}${word(validAfter)}${word(validUntil)}${word(ruleCount)}`,
    blockNumber,
    transactionHash: '0xtx',
  };
}

/** A `UserOperationEvent` log; the sender is `topics[2]`. */
function userOpLog({ account = ACCOUNT, blockNumber = 11 } = {}) {
  return {
    address: '0xentry',
    topics: [CHAIN_TOPICS.userOperationEvent, `0x${'ff'.repeat(32)}`, addressTopic(account)],
    data: '0x',
    blockNumber,
    transactionHash: '0xtx2',
  };
}

const chain = { key: 'bsc', name: 'BSC' };

describe('scan decoding', () => {
  it('decodes a SessionInstalled log', () => {
    const decoded = decodeSessionInstalled(sessionLog({ version: 1, validAfter: 5, validUntil: 99, ruleCount: 3 }));
    assert.equal(decoded.account, ACCOUNT);
    assert.equal(decoded.sessionId, SESSION);
    assert.equal(decoded.commitment, `0x${COMMITMENT}`);
    assert.equal(decoded.version, 1);
    assert.equal(decoded.validAfter, 5);
    assert.equal(decoded.validUntil, 99);
    assert.equal(decoded.ruleCount, 3);
  });

  it('returns null for a malformed log rather than throwing', () => {
    assert.equal(decodeSessionInstalled({ topics: [], data: '0x' }), null);
    assert.equal(decodeSessionInstalled({ topics: [CHAIN_TOPICS.sessionInstalled, addressTopic(ACCOUNT)], data: '0x00' }), null);
  });

  it('derives session status from the validity window', () => {
    assert.equal(sessionStatus(0, 0, 100), 'active');
    assert.equal(sessionStatus(200, 0, 100), 'pending');
    assert.equal(sessionStatus(0, 100, 100), 'expired');
    assert.equal(sessionStatus(0, 50, 100), 'expired');
  });
});

describe('events and folding', () => {
  const scan = {
    sessionLogs: [sessionLog({ account: ACCOUNT, blockNumber: 10 }), sessionLog({ account: OTHER, sessionId: `0x${'cd'.repeat(32)}`, blockNumber: 12 })],
    userOpLogs: [userOpLog({ account: ACCOUNT, blockNumber: 11 }), userOpLog({ account: ACCOUNT, blockNumber: 13 })],
  };
  const timestamps = new Map([
    [10, 1_700_000_000],
    [11, 1_700_000_100],
    [12, 1_700_000_200],
    [13, 1_700_000_300],
  ]);

  it('turns logs into timestamped event records', () => {
    const events = toEvents(chain, scan, timestamps);
    assert.equal(events.length, 4);
    const session = events.find((event) => event.type === 'session');
    assert.equal(session.account, ACCOUNT);
    assert.equal(session.chain, 'bsc');
    assert.equal(session.timestamp, 1_700_000_000);
    const userop = events.find((event) => event.type === 'userop');
    assert.equal(userop.account, ACCOUNT);
    assert.equal(userop.timestamp, 1_700_000_100);
  });

  it('leaves the timestamp null when the block time is unknown', () => {
    const events = toEvents(chain, { sessionLogs: [sessionLog({ blockNumber: 999 })], userOpLogs: [] }, timestamps);
    assert.equal(events[0].timestamp, null);
  });

  it('folds events into one row per account with a summarised status', () => {
    const events = toEvents(chain, scan, timestamps);
    const rows = foldAccounts(events, new Map([[ACCOUNT, { name: 'Acme', url: 'https://acme.test' }]]), 1_700_000_500);
    const acme = rows.find((row) => row.address === ACCOUNT);
    assert.equal(acme.label.name, 'Acme');
    assert.equal(acme.sessions, 1);
    assert.equal(acme.installs, 1);
    assert.equal(acme.userops, 2);
    assert.equal(acme.status, 'active');
    assert.equal(acme.lastActivity, 1_700_000_300);
    const other = rows.find((row) => row.address === OTHER);
    assert.equal(other.userops, 0);
    assert.equal(other.label, null);
  });

  it('marks an account expired when every session window has closed', () => {
    const expired = sessionLog({ account: ACCOUNT, validUntil: 1_000, blockNumber: 10 });
    const events = toEvents(chain, { sessionLogs: [expired], userOpLogs: [] }, timestamps);
    const rows = foldAccounts(events, new Map(), 2_000);
    assert.equal(rows[0].status, 'expired');
  });
});

describe('filters', () => {
  const events = toEvents(
    chain,
    {
      sessionLogs: [sessionLog({ account: ACCOUNT, blockNumber: 10 }), sessionLog({ account: OTHER, sessionId: `0x${'cd'.repeat(32)}`, blockNumber: 12 })],
      userOpLogs: [userOpLog({ account: ACCOUNT, blockNumber: 13 })],
    },
    new Map([[10, 100], [12, 200], [13, 300]]),
  );
  const labels = new Map([[ACCOUNT, { name: 'Acme', url: null }]]);
  const rows = foldAccounts(events, labels, 400);

  it('filters account rows by label and address', () => {
    assert.equal(filterAccounts(rows, { label: 'Acme' }).length, 1);
    assert.equal(filterAccounts(rows, { q: '22' })[0].address, OTHER);
    assert.equal(filterAccounts(rows, { chain: 'bsc' }).length, 2);
    assert.equal(filterAccounts(rows, { chain: 'base' }).length, 0);
  });

  it('filters events by type, account and window', () => {
    assert.equal(filterEvents(events, { type: 'userop' }).length, 1);
    assert.equal(filterEvents(events, { account: ACCOUNT }).length, 2);
    assert.equal(filterEvents(events, { since: 150, until: 250 }).length, 1);
    assert.equal(filterEvents(events, { limit: 1 }).length, 1);
    // newest-last storage → last-N is newest-N, so the keeper is the latest one.
    assert.equal(filterEvents(events, { limit: 1 })[0].timestamp, 300);
  });
});

describe('label registry and views', () => {
  it('maps adopter addresses to a project, case-insensitively', () => {
    const mixed = '0xAbCd000000000000000000000000000000000001';
    const map = buildLabelMap([
      { name: 'Acme', url: 'https://acme.test', addresses: [mixed] },
      { name: 'Ignored' },
      { name: 'Bad', addresses: ['nope'] },
    ]);
    assert.deepEqual(map.get(mixed.toLowerCase()), { name: 'Acme', url: 'https://acme.test' });
    assert.equal(map.size, 1);
  });

  it('builds a daily series with zero-filled days', () => {
    const series = buildSeries(
      [
        { account: ACCOUNT, type: 'session', timestamp: 1_700_000_000 },
        { account: ACCOUNT, type: 'userop', timestamp: 1_700_000_100 },
        { account: OTHER, type: 'userop', timestamp: 1_700_000_200 },
      ],
      { days: 3, nowSeconds: 1_700_000_200 },
    );
    assert.equal(series.length, 3);
    assert.equal(series.at(-1).accounts, 2);
    assert.equal(series.at(-1).installs, 1);
    assert.equal(series.at(-1).userops, 2);
  });

  it('shapes the overview from cumulative chain state, not the capped event log', () => {
    const overview = buildOverview({
      adoption: {
        updatedAt: '2026-10-07T00:00:00.000Z',
        chains: [{ id: 56, key: 'bsc', name: 'BSC', cursorBlock: 100, accounts: [ACCOUNT, OTHER], installs: 5, userops: 9 }],
        events: [],
      },
      projects: ['Acme'],
      days: 2,
      nowSeconds: 1_700_000_000,
      indexer: { enabled: true, intervalMs: 1000 },
    });
    assert.equal(overview.totals.accounts, 2);
    assert.equal(overview.totals.installs, 5);
    assert.equal(overview.totals.userops, 9);
    assert.equal(overview.chains[0].accounts, 2);
    assert.equal(overview.projects.length, 1);
    assert.equal(overview.series.length, 2);
  });

  it('narrows the account and event views', () => {
    const adoption = {
      updatedAt: null,
      chains: [],
      events: toEvents(chain, { sessionLogs: [sessionLog({ blockNumber: 10 })], userOpLogs: [] }, new Map([[10, 100]])),
    };
    assert.equal(buildAccounts({ adoption, labels: new Map(), nowSeconds: 200 }).accounts.length, 1);
    assert.equal(buildAccounts({ adoption, labels: new Map(), nowSeconds: 200, filters: { status: 'expired' } }).accounts.length, 0);
    assert.equal(buildEvents({ adoption }).events.length, 1);
  });
});
