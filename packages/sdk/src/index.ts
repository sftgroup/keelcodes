// ---------------------------------------------------------------------------
// @keelcodes/sdk — 聚合入口（单包，4 个 namespace）
// ---------------------------------------------------------------------------
// 用法：
//   import { Keel } from '@keelcodes/sdk'                 // 全家桶
//   import { PaymentAPI } from '@keelcodes/sdk/payment'    // 按域 tree-shaking
// ---------------------------------------------------------------------------

import { HttpClient } from './http'
import { PaymentAPI } from './payment'
import { WalletAPI } from './wallet'
import { DataAPI } from './data'
import { AccountAPI } from './account'
import type { KeelConfig } from './types'

export { KeelApiError, isKeelApiError } from './errors'
export { SDK_VERSION } from './http'
export type { KeelConfig, KeelModule, KeelErrorBody, KeelWalletAuth, KeelEnvelope } from './types'
export * from './aa'

export class Keel {
  readonly payment: PaymentAPI
  readonly wallet: WalletAPI
  readonly data: DataAPI
  readonly account: AccountAPI
  private readonly http: HttpClient

  constructor(config: KeelConfig = {}) {
    this.http = new HttpClient(config)
    this.payment = new PaymentAPI(this.http, config.wallet)
    this.wallet = new WalletAPI(this.http)
    this.data = new DataAPI(this.http)
    this.account = new AccountAPI(this.http)
  }

  /**
   * 通用逃生口：直接调用任意 canonical `/v1/<module>/*` 端点。
   * 与命名空间方法共用同一套鉴权头（Bearer / x-api-key / 钱包签名）。
   *
   * @example
   * const caps = await keel.request('GET', '/v1/payment/capabilities')
   * const nft = await keel.request('GET', '/v1/wallet/nfts?chain=bsc')
   */
  request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    return this.http.request<T>(method, path, body, headers)
  }
}

export default Keel
