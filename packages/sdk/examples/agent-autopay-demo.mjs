// ---------------------------------------------------------------------------
// B4.4 · agent 自付（x402 exact）端到端可运行 demo
// ---------------------------------------------------------------------------
// 一条命令跑完「402 → 自动签名 → 重试 → 200」，默认**全本地、离线、零资金**：
//   * 收费服务端：@keelcodes/x402-gate（withX402，Fetch 适配器）+ node:http
//   * 支付引擎：本文件内置的 mock facilitator（只验 EIP-712 签名，不上链）
//   * agent 侧：@keelcodes/sdk 的 Keel（配置 x402 后自动重试）
//
// 运行（在本仓根目录）：
//   pnpm --filter @keelcodes/x402-gate build && pnpm --filter @keelcodes/sdk build
//   node packages/sdk/examples/agent-autopay-demo.mjs
//
// 换成真环境（真收款地址 + 真付款私钥 + 真支付引擎）：
//   PAYMENTS_URL=https://keel.codes/v1/payment \
//   GATE_URL=https://your-service.example \
//   PAYER_PRIVATE_KEY=0x… PAY_TO=0x… \
//   node examples/agent-autopay-demo.mjs
//   （GATE_URL 一旦给出就不再起本地服务；PAYMENTS_URL 一旦给出就不起 mock 引擎）
// ---------------------------------------------------------------------------

import { createServer } from 'node:http'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, stringToHex, verifyTypedData } from 'viem'
import { Keel, buildX402ExactTypedData } from '../dist/index.js'
import { withX402 } from '../../x402-gate/dist/index.js'

// 公开的测试私钥（Hardhat 账户 #1 / #2），仅用于本地演示，主网切勿使用。
const DEMO_PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const DEMO_PAY_TO = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

const PRICE = '2000' // 最小单位：USDC 6 位 ⇒ 0.002
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const payer = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY ?? DEMO_PAYER_KEY)
const payTo = process.env.PAY_TO ?? DEMO_PAY_TO
const paymentsUrl = process.env.PAYMENTS_URL ?? 'http://127.0.0.1:9132'
const gateUrl = process.env.GATE_URL
const gatePort = Number(process.env.GATE_PORT ?? 8080)

const log = (msg) => console.log(msg)

// ── 收费服务端：x402 网关 + 一个收费端点 /quote ─────────────────────────────
const gateOptions = {
  paymentsUrl,
  payTo,
  amount: PRICE,
  accepts: [
    {
      network: 'eip155:8453',
      asset: BASE_USDC,
      eip3009: { name: 'USD Coin', version: '2' },
    },
  ],
  resource: {
    serviceName: 'B4.4 agent-autopay demo',
    description: 'Per-request price quote (x402 exact over EIP-3009)',
    tags: ['demo', 'market-data'],
  },
  purchaseUrl: 'https://keel.codes/pricing?module=dc&src=agent-demo',
  log: (msg) => log(`  [gate] ${msg}`),
}

const quote = withX402(gateOptions, async () =>
  Response.json({ symbol: 'BTC/USDT', price: 68000.12, ts: Date.now(), paid: true })
)

/** node:http → Fetch 适配器（演示 x402 网关与运行时无关）。 */
function toNodeHandler(port) {
  return async (req, res) => {
    const url = `http://${req.headers.host ?? `127.0.0.1:${port}`}${req.url}`
    const { pathname } = new URL(url)
    // 只有 /quote 收费；其余（/health 等）是普通免费路由，不经过网关。
    if (pathname !== '/quote') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    const response = await quote(new Request(url, { method: req.method, headers: req.headers }))
    const headers = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    res.writeHead(response.status, headers)
    res.end(Buffer.from(await response.arrayBuffer()))
  }
}

// ── mock facilitator：只做验签（真环境由支付引擎 /x402/settle 上链结算）────
function startMockFacilitator(port) {
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || !req.url.startsWith('/x402/settle')) {
      return send(404, { code: 'NOT_FOUND' })
    }
    const raw = await new Promise((resolve) => {
      let buf = ''
      req.on('data', (chunk) => (buf += chunk))
      req.on('end', () => resolve(buf))
    })
    try {
      const { paymentPayload, paymentRequirements } = JSON.parse(raw)
      const payload = JSON.parse(Buffer.from(paymentPayload, 'base64').toString('utf8'))
      const accepted = payload?.accepted
      const auth = payload?.payload?.authorization
      const signature = payload?.payload?.signature
      if (!accepted || !auth || !signature) return send(400, { success: false, errorReason: 'malformed payload' })

      const offered = (paymentRequirements?.accepts ?? []).some(
        (a) =>
          a.network === accepted.network &&
          String(a.asset).toLowerCase() === String(accepted.asset).toLowerCase() &&
          a.amount === accepted.amount &&
          String(a.payTo).toLowerCase() === String(accepted.payTo).toLowerCase()
      )
      if (!offered) return send(400, { success: false, errorReason: 'accept not offered by challenge' })
      if (!accepted.extra?.name) return send(400, { success: false, errorReason: 'not an EIP-3009 accept' })

      const nowSec = Math.floor(Date.now() / 1000)
      if (String(auth.to).toLowerCase() !== String(accepted.payTo).toLowerCase())
        return send(400, { success: false, errorReason: 'authorization.to mismatch' })
      if (auth.value !== accepted.amount) return send(400, { success: false, errorReason: 'authorization.value mismatch' })
      if (Number(auth.validBefore) <= nowSec) return send(400, { success: false, errorReason: 'authorization expired' })
      if (Number(auth.validAfter) > nowSec) return send(400, { success: false, errorReason: 'authorization not yet valid' })

      const typed = buildX402ExactTypedData(accepted, auth)
      const ok = await verifyTypedData({
        address: auth.from,
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
        signature,
      })
      if (!ok) return send(400, { success: false, errorReason: 'invalid EIP-712 signature' })

      const transaction = keccak256(stringToHex(`${auth.from}:${auth.nonce}:${Date.now()}`))
      log(`  [facilitator] 验签通过 payer=${auth.from} amount=${auth.value} (${Number(auth.value) / 1e6} USDC)`)
      return send(200, {
        success: true,
        transaction,
        network: accepted.network,
        payer: auth.from,
        amount: auth.value,
      })
    } catch (err) {
      return send(400, { success: false, errorReason: err instanceof Error ? err.message : 'bad request' })
    }
  })
  return listen(server, port)
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

const close = (server) => new Promise((resolve) => (server ? server.close(resolve) : resolve()))

// ── 主流程 ─────────────────────────────────────────────────────────────────
async function main() {
  const started = []

  if (!process.env.PAYMENTS_URL) {
    const facilitator = await startMockFacilitator(9132)
    started.push(facilitator)
    log(`[0] mock facilitator 就绪 http://127.0.0.1:9132 （只验签，不上链）`)
  } else {
    log(`[0] 使用真实支付引擎 ${paymentsUrl}`)
  }

  let base = gateUrl
  if (!gateUrl) {
    const server = await listen(createServer(toNodeHandler(gatePort)), gatePort)
    started.push(server)
    base = `http://127.0.0.1:${gatePort}`
    log(`[0] 收费服务端就绪 ${base} （payTo=${payTo}，单价 ${PRICE}）`)
  } else {
    log(`[0] 使用外部服务端 ${base}`)
  }

  try {
    // 1. 免费路径：网关直接放行
    const health = await fetch(`${base}/health`)
    log(`[1] GET /health → ${health.status} ${JSON.stringify(await health.json())}`)

    // 2. 不带付款凭证：拿到 402。响应体是 v1 降级结构，`PAYMENT-REQUIRED` 头是 v2 挑战
    const challenge = await fetch(`${base}/quote`)
    const body = await challenge.json()
    const required = JSON.parse(
      Buffer.from(challenge.headers.get('payment-required') ?? '', 'base64').toString('utf8')
    )
    log(`[2] GET /quote（无凭证）→ ${challenge.status}`)
    log(`    v1 体: x402Version=${body.x402Version} maxAmountRequired=${body.accepts?.[0]?.maxAmountRequired}`)
    log(`    v2 头: ${JSON.stringify(required.accepts?.[0] ?? {})}`)
    log(`    links: ${JSON.stringify(required.links ?? [])}`)

    // 3. agent 自付：Keel 收到 402 → 签 EIP-3009 → 原样重试（只签名，不广播）
    const agent = new Keel({
      baseUrl: base,
      x402: {
        address: payer.address,
        signTypedData: (typed) => payer.signTypedData(typed),
        network: 'eip155:8453',
        maxAmount: PRICE,
      },
    })
    const paid = await agent.request('GET', '/quote')
    log(`[3] Keel 自动付款后 GET /quote → 200`)
    log(`    ${JSON.stringify(paid)}`)

    // 4. 预算护栏：单笔上限低于报价时直接拒绝，不会发出付款
    const thrifty = new Keel({
      baseUrl: base,
      x402: {
        address: payer.address,
        signTypedData: (typed) => payer.signTypedData(typed),
        maxAmount: '1000',
      },
    })
    try {
      await thrifty.request('GET', '/quote')
      log(`[4] 预算护栏未生效（异常）`)
      process.exitCode = 1
    } catch (err) {
      log(`[4] 预算护栏生效：${err instanceof Error ? err.message : err}`)
    }

    log(`\n完成：agent 在无人值守下完成一次按次付费调用；资金从未离开付款人钱包（仅签名，settler 代播）。`)
  } finally {
    for (const server of started.reverse()) await close(server)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
