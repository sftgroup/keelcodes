# `@keelcodes/api`

The console's backend, for the things the browser cannot get from a chain:
the **session index** (which module version a session belongs to, §7.5 of the
plan), the **settlement ledger**, and the **adoption overview** (an incremental
scan of the Keel hook and the EntryPoint). It is also where the console's own
**telemetry** lands.

It is the reference `SessionStore` the plan calls for (§6.3): no tenant
dimension and no private keys — unlike infraX's multi-tenant store, which stays
private. Zero dependencies, so the runtime is just `node`.

## Run

```bash
pnpm --filter @keelcodes/api start     # http://127.0.0.1:8080
pnpm --filter @keelcodes/api test      # node:test
```

Or as part of the self-host stack — see [`infra/docker-compose.yml`](../../infra/docker-compose.yml),
which brings up `anvil · deployer · bundler · paymaster · api`.

## Endpoints

| method | path | body / query | returns |
|---|---|---|---|
| `GET` | `/health` | — | `{ ok: true }` |
| `GET` | `/sessions` | `?account=` | `{ sessions }` |
| `POST` | `/sessions` | `{ account, sessionId, moduleVersion, … }` | `{ session }` |
| `GET` | `/settlement/ledger` | `?account=` | `{ entries }` (newest first) |
| `POST` | `/settlement/intents` | `{ account, protocol, amount, … }` | `{ entry }` |
| `GET` | `/telemetry` | — | `{ counters }` |
| `POST` | `/telemetry` | `{ kind, by? }` | `{ counters }` |
| `GET` | `/overview` | `?days=` | `{ totals, chains, series, projects, indexer }` |
| `GET` | `/accounts` | `?chain=&label=&status=&q=&since=&until=` | `{ total, accounts }` |
| `GET` | `/events` | `?chain=&account=&type=&since=&until=&limit=` | `{ events }` (newest first) |
| `POST` | `/index` | — | `{ ok, updatedAt }` — runs a scan now (needs `KEEL_INDEX_ENABLED`) |

`protocol` is one of `x402 · mpp · erc8183 · a2a`. `kind` is one of
`conformance.run · settlement.intent · docs.visit`. `settlement.intent` is
**derived from the ledger**, so recording an intent is the only way to move it —
there is no second counter to drift.

## Adoption overview

`/overview`, `/accounts` and `/events` read the on-chain scan the **indexer**
maintains. The indexer runs *the same rules* as the metrics dashboard — the
chain list, event topics, cursor semantics and the fold all come from
[`src/scan.mjs`](src/scan.mjs), which
[`tools/metrics/collect.mjs`](../../tools/metrics/collect.mjs) also imports — so
the console and the committed dashboard can never disagree. On top of the
counters the indexer records each event with its block timestamp, which is what
the daily series and the time-window filters need.

The indexer is **off by default** (`KEEL_INDEX_ENABLED=1`), so a local self-host
stack never makes surprise public-RPC calls. When it is on, it scans once at
startup and then every `KEEL_INDEX_INTERVAL_MS`; `POST /index` forces a scan.

Accounts are attributed to a project by the hand-kept
[`metrics/adopters.json`](../../metrics/adopters.json) registry: an entry may
carry an `addresses` list, and `KEEL_ADOPTERS_FILE` points the service at the
file. Unlabelled accounts still appear — labelling is optional.

All three endpoints are **reads** and stay open (they only surface public chain
data), like the rest of the GETs.

## Configuration

| variable | default | meaning |
|---|---|---|
| `KEEL_API_PORT` | `8080` | listen port |
| `KEEL_API_STORE` | — (in memory) | JSON file the store persists to |
| `KEEL_API_TOKEN` | — | when set, `POST`s require the `x-keel-token` header (**reads stay open**) |
| `KEEL_API_ORIGIN` | `*` | value for `access-control-allow-origin` |
| `KEEL_INDEX_ENABLED` | off | `1`/`true` turns the on-chain adoption indexer on |
| `KEEL_INDEX_INTERVAL_MS` | `900000` | indexer scan interval (15 min) |
| `KEEL_ADOPTERS_FILE` | — | path to the `adopters.json` label registry |

Reads are open on purpose: everything the console reads is already public — the
session index mirrors on-chain state, and the ledger carries no private keys.

## Not here

Billing, multi-tenant store and KMS stay in infraX (plan D10 / §6.3). This
service records settlement *intents and their protocol*, not what a platform
charges for them.
