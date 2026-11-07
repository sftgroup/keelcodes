// ---------------------------------------------------------------------------
// @keelcodes/sdk — HTTP 客户端（统一 Bearer key + 钱包签名 + 错误分级）
// ---------------------------------------------------------------------------

import type { KeelConfig, KeelWalletAuth } from './types'
import type { X402PayerConfig, X402ExactTypedData } from './aa/x402-exact'
import { findExactAccept, signX402Exact } from './aa/x402-exact'
import type { X402Permit2TypedData } from './aa/x402-permit2'
import { findPermit2Accept, signX402Permit2 } from './aa/x402-permit2'
import { payX402Permit2WithSession } from './aa/x402-permit2-session'
import { decodePaymentRequired } from './aa/x402'
import type { X402PaymentRequired } from './aa/x402'
import { KeelApiError } from './errors'
import type { Address } from 'viem'

/**
 * SDK 版本（契约 §5）：直接读包版本，避免与 `package.json` 漂移
 *（此前写死 2.8.0，而包已发到 2.9.0，导致 `X-Keel-Version` 头长期偏低）。
 * dist/http.js 的上一级即包根，发布包始终带 package.json。
 */
declare const require: (id: string) => { version: string }
export const SDK_VERSION: string = require('../package.json').version

/**
 * 钱包签名的复用时长（ms）：首次签名后在该窗口内复用，避免每个请求都触发钱包弹窗。
 * 服务端会话 TTL 为 24h，此处取 1h 留足余量。
 */
const WALLET_TOKEN_TTL_MS = 60 * 60 * 1000

export class HttpClient {
  private baseUrl: string
  private headers: Record<string, string>
  private timeout: number
  private wallet?: KeelWalletAuth
  private x402?: X402PayerConfig
  private walletToken?: { ts: number; headers: Record<string, string> }

  constructor(config: KeelConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'https://keel.codes').replace(/\/+$/, '')
    this.timeout = config.timeout ?? 30000
    this.headers = { 'Content-Type': 'application/json', 'X-Keel-Version': SDK_VERSION }
    if (config.apiKey) this.headers['Authorization'] = `Bearer ${config.apiKey}`
    if (config.tenantApiKey) this.headers['x-api-key'] = config.tenantApiKey
    if (config.serviceKey) this.headers['X-Service-Key'] = config.serviceKey
    if (config.wallet) this.wallet = config.wallet
    if (config.x402) this.x402 = config.x402
  }

  async get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, undefined, headers)
  }

  async post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, body, headers)
  }

  async put<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('PUT', path, body, headers)
  }

  delete<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('DELETE', path, body, headers)
  }

  /**
   * 发起 SSE / 流式 GET，返回原始 `Response`（不解析 JSON、不设超时）。
   * 调用方自行消费 `res.body`；非 2xx 仍抛 `KeelApiError`。
   */
  async stream(path: string, headers?: Record<string, string>): Promise<Response> {
    const res = await fetch(this.baseUrl + path, {
      method: 'GET',
      headers: { ...(await this.buildHeaders()), ...headers },
    })
    if (res.status < 200 || res.status >= 300) {
      const json = await res.json().catch(() => ({}))
      throw new KeelApiError(path, res.status, (json as any)?.code ?? 'INTERNAL', json)
    }
    return res
  }

  async request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const headers = { ...(await this.buildHeaders()), ...extraHeaders }
    let res = await this.send(method, path, body, headers)
    let json: any = await res.json().catch(() => ({}))

    // 402 → 若配置了 x402 付款钱包，签一份标准 exact 授权并原样重试（仅一次）。
    // 优先 EIP-3009（`extra.name`）；否则 Permit2（BSC USDT/USDC 等）：
    //   * 配了 `sessionPayer` ⇒ 账户自己发 UserOp 结算（B19.6），载荷带 txHash
    //   * 否则仍是「只签名，由服务端 settler 代播」
    if (res.status === 402 && this.x402) {
      const challenge = this.challengeOf(res, json)
      const exact = challenge
        ? findExactAccept(challenge, { network: this.x402.network, asset: this.x402.asset })
        : null
      const permit2 =
        !exact && challenge
          ? findPermit2Accept(challenge, { network: this.x402.network, asset: this.x402.asset })
          : null
      if (exact || permit2) {
        const amount = exact?.amount ?? permit2!.amount
        if (this.x402.maxAmount && BigInt(amount) > BigInt(this.x402.maxAmount)) {
          throw new Error(`[keel-sdk] x402 amount ${amount} exceeds maxAmount ${this.x402.maxAmount}`)
        }
        let header: string
        let usedEoaFallback = false
        if (exact) {
          ;({ header } = await signX402Exact({
            accept: exact,
            from: this.x402.address,
            signTypedData: this.x402.signTypedData,
            validForSeconds: this.x402.validForSeconds,
          }))
        } else if (this.x402.sessionPayer) {
          // B19.6：账户自己发 UserOp 结算，载荷里带 txHash，服务端只核验回执
          const paid = await payX402Permit2WithSession({
            ...this.x402.sessionPayer,
            account: this.x402.address as Address,
            accept: permit2!,
            validForSeconds: this.x402.validForSeconds,
          })
          header = paid.header
        } else {
          // A9.9：只有显式允许才走 EOA 直付，否则用智能账户的 1271 签名
          usedEoaFallback = this.x402.allowEoaFallback === true
          ;({ header } = await signX402Permit2({
            accept: permit2!,
            from: this.x402.address,
            signTypedData: usedEoaFallback
              ? (typed: X402Permit2TypedData) =>
                  this.x402!.signTypedData(typed as unknown as X402ExactTypedData)
              : (this.x402.signPermit2TypedData ??
                ((typed: X402Permit2TypedData) =>
                  this.x402!.signTypedData(typed as unknown as X402ExactTypedData))),
            validForSeconds: this.x402.validForSeconds,
          }))
        }
        // 显式 EOA 路径：结算侧据此在流水标记 `fallback=eoa`（A9.9 审计口径）。
        // sessionPayer（B19.6）与 EIP-3009 都不是 EOA 直付，不能打这个标记。
        const paidHeaders = usedEoaFallback
          ? { ...headers, 'x-keel-pay-with': 'eoa' }
          : headers
        res = await this.send(method, path, body, { ...paidHeaders, 'PAYMENT-SIGNATURE': header })
        json = await res.json().catch(() => ({}))
      }
    }

    if (res.status < 200 || res.status >= 300) {
      throw new KeelApiError(path, res.status, json?.code ?? 'INTERNAL', json)
    }
    return json as T
  }

  /** 发一次请求（带超时）。 */
  private async send(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)
    try {
      return await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /** 从 402 响应里解出挑战：优先 `PAYMENT-REQUIRED` 头，其次响应体本身。 */
  private challengeOf(res: Response, body: any): X402PaymentRequired | null {
    const header = res.headers.get('payment-required')
    if (header) {
      try {
        return decodePaymentRequired(header)
      } catch {
        /* 头损坏时回落到响应体 */
      }
    }
    if (body && body.x402Version === 2 && Array.isArray(body.accepts) && body.accepts.length > 0) {
      return body as X402PaymentRequired
    }
    return null
  }

  /** 静态头 + （若配置）钱包签名头。签名按 WALLET_TOKEN_TTL_MS 复用。 */
  private async buildHeaders(): Promise<Record<string, string>> {
    if (!this.wallet) return this.headers
    const now = Date.now()
    if (this.walletToken && now - this.walletToken.ts < WALLET_TOKEN_TTL_MS) {
      return { ...this.headers, ...this.walletToken.headers }
    }
    const timestamp = String(now)
    const signature = await this.wallet.sign(`Keel auth: ${timestamp}`)
    const headers = {
      'x-wallet-address': this.wallet.address.toLowerCase(),
      'x-wallet-timestamp': timestamp,
      'x-wallet-signature': signature,
    }
    this.walletToken = { ts: now, headers }
    return { ...this.headers, ...headers }
  }
}
