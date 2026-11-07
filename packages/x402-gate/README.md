# @keelcodes/x402-gate

给任意 HTTP 接口加一道 x402 v2 收费门：**不持私钥、不接触链**，只把客户端的
`PAYMENT-SIGNATURE` 转给支付引擎验签/结算。

- 标准轨：`exact` over **EIP-3009**（Base USDC）或 **Permit2**（BSC USDT/USDC、任意 ERC-20、智能账户）
- Keel 轨：客户端先转账、载荷里带 `txHash`，网关自动改用 `/x402/verify`
- 运行时无关：Express / Fetch / Next.js App Router（含 edge）/ Workers

## 安装

```bash
npm i @keelcodes/x402-gate
```

## Express

```ts
import express from 'express'
import { createX402Gate } from '@keelcodes/x402-gate'

const app = express()
app.use(express.json())

const gate = createX402Gate({
  paymentsUrl: 'https://keel.codes/v1/payment',
  paymentsKey: process.env.PAYMENTS_KEY,
  payTo: '0xYourReceivingAddress',
  amount: '2000', // 最小单位
  accepts: [
    { network: 'eip155:8453', asset: '0x8335…2913', eip3009: { name: 'USD Coin', version: '2' } },
    { network: 'eip155:56', asset: '0x55d3…7955', permit2: true },
  ],
})

app.get('/quote', gate, (_req, res) => res.json({ price: 42 }))
```

## Next.js App Router

```ts
import { withX402 } from '@keelcodes/x402-gate'

const gateOptions = { /* 同上 */ }

export const GET = withX402(gateOptions, async () => Response.json({ price: 42 }))
```

## 配置

| 字段 | 说明 |
|---|---|
| `paymentsUrl` | 支付引擎地址（自建或 `https://keel.codes/v1/payment`） |
| `paymentsKey` | 支付引擎 Bearer key |
| `payTo` | 收款地址（B 端自己的钱包；资金直达，不经平台） |
| `amount` | 单次价格（最小单位）；也可用 `amountFor(path, req)` 动态定价（A7.9.3：`req.query` 可取 `limit` 做阶梯）。不填时从第一个带 `amount` 的 accept 取价（`0.1.1` 起；再没有就**直接报错**，不会静默免费放行） |
| `accepts` | 多链多资产；每项二选一：`eip3009: { name, version }` 或 `permit2: true` |
| `exempt` | 免费路径前缀（默认已含 `/health`、`/metrics`） |
| `passthroughHeaders` | 额外视为「已有平台凭证」的头（如 `x-tenant-id`） |
| `resource` | 写进 402 `resource` 的服务元数据：`description` / `mimeType` / `serviceName` / `tags` / `iconUrl`（目录与 agent 读取） |
| `bazaar` | Bazaar 扩展 `{ info, schema? }`；facilitator 据此索引本资源 |
| `freeQuota` | 免费额度：`{ calls, period: 'day'\|'month', windowMs?, key?, now? }`；窗口内前 N 次直接放行（响应带 `X-Free-Quota-Remaining`），用完后转 402 |

已有平台凭证（`Authorization` / `X-API-Key` / `X-Service-Key`）的请求直接放行，
不影响原来的「人」的调用。

## 被发现 + 免费额度

```ts
const gate = createX402Gate({
  paymentsUrl: 'https://keel.codes/v1/payment',
  payTo: '0xYourReceivingAddress',
  network: 'eip155:8453',
  asset: '0x8335…2913',
  amount: '2000',
  domain: { name: 'USD Coin', version: '2' },
  // 目录/agent 从 402 里读到这些信息
  resource: {
    serviceName: 'My Tick API',
    description: 'Per-request price feed',
    mimeType: 'application/json',
    tags: ['market-data'],
  },
  bazaar: { info: { input: { type: 'http', method: 'GET' }, output: { type: 'json' } } },
  // 每 IP 每天前 100 次免费（沙箱体验），之后 402
  freeQuota: { calls: 100, period: 'day' },
})
```

- 免费额度按 `serviceName|payTo` + 调用方（缺省 `req.ip`，用 `key` 可换成 X-Forwarded-For / 租户）分桶，窗口滚动。
- `calls: 0` 表示关闭免费额度。

## 客户端怎么付

任何标准 x402 客户端都行：先发请求拿 `402 + PAYMENT-REQUIRED`，选一个 `accepts`
签名，再带 `PAYMENT-SIGNATURE` 重试。用 Keel SDK 时这一套是自动的：

> v1 客户端（`X-PAYMENT`）也兼容：网关同时读 `X-PAYMENT`，402 响应体降级为 v1 结构
> （`x402Version: 1` + `maxAmountRequired` + 短网络名 `base`），成功后额外回
> `X-PAYMENT-RESPONSE`。`PAYMENT-REQUIRED` 头始终是 v2。

```ts
import { Keel } from '@keelcodes/sdk'

const keel = new Keel({
  baseUrl: 'https://api.example', // 收费服务端（不是支付引擎）
  x402: {
    address: wallet.account.address, // viem WalletClient
    signTypedData: (typed) => wallet.signTypedData(typed),
    maxAmount: '2000', // 单笔上限（最小单位），超过直接拒付
  },
})
await keel.request('GET', '/quote') // 402 → 签名 → 重试 → 200
```

### 可运行 demo（agent 自付，零资金）

`packages/sdk/examples/agent-autopay-demo.mjs` 把上面这条链路跑通，默认**全本地、离线、不上链**：

```bash
# 在本仓根目录
pnpm --filter @keelcodes/x402-gate build && pnpm --filter @keelcodes/sdk build
node packages/sdk/examples/agent-autopay-demo.mjs
```

输出依次覆盖：免费路径放行 → 未付款拿 `402`（v1 体 + v2 `PAYMENT-REQUIRED` 头 + `links`） →
Keel 自动签名重试 `200` → 超出 `maxAmount` 时拒付。demo 内置 mock facilitator，
只验 EIP-712 签名并回一个假 `transaction`，所以**不需要真钱包余额、也不需要 gas**。

接真环境时换成真收款地址/真付款私钥/真支付引擎（此时不再起本地服务）：

```bash
PAYMENTS_URL=https://keel.codes/v1/payment \
GATE_URL=https://your-service.example \
PAYER_PRIVATE_KEY=0x... PAY_TO=0x... \
node examples/agent-autopay-demo.mjs
```

demo 只演示 EIP-3009 轨（Base USDC）；BSC USDT/USDC 走 Permit2 时，同一份代码由 SDK
自动改签 Permit2（`extra.assetTransferMethod=permit2`），首次使用需先按
「Permit2 预算」授权一次（见下）。

### Permit2 预算（授权上限）

Permit2 轨下，付款人要先给 **canonical Permit2 合约**（不是 proxy）一笔 ERC-20 allowance，
这笔额度就是链上硬上限；`approve` 是覆盖写，撤销 = `approve(Permit2, 0)`：

```bash
cd projects/payment/payments
npx tsx scripts/permit2-budget.ts --chain bsc --budget 5        # dry-run，只打印 calldata
npx tsx scripts/permit2-budget.ts --chain bsc --budget 5 --broadcast   # 真广播
npx tsx scripts/permit2-budget.ts --chain bsc --revoke --broadcast     # 撤销
```

### per-key / per-agent 预算（可选身份头）

网关会把调用方的 `x-keel-key-id` / `x-keel-agent-id` 转发给支付引擎（裁剪 256 字符），
引擎据此把消费记到 `key:<sha256 前 16 位>` 或 `agent:<小写 id>` 主体；两者都缺省时退回按付款方地址。
运营可用 `GET/PUT /v1/payment/spend-policies[/:subject]` 为这些主体配置日限额、单次上限与收款方白名单。

> 这两个头只应由**受信服务端**设置（例如你们自己的 API 网关），不要直接透传外部用户输入，否则调用方可伪造主体。

## 状态码

| 场景 | 响应 |
|---|---|
| 未付款 | `402` + `PAYMENT-REQUIRED`（含 `accepts[]` 与 `error`） |
| 结算成功 | 原接口响应 + `PAYMENT-RESPONSE`（`transaction` / `payer` / `amount`） |
| 结算失败 | `402` + `PAYMENT-REQUIRED`（`error` 带引擎给的原因） |
| 引擎不可达 | `402`（不返回 500，客户端可重试） |
| 需要先授权 Permit2 | 引擎在 `PAYMENT-RESPONSE` 前返回 `412 PERMIT2_ALLOWANCE_REQUIRED` |

## 上架登记（市场）

B 端要让外部用户/agent 发现你的服务，需要登记 `payTo` 并证明所有权：

```bash
# 1. 取待签名内容
curl -sX POST https://keel.codes/v1/payment/market/listings/challenge \
  -H 'Content-Type: application/json' \
  -d '{"payTo":"0xB端收款地址","network":"eip155:56","asset":"0x55d3…7955","amount":"2000","method":"permit2"}'

# 2. 用 payTo 的私钥对返回的 typedData 做 EIP-712 签名，提交
curl -sX POST https://keel.codes/v1/payment/market/listings \
  -H 'Content-Type: application/json' \
  -d '{"payTo":"0x…","network":"eip155:56","asset":"0x55d3…","amount":"2000","method":"permit2","nonce":"0x…","signature":"0x…"}'
```

- 签名者必须等于 `payTo`，否则 `403 OWNERSHIP_PROOF_FAILED`（冒名无法登记）
- 默认自动通过；`review: 'manual'` 时进入 `pending`，由管理员 `POST /listings/:id/review` 放行
- 审核通过后用 `store.approvedPayTos()` 接进支付引擎：

```ts
facilitator: { allowedPayTo: () => marketplaceStore.approvedPayTos() }
```

## 安全边界

- 网关只做转发，不持私钥、不读链；被攻破也无法转走资金
- 收款地址由 B 端自己控制（或第三方白名单），平台不代收
- 结算凭证（txHash）由支付引擎返回，网关原样透传
