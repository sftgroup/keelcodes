// ---------------------------------------------------------------------------
// @keelcodes/sdk — account 模块
// ---------------------------------------------------------------------------

import { HttpClient } from './http'
import type { KeelEnvelope, KeelModule } from './types'

export interface TenantCreateParams {
  name: string
  metadata?: Record<string, unknown>
}

export interface TenantResult {
  tenantId: string
  name: string
  apiKey: string
}

export interface ApikeyCreateParams {
  module: KeelModule
  /** 幂等键（同 reference 不重复签发）。必填，≤100 字符。 */
  reference: string
  /** 可选备注名。 */
  name?: string
  /** @deprecated 租户由钱包签名解析，服务端忽略该字段；保留仅为兼容旧调用。 */
  tenantId?: string
}

export interface ApikeyResult {
  /** key id（撤销 / 轮换用，非明文）。 */
  id: string
  module: KeelModule
  /** 首次签发明文；命中 reference 幂等时为 null。 */
  apiKey: string | null
  /** 掩码后的 key（幂等重放时用于识别）。 */
  apiKeyMasked?: string
  /** true 表示命中幂等，未重新签发。 */
  reused?: boolean
}

export interface SubscriptionParams {
  module: KeelModule
  planId: string
  /** 幂等键（同 reference 不重复订阅）。 */
  reference?: string
}

export interface SubscriptionResult {
  module: KeelModule
  planId: string
  status: string
}

export class AccountAPI {
  constructor(private http: HttpClient) {}

  tenant = {
    create: (p: TenantCreateParams) => this.http.post<TenantResult>('/v1/account/tenant', p),
    get: (tenantId: string) => this.http.get<TenantResult>('/v1/account/tenant/' + encodeURIComponent(tenantId)),
  }

  /** 按模块签发 key（用户订阅哪个模块，就为哪个模块签发）。 */
  apikey = {
    create: (p: ApikeyCreateParams) => this.http.post<KeelEnvelope<ApikeyResult>>('/v1/account/apikey', p),
    /** 撤销 key；`id` 为 `GET /v1/account/apikey` 返回的 key id（非明文）。 */
    revoke: (id: string) => this.http.post('/v1/account/apikey/revoke', { id }),
  }

  subscription = {
    get: (module: KeelModule) => this.http.get<SubscriptionResult>('/v1/account/subscription?module=' + module),
    subscribe: (p: SubscriptionParams) => this.http.post<SubscriptionResult>('/v1/account/subscription', p),
    cancel: (module: KeelModule) => this.http.post('/v1/account/subscription/cancel', { module }),
  }

  /** 创建提现（钱包签名；启用 TOTP 时需带 `totpCode`）。 */
  withdraw(p: { externalUserId: string; toAddress: string; amount: string; token?: string; totpCode?: string }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/account/withdraw', p)
  }

  /** 提现列表（可选 `x-api-key`；无租户上下文时返回空列表 + 热钱包概况）。 */
  withdrawals(p: { status?: string; limit?: number; offset?: number } = {}): Promise<Record<string, unknown>> {
    const q = new URLSearchParams()
    if (p.status) q.set('status', p.status)
    if (p.limit) q.set('limit', String(p.limit))
    if (p.offset) q.set('offset', String(p.offset))
    const qs = q.toString()
    return this.http.get<Record<string, unknown>>('/v1/account/withdrawals' + (qs ? '?' + qs : ''))
  }

  /** 租户余额总览（需配置 `tenantApiKey`）。 */
  balances(): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/account/balances')
  }

  /** 租户交易流水（需配置 `tenantApiKey`）。 */
  transactions(p: { limit?: number; offset?: number } = {}): Promise<Record<string, unknown>> {
    const q = new URLSearchParams()
    if (p.limit) q.set('limit', String(p.limit))
    if (p.offset) q.set('offset', String(p.offset))
    const qs = q.toString()
    return this.http.get<Record<string, unknown>>('/v1/account/transactions' + (qs ? '?' + qs : ''))
  }

  /** 租户热钱包各链原生余额（需配置 `tenantApiKey`）。 */
  hotWalletBalances(): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/account/hot-wallet/balances')
  }
}
