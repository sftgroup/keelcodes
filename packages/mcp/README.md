# @keelcodes/mcp

Keel's **aggregator MCP server** — exposes the whole Keel platform (payments, wallets,
data and account administration) to an AI agent as [Model Context Protocol](https://modelcontextprotocol.io)
tools. One server, one endpoint, **147 tools**.

`keel-mcp` is a thin, stateless adapter: every tool call is forwarded to the Keel
gateway (`/v1/<module>/*`) through [`@keelcodes/sdk`](../sdk). It holds no keys of
its own beyond the ones you give it, and no tenant private keys ever.

> Looking for the *policy-aware* server (where a call is checked against
> `@keelcodes/policy` before it runs)? That is
> [`@keelcodes/mcp-policy`](../mcp-policy) — a different product with its own name.

## Tools

| Module | Tools | Prefix | Covers |
|---|---|---|---|
| payment | 33 | `payment_*` | charges, x402 verification, balances/orders, a2a, batch collection, billing invites, ledger transfers, B-side settle-fee balance & self top-up |
| wallet | 66 | `wallet_*` | WAAS, Safe multisig, smart-account sessions, Solana Squads, MPC email wallet, chain-rpc subscriptions |
| data | 43 | `data_*` | candles/quotes/factors/predictions/events/graph/RAG, DEX quotes, DC subscriptions, factor mining |
| account | 7 | `account_*` | tenants, module keys, module subscriptions |

The tool definitions live in [`src/tools/`](./src/tools) — that directory is the
source of truth; the counts above are derived from it.

## Transports

| Mode | Enable | Endpoint |
|---|---|---|
| **stdio** (default) | `MCP_TRANSPORT=stdio` (or unset) | newline-delimited JSON-RPC on stdin/stdout |
| **Streamable HTTP** | `MCP_TRANSPORT=http` | `POST /mcp/message` (stateless, JSON responses) |

In HTTP mode `GET /health` and `GET /` are unauthenticated and report
`{ status, name, transport, tools }`.

## Configuration

All configuration is environment-only — there is no config file.

| Variable | Default | Meaning |
|---|---|---|
| `KEEL_API_BASE` | `https://keel.codes` | Gateway base URL |
| `KEEL_SERVICE_KEY` | — | Internal-service bypass: sent as `X-Service-Key`, skips per-module key checks. Only for trusted internal components |
| `KEEL_API_KEY_<MODULE>` | — | Per-module key for `payment` / `wallet` / `data` / `account` |
| `KEEL_API_KEY` | — | Fallback key when a per-module key is absent |
| `MCP_API_KEY` | — | Inbound allow-list (comma-separated) for HTTP mode |
| `MCP_ALLOW_USER_KEYS` | `on` | Accept client-supplied `sk_<module>_*` keys as per-user identity |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `PORT` | `3008` | Listening port in HTTP mode |

### Inbound authentication (HTTP mode)

Two identities are accepted:

1. **Operator allow-list** — `MCP_API_KEY` (comma-separated), presented as
   `Authorization: Bearer <key>`, `X-API-Key` or `X-Service-Key`. Outbound calls use
   the server's own `KEEL_*` credentials.
2. **Per-user key** — a client-supplied `sk_<module>_*` key. It is used *only* for
   that request's outbound calls, so the gateway meters that user's own quota. Set
   `MCP_ALLOW_USER_KEYS=off` to disable.

Anything else is rejected with `401 UNAUTHORIZED` (fail-closed).

### `account_*` and wallet signatures

The `account_*` tools authenticate by **wallet signature**, not by an API key. The
MCP server holds no tenant private keys: the client signs
`Keel auth: <timestamp>` (EIP-191) and sends three headers on the MCP request —
`x-wallet-address`, `x-wallet-timestamp`, `x-wallet-signature` — which are forwarded
to the gateway unchanged. Without all three, `account_*` tools fail before any
downstream call is made.

## Install into an MCP client

```jsonc
// Claude Desktop / Cursor — stdio
{
  "mcpServers": {
    "keel": {
      "command": "npx",
      "args": ["-y", "@keelcodes/mcp"],
      "env": {
        "KEEL_API_KEY_PAYMENT": "sk_payment_...",
        "KEEL_API_KEY_WALLET": "sk_wallet_...",
        "KEEL_API_KEY_DATA": "sk_data_..."
      }
    }
  }
}
```

Or point a client at a self-hosted HTTP instance:

```jsonc
{
  "mcpServers": {
    "keel": {
      "url": "https://keel.codes/mcp/message",
      "headers": { "Authorization": "Bearer sk_data_..." }
    }
  }
}
```

## Development

```bash
pnpm --filter @keelcodes/mcp build
pnpm --filter @keelcodes/mcp test
```

`test` builds to `dist/` first, then runs `node --test` against it.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
