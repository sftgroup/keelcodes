// ---------------------------------------------------------------------------
// @keelcodes/sdk — payment 模块（7 动作）
// ---------------------------------------------------------------------------

import { HttpClient } from './http'
import type { Reference, KeelWalletAuth } from './types'

export interface ChargeParams {
  payer: string
  amountWei: string
  /** 收费 rail（内部路由，对外仅暴露语义）。 */
  method: 'x402' | 'a2a' | 'batch' | 'invite'
  asset?: string
  chain?: string
  reference: Reference
  metadata?: Record<string, unknown>
}

/** 链上收费返回收款地址 / 价格 / 网络。 */
export type ChargeResult = { reference: string; payTo: string; priceWei: string; network: string }

export interface PayParams {
  payee: string
  amountWei: string
  asset?: string
  reference: Reference
  metadata?: Record<string, unknown>
}

export interface PayResult {
  reference: string
  settled: boolean
  transferId: string
}

/** x402 v2 支付凭证校验结果（规范 §5.4 VerifyResponse）。 */
export interface X402VerifyResult {
  isValid: boolean
  invalidReason?: string
  payer?: string
}

/** x402 v2 `PaymentRequirements`（PaymentRequired.accepts 单项）。 */
export interface X402PaymentRequirements {
  scheme: 'exact' | 'upto'
  network: string
  asset: string
  payTo: string
  amount: string
  maxTimeoutSeconds?: number
  extra?: Record<string, unknown>
}

/** x402 v2 facilitator 发现（规范 §7.3）。 */
export interface X402Supported {
  kinds: Array<{
    x402Version: 2
    scheme: 'exact' | 'upto'
    network: string
    /** 以下字段仅 `exact` + EIP-3009 币才有（客户端据此判断可付性）。 */
    asset?: string
    symbol?: string
    decimals?: number
    extra?: { name: string; version: string }
  }>
}

/** x402 v2 SettleResponse（规范 §7.2）：facilitator 代为广播后的回执。 */
export interface X402SettleResult {
  success: boolean
  /** 结算交易哈希（成功时）。 */
  transaction?: string
  network?: string
  payer?: string
  /** 实际结算金额（代币最小单位，十进制字符串）。 */
  amount?: string
  errorReason?: string
}

export interface BalanceResult {
  address: string
  balanceWei: string
}

export interface PaymentOrder {
  intentId: string
  method: string
  subscriber: string | null
  asset: string | null
  amountWei: string | null
  status: string
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface OrdersParams {
  limit?: number
  offset?: number
  status?: string
  subscriber?: string
}

export interface OrdersResult {
  orders: PaymentOrder[]
}

/** 单笔结算可核验读取（PC-4）。 */
export interface SettlementRecord {
  reference: string
  payer: string
  amountWei: string
  asset: string
  chainId: number
  method?: string
  settledAt: string
  metadata?: Record<string, unknown>
}

/** 402 待付款结构化（PC-3）。 */
export interface PaymentRequiredBody {
  priceWei: string
  payTo: string
  resource: string
  resumeRef: string
  mode: 'topup' | 'subscribe'
  network: string
  asset: string
}

// ── 代播费（settle-fees）自助面：余额查询 / 自助充值 ──
// 服务端契约见 payments `self-topup.ts`：两个端点免平台 key，但都要求
// payTo 私钥对**可读消息**做 EIP-191 签名（防止地址枚举 / 抢注他人 tx）。

/** 代播费余额（6 位微单位，0.1 USDC = `100000`）。 */
export interface SettleFeeBalanceResult {
  payTo: string
  balanceMicro: string
}

export interface SettleFeeBalanceParams {
  /** 收款地址（即上架时登记的 payTo）。 */
  payTo: string
  /** 已签好的签名；缺省用 `KeelConfig.wallet` 自动签。 */
  signature?: string
}

export interface SettleFeeTopupParams {
  payTo: string
  /** 链槽名（小写，如 `base` / `bsc`）。 */
  chain: string
  /** 已上链的充值交易哈希（转账收款方必须是该链平台 collector）。 */
  txHash: string
  /** 已签好的签名；缺省用 `KeelConfig.wallet` 自动签。 */
  signature?: string
}

export interface SettleFeeTopupResult {
  payTo: string
  chain: string
  txHash: string
  /** 本次入账额（6 位微单位）。 */
  creditedMicro: string
  /** 入账后余额（6 位微单位）。 */
  balanceMicro: string
}

/** 余额查询待签消息（服务端 `keel-settle-balance:<payTo>`，全小写）。 */
export function settleFeesBalanceMessage(payTo: string): string {
  return `keel-settle-balance:${payTo.toLowerCase()}`
}

/** 自助充值待签消息（服务端 `keel-settle-topup:<chain>:<txHash>:<payTo>`，全小写）。 */
export function settleFeesTopupMessage(args: { chain: string; txHash: string; payTo: string }): string {
  return `keel-settle-topup:${args.chain.toLowerCase()}:${args.txHash.toLowerCase()}:${args.payTo.toLowerCase()}`
}

export class PaymentAPI {
  constructor(private http: HttpClient, private wallet?: KeelWalletAuth) {}

  /** 发起收费（内部路由 x402/a2a/batch/invite）。 */
  charge(params: ChargeParams): Promise<ChargeResult> {
    return this.http.post<ChargeResult>('/v1/payment/charge', params)
  }

  /** 主动付费。 */
  pay(params: PayParams): Promise<PayResult> {
    return this.http.post<PayResult>('/v1/payment/pay', params)
  }

  /** 校验 x402 v2 支付凭证（base64 PAYMENT-SIGNATURE）——facilitator verify。 */
  verifyPayment(paymentPayload: string, paymentRequirements?: X402PaymentRequirements): Promise<X402VerifyResult> {
    return this.http.post<X402VerifyResult>('/v1/payment/x402/verify', { x402Version: 2, paymentPayload, paymentRequirements })
  }

  /**
   * 结算 x402 v2 支付凭证（facilitator settle）：标准 `exact`（EIP-3009）由
   * facilitator 代为广播，客户端无需持原生 gas。
   * @param paymentPayload base64 `PAYMENT-SIGNATURE`（或 `signX402Exact` 返回的 `header`）
   * @param paymentRequirements 402 挑战里的 accept（标准 exact 必传，资产与金额以它为准）
   */
  settle(paymentPayload: string, paymentRequirements?: X402PaymentRequirements): Promise<X402SettleResult> {
    return this.http.post<X402SettleResult>('/v1/payment/x402/settle', { x402Version: 2, paymentPayload, paymentRequirements })
  }

  /** x402 v2 facilitator 发现（支持的 scheme / network）。 */
  supported(): Promise<X402Supported> {
    return this.http.get<X402Supported>('/v1/payment/x402/supported')
  }

  /**
   * 查询 payTo 的代播费余额（免平台 key）。
   * 未传 `signature` 时用 `KeelConfig.wallet` 签 `settleFeesBalanceMessage(payTo)`。
   */
  async settleFeesBalance(params: SettleFeeBalanceParams): Promise<SettleFeeBalanceResult> {
    const payTo = params.payTo.toLowerCase()
    const signature = params.signature ?? (await this.signSettleFees(payTo, settleFeesBalanceMessage(payTo)))
    return this.http.post<SettleFeeBalanceResult>('/v1/payment/x402/settle-fees/balance', { payTo, signature })
  }

  /**
   * 自助充值：凭「payTo 签名 + 已上链的 txHash」把代播费记入余额（免平台 key）。
   * 链上转账的收款方必须是该链平台 collector，精度由服务端换算成 6 位微单位。
   * 未传 `signature` 时用 `KeelConfig.wallet` 签 `settleFeesTopupMessage(...)`。
   */
  async settleFeesTopup(params: SettleFeeTopupParams): Promise<SettleFeeTopupResult> {
    const payTo = params.payTo.toLowerCase()
    const chain = params.chain.toLowerCase()
    const txHash = params.txHash.toLowerCase()
    const signature =
      params.signature ?? (await this.signSettleFees(payTo, settleFeesTopupMessage({ chain, txHash, payTo })))
    return this.http.post<SettleFeeTopupResult>('/v1/payment/x402/settle-fees/self-topup', {
      payTo,
      chain,
      txHash,
      signature,
    })
  }

  /** 用配置的钱包签 settle-fees 消息；签名地址必须就是 payTo（服务端按它验签）。 */
  private async signSettleFees(payTo: string, message: string): Promise<string> {
    if (!this.wallet) {
      throw new Error(
        '[keel-sdk] settle-fees needs a signature: pass `signature` or configure KeelConfig.wallet',
      )
    }
    if (this.wallet.address.toLowerCase() !== payTo) {
      throw new Error(
        `[keel-sdk] settle-fees signature must come from payTo (wallet=${this.wallet.address}, payTo=${payTo})`,
      )
    }
    return this.wallet.sign(message)
  }

  /** 查余额。 */
  balance(address: string, asset?: string): Promise<BalanceResult> {
    const q = new URLSearchParams({ address })
    if (asset) q.set('asset', asset)
    return this.http.get<BalanceResult>('/v1/payment/balance?' + q.toString())
  }

  /** 查交易记录。 */
  orders(params: OrdersParams = {}): Promise<OrdersResult> {
    const q = new URLSearchParams()
    if (params.limit !== undefined) q.set('limit', String(params.limit))
    if (params.offset !== undefined) q.set('offset', String(params.offset))
    if (params.status !== undefined) q.set('status', params.status)
    if (params.subscriber !== undefined) q.set('subscriber', params.subscriber)
    const qs = q.toString()
    return this.http.get<OrdersResult>('/v1/payment/orders' + (qs ? '?' + qs : ''))
  }

  /** 核验单笔结算（按幂等键 reference）。 */
  settlement(reference: Reference): Promise<SettlementRecord> {
    return this.http.get<SettlementRecord>('/v1/payment/settlement/' + encodeURIComponent(reference))
  }

  /** 访问判定/按次扣费（返回 active，或 402 抛 KeelApiError）。 */
  access(subscriber: string, resource: unknown): Promise<{ active: boolean }> {
    return this.http.post<{ active: boolean }>('/v1/payment/access', { subscriber, resource })
  }

  /** 按量套餐价目（公开；canonical `/v1/payment/plans`，由 mpc 承载）。 */
  plans(): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/payment/plans')
  }

  /** 预付费账本余额（canonical `/v1/payment/ledger-balance`，由 mpc 承载）。 */
  ledgerBalance(params: { token: string }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/ledger-balance', params)
  }

  // ── 旧 index MCP 能力补齐：通道发现 / 链上意图 / 批量 / 邀请 / 转账 ──

  /** 支付通道发现：启用的 rail、各链收款钱包 / 价格 / 托管、各链可接受的稳定币。 */
  info(chain?: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/payment/info' + (chain ? '?chain=' + encodeURIComponent(chain) : ''))
  }

  /** 读取链上订阅详情（active / payToken / amountPaid / 周期 / 试用）。 */
  subscriptionDetail(chain: string, subscriber: string, resourceId: number): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(
      '/v1/payment/subscription-detail/' + encodeURIComponent(chain) + '/' + encodeURIComponent(subscriber) + '/' + encodeURIComponent(String(resourceId)),
    )
  }

  /** 读取链上套餐定价（price / period / active）。 */
  price(planId: number, chain?: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(
      '/v1/payment/price?chain=' + encodeURIComponent(chain || 'bsc') + '&planId=' + encodeURIComponent(String(planId)),
    )
  }

  /**
   * 创建 a2a 支付意图（phase 1）。
   * `settlementMode: 'direct'` 时 `payee` 必填，settle 只核验 payer → payee 的链上转账。
   */
  a2aCreate(params: { subscriber: string; valueWei: string; asset?: string; chain?: string; payee?: string; settlementMode?: 'collector' | 'direct'; expiresIn?: number; metadata?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/a2a', params)
  }

  /** 确认 a2a 支付意图（phase 2）：mode=tx 校验链上交易；mode=balance 走账本扣减。 */
  a2aSettle(params: { paymentId: string; mode?: 'tx' | 'balance'; txHash?: string; chain?: string; subscriber?: string; amountWei?: string; asset?: string; ref?: string }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/a2a/settle', params)
  }

  /** 结算 direct 意图（phase 2）：按 intent 绑定的 payee/asset/精确金额核验，并按链确认数判定终局。 */
  a2aDirectSettle(paymentId: string, txHash: string): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/a2a/' + encodeURIComponent(paymentId) + '/settle', { txHash })
  }

  /** 取消未结算的 direct 意图（幂等）。 */
  a2aCancel(paymentId: string): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/a2a/' + encodeURIComponent(paymentId) + '/cancel', {})
  }

  /** 创建批量收款意图（一付款人对多收款人）。 */
  batchCreate(params: { subscriber: string; items: Array<Record<string, unknown>>; chain?: string; metadata?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/batch', params)
  }

  /** 结算批量收款中的一项（提交链上 txHash）。 */
  batchSettle(params: { batchId: string; itemId: string; txHash: string; chain?: string }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/batch/settle', params)
  }

  /** 读取批量收款状态。 */
  batchGet(batchId: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/payment/batch?batchId=' + encodeURIComponent(batchId))
  }

  /** 取消批量收款。 */
  batchCancel(batchId: string): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/batch/cancel', { batchId })
  }

  /** 创建账单邀请（payer → payee）。 */
  inviteCreate(params: { payer: string; payee: string; valueWei: string; asset?: string; chain?: string; dueAt?: string; memo?: string; metadata?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/invites', params)
  }

  /** 按地址 + 角色（payer|payee）列出邀请。 */
  inviteList(p: { address: string; role: 'payer' | 'payee'; status?: string }): Promise<Record<string, unknown>> {
    const q = new URLSearchParams({ address: p.address, role: p.role })
    if (p.status) q.set('status', p.status)
    return this.http.get<Record<string, unknown>>('/v1/payment/invites?' + q.toString())
  }

  /** 读取单个邀请详情。 */
  inviteGet(inviteId: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/payment/invites/' + encodeURIComponent(inviteId))
  }

  /** 取消未结算的邀请。 */
  inviteCancel(inviteId: string): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/invites/' + encodeURIComponent(inviteId) + '/cancel')
  }

  /** 链上结算邀请（提交 payer txHash）。 */
  inviteSettle(p: { inviteId: string; txHash: string; chain?: string }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/invites/' + encodeURIComponent(p.inviteId) + '/settle', { txHash: p.txHash, chain: p.chain })
  }

  /** 用 payer 账本余额支付邀请（无链上交易）。 */
  invitePay(inviteId: string): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/invites/' + encodeURIComponent(inviteId) + '/pay')
  }

  /** 请求一笔账本内转账（from → to）。 */
  transferCreate(params: { from: string; to: string; valueWei: string; asset?: string; reference?: string; metadata?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/transfers', params)
  }

  /** 按地址 + 角色（from|to）列出转账。 */
  transferList(p: { address: string; role: 'from' | 'to' }): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/payment/transfers?' + new URLSearchParams({ address: p.address, role: p.role }).toString())
  }

  /** 读取单笔转账详情。 */
  transferGet(transferId: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/payment/transfers/' + encodeURIComponent(transferId))
  }

  /** 确认并原子执行转账。 */
  transferConfirm(transferId: string): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/transfers/' + encodeURIComponent(transferId) + '/confirm')
  }

  /** 取消未执行的转账。 */
  transferCancel(transferId: string): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/payment/transfers/' + encodeURIComponent(transferId) + '/cancel')
  }

  /** 周期订阅扣费（基于已创建的 authorization）。 */
  period = {
    /** 扣减一个周期；返回 authorizationId 与扣费结果。 */
    charge: (authorizationId: string) =>
      this.http.post<Record<string, unknown>>('/v1/payment/period/charge', { authorizationId }),
    /** 查询周期授权状态（剩余额度 / 周期 / 状态）。 */
    authorization: (authorizationId: string) =>
      this.http.get<Record<string, unknown>>(
        '/v1/payment/period/authorization?authorizationId=' + encodeURIComponent(authorizationId),
      ),
  }

  /** 托管（escrow）链上按量计费 / 退款。 */
  escrow = {
    /** relayer 代为签名扣费：`{chain, user, amountWei, reference}`。 */
    charge: (p: { chain: string; user: string; amountWei: string; reference: string }) =>
      this.http.post<Record<string, unknown>>('/v1/payment/escrow/charge', p),
    /** relayer 代为签名退款：`{chain, user, amountWei, reference}`。 */
    refund: (p: { chain: string; user: string; amountWei: string; reference: string }) =>
      this.http.post<Record<string, unknown>>('/v1/payment/escrow/refund', p),
    /** 查询托管余额（未配置链返回 `{configured:false, balanceWei:'0'}`）。 */
    balance: (chain: string, user: string) =>
      this.http.get<Record<string, unknown>>(
        '/v1/payment/escrow/balance?' + new URLSearchParams({ chain, user }).toString(),
      ),
    /** 查询链上托管配置（地址 / 限额）。 */
    info: (chain: string) =>
      this.http.get<Record<string, unknown>>('/v1/payment/escrow/info?chain=' + encodeURIComponent(chain)),
    /** relayer gas 健康；不传 chain 返回全部已配置链。 */
    relayerStatus: (chain?: string) =>
      this.http.get<Record<string, unknown>>(
        '/v1/payment/escrow/relayer-status' + (chain ? '?chain=' + encodeURIComponent(chain) : ''),
      ),
    /** 核验 Solana 原生 SOL 充值并入账（幂等键 `sol:<signature>`）。 */
    solanaVerify: (p: { signature: string; from: string; amountLamports: string | number; waitMs?: number }) =>
      this.http.post<Record<string, unknown>>('/v1/payment/solana/verify', p),
  }
}
