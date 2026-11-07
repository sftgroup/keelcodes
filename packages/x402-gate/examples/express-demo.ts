// ---------------------------------------------------------------------------
// 非我方代码 demo：一个只靠 `payTo + 价格` 就能收 x402 的最小服务
// ---------------------------------------------------------------------------
// 运行：
//   PAY_TO=0x… PAYMENTS_URL=https://keel.codes/v1/payment npx tsx examples/express-demo.ts
// 然后用任意标准 x402 客户端（或 keel-sdk 的 http 自动重试）访问：
//   curl -i http://127.0.0.1:8080/quote
// ---------------------------------------------------------------------------

import express from 'express'
import { createX402Gate } from '../src'

const PORT = Number(process.env.PORT ?? 8080)
const PAY_TO = process.env.PAY_TO
const PAYMENTS_URL = process.env.PAYMENTS_URL ?? 'http://127.0.0.1:9132'
const PAYMENTS_KEY = process.env.PAYMENTS_KEY

if (!PAY_TO) {
  console.error('PAY_TO is required (the address that receives the payment)')
  process.exit(1)
}

const app = express()
app.use(express.json())

const gate = createX402Gate({
  paymentsUrl: PAYMENTS_URL,
  paymentsKey: PAYMENTS_KEY,
  payTo: PAY_TO,
  amount: '2000', // 0.002（6 位）或等值最小单位
  // 同时给出两条轨：Base USDC 走 EIP-3009，BSC 的 USDT/USDC 走 Permit2。
  accepts: [
    {
      network: 'eip155:8453',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      eip3009: { name: 'USD Coin', version: '2' },
    },
    {
      network: 'eip155:56',
      asset: '0x55d398326f99059fF775485246999027B3197955',
      permit2: true,
    },
  ],
  exempt: ['/health'],
  log: (msg) => console.log(msg),
})

// 付费接口：没有 PAYMENT-SIGNATURE 会拿到 402 + PAYMENT-REQUIRED
app.get('/quote', gate, (_req, res) => {
  res.json({ symbol: 'BTC/USDT', price: 68000.12, ts: Date.now() })
})

// 免费接口
app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`demo listening on http://127.0.0.1:${PORT} (payTo ${PAY_TO})`)
})
