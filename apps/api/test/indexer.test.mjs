import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createIndexer } from '../src/indexer.mjs';
import { createHandler } from '../src/server.mjs';
import { createStore } from '../src/store.mjs';
import { addressTopic, CHAIN_TOPICS } from '../src/scan.mjs';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const SESSION = `0x${'ab'.repeat(32)}`;
const BLOCK_TIME = 1_700_000_000;

const word = (value) => BigInt(value).toString(16).padStart(64, '0');

function sessionLog(blockNumber = 150) {
  return {
    address: '0xhook',
    topics: [CHAIN_TOPICS.sessionInstalled, addressTopic(ACCOUNT), SESSION, `0x${'cc'.repeat(32)}`],
    data: `0x${word(1)}${word(0)}${word(0)}${word(2)}`,
    blockNumber,
    transactionHash: '0xs',
  };
}

function userOpLog(blockNumber = 151) {
  return {
    address: '0xentry',
    topics: [CHAIN_TOPICS.userOperationEvent, `0x${'ff'.repeat(32)}`, addressTopic(ACCOUNT)],
    data: '0x',
    blockNumber,
    transactionHash: '0xu',
  };
}

const CHAIN = {
  id: 56,
  key: 'bsc',
  name: 'BSC',
  hook: '0xhook',
  entryPoint: '0xentry',
  deployBlock: 100,
  logChunk: 1000,
  rpcEnv: 'KEEL_RPC_56',
  defaultRpc: 'http://rpc.test',
};

/** A fetch stub that answers the three JSON-RPC methods the indexer calls. */
function rpcStub({ head = 200, fail = false } = {}) {
  return async (_url, init) => {
    if (fail) throw new Error('rpc down');
    const { method, params } = JSON.parse(init.body);
    const result = {
      eth_blockNumber: () => `0x${head.toString(16)}`,
      eth_getLogs: () => (params[0].address === '0xhook' ? [sessionLog()] : [userOpLog()]),
      eth_getBlockByNumber: () => ({ timestamp: `0x${BLOCK_TIME.toString(16)}` }),
    }[method]?.();
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
}

describe('indexer', () => {
  it('scans incrementally and records timestamped events', async () => {
    const store = createStore();
    const indexer = createIndexer({ store, chains: [CHAIN], env: {}, fetchImpl: rpcStub(), confirmations: 12 });

    await indexer.run();
    const adoption = store.getAdoption();
    // head 200 - 12 confirmations = cursor 188
    assert.equal(adoption.chains[0].cursorBlock, 188);
    assert.equal(adoption.chains[0].installs, 1);
    assert.equal(adoption.chains[0].userops, 1);
    assert.deepEqual(adoption.chains[0].accounts, [ACCOUNT]);
    assert.equal(adoption.events.length, 2);
    assert.equal(adoption.events.find((event) => event.type === 'session').timestamp, BLOCK_TIME);

    // A second run with the same head is a no-op: the cursor is already at it.
    await indexer.run();
    assert.equal(store.getAdoption().events.length, 2);
    assert.equal(store.getAdoption().chains[0].installs, 1);
  });

  it('keeps the previous counters when the RPC fails', async () => {
    const store = createStore();
    const good = createIndexer({ store, chains: [CHAIN], env: {}, fetchImpl: rpcStub() });
    await good.run();
    const before = store.getAdoption();

    const flaky = createIndexer({ store, chains: [CHAIN], env: {}, fetchImpl: rpcStub({ fail: true }) });
    await flaky.run();
    const after = store.getAdoption();
    assert.deepEqual(after.chains, before.chains);
    assert.equal(after.events.length, before.events.length);
  });
});

describe('adoption endpoints', () => {
  let server;
  let base;
  const store = createStore();

  before(async () => {
    store.setAdoption({
      updatedAt: '2026-10-07T00:00:00.000Z',
      chains: [{ id: 56, key: 'bsc', name: 'BSC', cursorBlock: 188, accounts: [ACCOUNT], installs: 1, userops: 1 }],
      events: [
        {
          chain: 'bsc',
          chainName: 'BSC',
          type: 'session',
          account: ACCOUNT,
          sessionId: SESSION,
          blockNumber: 150,
          timestamp: BLOCK_TIME,
          validAfter: 0,
          validUntil: 0,
        },
        { chain: 'bsc', chainName: 'BSC', type: 'userop', account: ACCOUNT, blockNumber: 151, timestamp: BLOCK_TIME + 10 },
      ],
    });

    const handler = createHandler({
      store,
      labels: new Map([[ACCOUNT, { name: 'Acme', url: 'https://acme.test' }]]),
      projects: ['Acme'],
      indexer: { run: async () => store.getAdoption() },
      indexerIntervalMs: 1000,
      now: () => BLOCK_TIME * 1000,
    });
    server = createHttpServer((req, res) => void handler(req, res));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  const get = async (path) => {
    const res = await fetch(`${base}${path}`);
    return { status: res.status, body: await res.json() };
  };

  it('serves the overview from cumulative counters', async () => {
    const { status, body } = await get('/overview');
    assert.equal(status, 200);
    assert.equal(body.totals.accounts, 1);
    assert.equal(body.totals.installs, 1);
    assert.equal(body.indexer.enabled, true);
    assert.equal(body.chains[0].key, 'bsc');
    assert.equal(body.projects[0], 'Acme');
  });

  it('serves, labels and filters accounts', async () => {
    const all = await get('/accounts');
    assert.equal(all.body.accounts[0].label.name, 'Acme');

    assert.equal((await get('/accounts?label=Acme')).body.accounts.length, 1);
    assert.equal((await get('/accounts?label=Nope')).body.accounts.length, 0);
    assert.equal((await get('/accounts?q=9999')).body.accounts.length, 0);

    const bad = await get('/accounts?status=made.up');
    assert.equal(bad.status, 400);
  });

  it('serves events newest-first with filters', async () => {
    const all = await get('/events');
    assert.equal(all.body.events.length, 2);
    assert.equal(all.body.events[0].type, 'userop'); // newest first

    assert.equal((await get('/events?type=session')).body.events.length, 1);
    assert.equal((await get(`/events?account=${ACCOUNT}`)).body.events.length, 2);
    assert.equal((await get(`/events?since=${BLOCK_TIME + 5}`)).body.events.length, 1);

    assert.equal((await get('/events?account=nope')).status, 400);
    assert.equal((await get('/events?type=nope')).status, 400);
  });

  it('triggers the indexer over POST /index', async () => {
    const res = await fetch(`${base}/index`, { method: 'POST' });
    assert.equal(res.status, 202);
    assert.equal((await res.json()).ok, true);
  });

  it('refuses POST /index when the indexer is disabled', async () => {
    const handler = createHandler({ store: createStore(), indexer: null });
    const srv = createHttpServer((req, res) => void handler(req, res));
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/index`, { method: 'POST' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /not enabled/);
    await new Promise((resolve) => srv.close(resolve));
  });
});
