// ---------------------------------------------------------------------------
// @keelcodes/sdk — 公共类型（对齐 KEEL_CONTRACT_V1.md）
// ---------------------------------------------------------------------------

import type { X402PayerConfig } from './aa/x402-exact'

/** 对外四模块。 */
export type KeelModule = 'payment' | 'wallet' | 'data' | 'account'

/** 钱包签名鉴权（account/wallet 自助面需要；服务端按 EIP-191 校验）。 */
export interface KeelWalletAuth {
  /** 钱包地址（0x...） */
  address: string
  /** EIP-191 签名函数：入参为待签消息，返回签名 hex（可异步）。 */
  sign: (message: string) => Promise<string> | string
}

/** SDK 配置。 */
export interface KeelConfig {
  /** baseUrl，默认 https://keel.codes */
  baseUrl?: string
  /** Bearer API key（按模块订阅签发，`sk_<module>_*`） */
  apiKey?: string
  /** 租户级 `x-api-key`（WAAS 租户资源面：余额 / 流水 / 提现列表等）。 */
  tenantApiKey?: string
  /** 内部服务鉴权 key（`X-Service-Key`）；供网关服务级旁路放行可信内部组件（如 keel-mcp）。 */
  serviceKey?: string
  /** 请求超时（ms），默认 30000 */
  timeout?: number
  /** 钱包签名鉴权；设置后自动附加 x-wallet-address/signature/timestamp 请求头。 */
  wallet?: KeelWalletAuth
  /**
   * x402 自动付款：收到 402 + `PAYMENT-REQUIRED` 时，用该钱包签一份 EIP-3009
   * 授权（`exact`）并原样重试一次请求。只签名不广播，无需原生 gas。
   */
  x402?: X402PayerConfig
}

/** 统一信封（WAAS / MPC / Vault / aa-relay / data 自助面 2xx 响应）。 */
export interface KeelEnvelope<T> {
  code: number | string
  message: string
  data: T
}

/** 统一错误体（契约 §3）。 */
export interface KeelErrorBody {
  code: string
  message: string
  details?: Record<string, unknown>
}

/** 幂等键：写操作由调用方生成，相同 reference 不重复入账/扣费。 */
export type Reference = string
