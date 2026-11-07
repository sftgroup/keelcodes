import { HttpClient } from '../http'
import type { KeelEnvelope } from '../types'
import type {
  CreateWalletParams,
  WalletCreated,
  ImportWalletParams,
  SignParams,
  SignResult,
  SendParams,
  SendResult,
  ChainParams,
  ChainResult,
  WalletBalanceParams,
  WalletBalanceResult,
  SessionCreateParams,
  SessionCreated,
  PaymasterInfo,
  PaymasterVoucherParams,
  PaymasterVoucher,
} from './types'
import type {
  SolanaDeriveAccountParams,
  SolanaDerivedAccount,
  SolanaCreateAccountParams,
  SolanaInstallPolicyParams,
  SolanaCreatePolicyTransactionParams,
  SolanaCreateProposalParams,
  SolanaApproveProposalParams,
  SolanaExecutePolicyTransactionParams,
  SolanaRemovePolicyParams,
} from './solana-account-types'
import type {
  SolanaExecutePolicyPayloadParams,
  SolanaCloseSettingsParams,
  SolanaCloseTransactionParams,
  SolanaExecutePolicyParams,
  SolanaExecuteParams,
  SolanaRemoveSignerParams,
  SolanaSubmitParams,
  SolanaUnsignedTransaction,
  SolanaSubmitResult,
} from './solana-execution-types'
import type {
  SolanaDexQuoteParams,
  SolanaDexQuoteResult,
  SolanaDexPolicyParams,
  SolanaDexInstallResult,
  SolanaDexSwapParams,
  SolanaDexSwapResult,
  SolanaDexSwapAndSubmitParams,
  SolanaDexSwapAndSubmitResult,
} from './solana-dex-types'
import type {
  MpcSendCodeParams,
  MpcVerifyParams,
  MpcBalanceParams,
  MpcSignMessageParams,
  MpcSignTypedDataParams,
  MpcSendTransactionParams,
  MpcContractCallParams,
  MpcContractWriteParams,
  MpcGasEstimateParams,
  MpcRegisterParams,
  MpcRegisterResult,
  MpcSolanaSignParams,
  MpcSolanaSignResult,
  MpcSolanaSendParams,
  MpcSolanaSendResult,
} from './mpc-types'

export class WalletAPI {
  constructor(private http: HttpClient) {}

  create(params: CreateWalletParams): Promise<WalletCreated> {
    return this.http.post<WalletCreated>('/v1/wallet/create', params)
  }

  import(params: ImportWalletParams): Promise<WalletCreated> {
    return this.http.post<WalletCreated>('/v1/wallet/import', params)
  }

  sign(params: SignParams): Promise<SignResult> {
    return this.http.post<SignResult>('/v1/wallet/sign', params)
  }

  send(params: SendParams): Promise<SendResult> {
    return this.http.post<SendResult>('/v1/wallet/send', params)
  }

  /** 预估交易 gas（不耗资金）。 */
  estimateGas(params: { walletId: string; toAddress: string; amount: string; chain: string; tokenAddress?: string }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/wallet/estimate-gas', params)
  }

  /** 清空钱包原生余额到指定地址（sweep）。 */
  sweep(params: { walletId: string; toAddress: string; chain: string; paymentPassword: string }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/wallet/sweep', params)
  }

  /** 按 txHash 查交易状态（链上回执）。 */
  txStatus(txHash: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/wallet/status/' + encodeURIComponent(txHash))
  }

  /** 链上读写（读 + 广播统一，走 chain-rpc 聚合层）。 */
  chain(params: ChainParams): Promise<ChainResult> {
    return this.http.post<ChainResult>('/v1/wallet/chain', params)
  }

  balance(params: WalletBalanceParams): Promise<WalletBalanceResult> {
    const q = new URLSearchParams({ address: params.address })
    if (params.chain) q.set('chain', params.chain)
    if (params.token) q.set('token', params.token)
    return this.http.get<WalletBalanceResult>('/v1/wallet/balance?' + q.toString())
  }

  /** 查询当前钱包在指定链的充值地址。 */
  address(chain: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/wallet/address?chain=' + encodeURIComponent(chain))
  }

  /** 交易流水（托管查库；`nc=true` 时直接扫链）。 */
  transactions(p: { page?: number; limit?: number; chain?: string; type?: string; nc?: boolean } = {}): Promise<Record<string, unknown>> {
    const q = new URLSearchParams()
    if (p.page) q.set('page', String(p.page))
    if (p.limit) q.set('limit', String(p.limit))
    if (p.chain) q.set('chain', p.chain)
    if (p.type) q.set('type', p.type)
    if (p.nc) q.set('nc', 'true')
    const qs = q.toString()
    return this.http.get<Record<string, unknown>>('/v1/wallet/transactions' + (qs ? '?' + qs : ''))
  }

  /** 批量转账（需 admin 权限，B 端钱包签名不可用；建议用 `request` 直连或逐笔 `send`）。 */
  batch(p: { walletId: string; transfers: Array<{ to: string; amount: string }>; paymentPassword: string }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/wallet/batch', p)
  }

  /** 查询批量转账进度。 */
  batchProgress(batchId: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/wallet/batch/' + encodeURIComponent(batchId) + '/progress')
  }

  /** Chain-RPC 子域：池状态 / 读套餐订阅面（canonical `/v1/wallet/chain/*`）。 */
  chainRpc = {
    /** chain-rpc 网关池状态（各链健康 / 活跃端点，脱敏）。 */
    status: () => this.http.get('/v1/wallet/chain/status'),
    /** chain-rpc 网关健康检查。 */
    health: () => this.http.get('/v1/wallet/chain/health'),
    /** RPC 读套餐订阅面。 */
    subscription: {
      /** 套餐目录 + 完整链表（公开，无需 key）。 */
      plans: () => this.http.get('/v1/wallet/chain/subscription/plans'),
      /** 发起订阅支付（rx_ key 鉴权）：免费即时激活，付费返回支付意图。 */
      checkout: (p: { rpcKey: string; planId: string; rail?: string; subscriber?: string }) =>
        this.http.post(
          '/v1/wallet/chain/subscription/checkout',
          { plan_id: p.planId, rail: p.rail, subscriber: p.subscriber },
          { 'x-rpc-key': p.rpcKey },
        ),
      /** 轮询订阅支付状态（chain rail 链上确认）。 */
      paymentCheck: (p: { rpcKey: string; subscriber?: string }) =>
        this.http.post(
          '/v1/wallet/chain/subscription/payment-check',
          { subscriber: p.subscriber },
          { 'x-rpc-key': p.rpcKey },
        ),
      /** 确认 x402 rail 支付（提交 base64 PAYMENT-SIGNATURE）以激活订阅。 */
      verify: (p: { rpcKey: string; paymentSignature: string }) =>
        this.http.post(
          '/v1/wallet/chain/subscription/verify',
          { paymentSignature: p.paymentSignature },
          { 'x-rpc-key': p.rpcKey },
        ),
      /** 查询订阅用量（套餐 / 月配额 / 当前用量 / 日聚合）。 */
      usage: (rpcKey: string) =>
        this.http.get('/v1/wallet/chain/subscription/usage', { 'x-rpc-key': rpcKey }),
    },
  }

  safe = {
    /** Vault 概览：Safe 总数 / 待签 / 启用风控规则数。 */
    dashboard: () => this.http.get('/v1/wallet/safe/dashboard'),
    /** 列出多签 Safe（按 userId 过滤）。 */
    list: (userId?: string) =>
      this.http.get('/v1/wallet/safe/list' + (userId ? '?userId=' + encodeURIComponent(userId) : '')),
    /** 单个 Safe 详情（含交易历史）。 */
    info: (address: string) => this.http.get('/v1/wallet/safe/' + encodeURIComponent(address)),
    /** 创建并链上部署多签 Safe。 */
    create: (p: { chainId: string; owners: string[]; threshold: number; name?: string; userId?: string }) =>
      this.http.post('/v1/wallet/safe/create', p),
    propose: (p: { safeAddress: string; to: string; value?: string; data?: string }) =>
      this.http.post('/v1/wallet/safe/propose', p),
    confirm: (p: { safeAddress: string; safeTxHash: string; signature: string }) =>
      this.http.post('/v1/wallet/safe/confirm', p),
    execute: (p: { safeTxHash: string }) => this.http.post('/v1/wallet/safe/execute', p),
    /** 更新 owner 集合与阈值（走链上多签提案）。 */
    updateOwners: (address: string, p: { owners: string[]; threshold: number; signature?: string; userId?: string }) =>
      this.http.put('/v1/wallet/safe/' + encodeURIComponent(address) + '/owners', p),
    /** 重试待部署 Safe（可按 chainId）。 */
    retry: (chainId?: string) => this.http.post('/v1/wallet/safe/retry', { chainId }),
    /** 执行所有已达阈值的交易。 */
    executeReady: (safeAddress?: string) => this.http.post('/v1/wallet/safe/execute-ready', { safeAddress }),
    /** 同步 Safe 链上状态到库。 */
    sync: (safeAddress: string) => this.http.post('/v1/wallet/safe/sync', { safeAddress }),
    /** Safe 状态（enabled / count）。 */
    status: (walletAddress?: string) =>
      this.http.get('/v1/wallet/safe/status' + (walletAddress ? '?walletAddress=' + encodeURIComponent(walletAddress) : '')),
    /** 风控检查（按链规则判定单笔是否超限）。 */
    riskCheck: (p: { amount: string; chain: string }) => this.http.post('/v1/wallet/safe/risk/check', p),
  }

  session = {
    /** 创建链上 session；传 `signer` 为客户自持 session key（relay 不生成、不落库私钥）。 */
    create: (p: SessionCreateParams) =>
      this.http.post<KeelEnvelope<SessionCreated>>('/v1/wallet/session/create', p),
    revoke: (sessionId: string) => this.http.post('/v1/wallet/session/revoke', { sessionId }),
    execute: (p: Record<string, unknown>) => this.http.post('/v1/wallet/session/execute', p),
    /**
     * KeelTokenPaymaster：gas 由 paymaster deposit 垫付，账户以稳定币结算（零 native）。
     * `info` 用于发现配置；`voucher` 赞助「首笔 approve」（解决 allowance 循环依赖）。
     */
    paymaster: {
      info: () => this.http.get<KeelEnvelope<PaymasterInfo>>('/v1/wallet/session/paymaster/info'),
      voucher: (p: PaymasterVoucherParams) =>
        this.http.post<KeelEnvelope<PaymasterVoucher>>('/v1/wallet/session/paymaster/voucher', p),
    },
    /** Solana（Squads Smart Account）：构建未签名交易 + 广播已签名交易。 */
    solana: {
      deriveAccount: (p: SolanaDeriveAccountParams) =>
        this.http.post<SolanaDerivedAccount>('/v1/wallet/session/solana/account/derive', p),
      createAccount: (p: SolanaCreateAccountParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/account/create', p),
      installPolicy: (p: SolanaInstallPolicyParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/policy', p),
      executePolicy: (p: SolanaExecutePolicyParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/policy/execute', p),
      /** 新口径：创建 spending limit policy 交易（待多签审批）。 */
      createPolicyTransaction: (p: SolanaCreatePolicyTransactionParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/policy/create-transaction', p),
      /** settings / policy 交易提案：创建。 */
      createProposal: (p: SolanaCreateProposalParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/proposal', p),
      /** settings / policy 交易提案：审批（threshold 达成即 Approved）。 */
      approveProposal: (p: SolanaApproveProposalParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/proposal/approve', p),
      /** 新口径：异步执行已批准的 policy 交易。 */
      executePolicyTransaction: (p: SolanaExecutePolicyTransactionParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/policy/execute-transaction', p),
      /** 新口径：删除 policy（PolicyRemove）并回收其 rent。 */
      removePolicy: (p: SolanaRemovePolicyParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/policy/remove', p),
      /** 新口径：同步执行 spending limit policy。 */
      executePolicyPayload: (p: SolanaExecutePolicyPayloadParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/policy/execute-payload', p),
      /** 关闭废弃 settings 交易并回收 rent。 */
      closeSettings: (p: SolanaCloseSettingsParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/settings/close', p),
      /** 关闭 policy 交易并回收 transaction/proposal rent。 */
      closeTransaction: (p: SolanaCloseTransactionParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/policy/close-transaction', p),
      execute: (p: SolanaExecuteParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/execute', p),
      removeSigner: (p: SolanaRemoveSignerParams) =>
        this.http.post<SolanaUnsignedTransaction>('/v1/wallet/session/solana/session/remove-signer', p),
      submit: (p: SolanaSubmitParams) =>
        this.http.post<SolanaSubmitResult>('/v1/wallet/session/solana/submit', p),
      /** DEX：Jupiter 报价（只读，不构建交易）。 */
      dexQuote: (p: SolanaDexQuoteParams) =>
        this.http.post<SolanaDexQuoteResult>('/v1/wallet/session/solana/dex/quote', p),
      /** DEX：一站式 policy 安装——返回四笔未签名交易，按 `steps` 顺序本地签名广播。 */
      dexInstallPolicy: (p: SolanaDexPolicyParams) =>
        this.http.post<SolanaDexInstallResult>('/v1/wallet/session/solana/dex/install', p),
      /** DEX：组装 ProgramInteraction swap 交易（未签名；签名后经 `submit` 广播并计费）。 */
      dexSwap: (p: SolanaDexSwapParams) => buildDexSwapRequest(this.http, p),
      /**
       * DEX：一步完成 swap —— 取未签名交易 → `sign` 回调本地签名 → 经 `/submit` 广播。
       * `sign` 由调用方提供（SDK 不内置 Solana 依赖），例如：
       * `(b64) => { const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64')); tx.sign([kp]); return Buffer.from(tx.serialize()).toString('base64') }`
       */
      dexSwapAndSubmit: async (
        p: SolanaDexSwapAndSubmitParams,
      ): Promise<SolanaDexSwapAndSubmitResult> => {
        const { sign, payer, ...swap } = p
        const built = await buildDexSwapRequest(this.http, swap)
        const signed = await sign(built.transaction, [...new Set([swap.feePayer, swap.sessionKey])])
        const submit = await this.http.post<SolanaSubmitResult>(
          '/v1/wallet/session/solana/submit',
          {
            chain: swap.chain,
            transaction: signed,
            ...(payer ? { payer } : {}),
            // 同交易扣费：把构建时签发的凭证一并交给 /submit，避免账本重复扣费
            ...(built.feeProof ? { feeProof: built.feeProof } : {}),
          },
        )
        return { ...built, submit }
      },
    },
  }

  /** MPC（email 分片钱包）子域：canonical `/v1/wallet/mpc/*`。 */
  mpc = {
    sendCode: (p: MpcSendCodeParams) => this.http.post('/v1/wallet/mpc/send-code', p),
    register: (p: MpcRegisterParams) =>
      this.http.post<KeelEnvelope<MpcRegisterResult>>('/v1/wallet/mpc/register', p),
    recover: (p: MpcVerifyParams) => this.http.post('/v1/wallet/mpc/recover', p),
    status: (email: string) => this.http.get('/v1/wallet/mpc/status?email=' + encodeURIComponent(email)),
    wallets: (email?: string) =>
      this.http.get('/v1/wallet/mpc/wallets' + (email ? '?email=' + encodeURIComponent(email) : '')),
    sessionUnlock: (p: MpcVerifyParams) => this.http.post('/v1/wallet/mpc/session/unlock', p),
    sessionLock: (p: { token: string }) => this.http.post('/v1/wallet/mpc/session/lock', p),
    sessionStatus: (token: string) =>
      this.http.get('/v1/wallet/mpc/session/status?token=' + encodeURIComponent(token)),
    balance: (p: MpcBalanceParams) => this.http.post('/v1/wallet/mpc/balance', p),
    signMessage: (p: MpcSignMessageParams) => this.http.post('/v1/wallet/mpc/sign-message', p),
    signTypedData: (p: MpcSignTypedDataParams) => this.http.post('/v1/wallet/mpc/sign-typed-data', p),
    sendTransaction: (p: MpcSendTransactionParams) => this.http.post('/v1/wallet/mpc/send-transaction', p),
    contractRead: (p: MpcContractCallParams) => this.http.post('/v1/wallet/mpc/contract-read', p),
    contractWrite: (p: MpcContractWriteParams) => this.http.post('/v1/wallet/mpc/contract-write', p),
    gasEstimate: (p: MpcGasEstimateParams) => this.http.post('/v1/wallet/mpc/gas-estimate', p),

    // ── Solana（Ed25519 / FROST 2-of-3）──────────────────────────────────
    /**
     * 签 Solana 交易 message **原文**（hex，可带 0x）。
     * ⚠️ 不能传 32B 摘要：Solana 只认对原文的 Ed25519 签名（Ed25519ph 不被支持）。
     * 返回 64B `R‖z`（128 hex，**无 0x**），无 `v` 恢复 id，用 `publicKey` 对账。
     */
    signSolana: (p: MpcSolanaSignParams) =>
      this.http.post<KeelEnvelope<MpcSolanaSignResult>>('/v1/wallet/mpc/solana/sign', p),
    /** 广播 base64 编码的**已签名**交易（经 chain-rpc `sendTransaction` + `getSignatureStatuses`）。 */
    sendSolanaTransaction: (p: MpcSolanaSendParams) =>
      this.http.post<KeelEnvelope<MpcSolanaSendResult>>('/v1/wallet/mpc/solana/send-transaction', p),
  }
}

/**
 * `/dex/swap` 的请求构造（2026-10-24）：
 *   - 给了 `dexProvider`：本地取价取指令 → 以 `provider: 'external'` 交给 relay；
 *   - 只给了 `swapInstructions`（B 端自己取）：直接透传为 external；
 *   - 都没给：原样发给 relay，由 relay 调内置 Jupiter（默认行为）。
 */
async function buildDexSwapRequest(
  http: HttpClient,
  p: SolanaDexSwapParams,
): Promise<SolanaDexSwapResult> {
  const { dexProvider, quote, swapInstructions, addressLookupTableAddresses, ...plain } = p

  if (!dexProvider) {
    const payload = {
      ...plain,
      ...(swapInstructions ? { provider: 'external', swapInstructions } : {}),
      ...(quote ? { quote } : {}),
      ...(addressLookupTableAddresses?.length ? { addressLookupTableAddresses } : {}),
    }
    return http.post<SolanaDexSwapResult>('/v1/wallet/session/solana/dex/swap', payload)
  }

  const q = await dexProvider.quote(plain)
  const swap = await dexProvider.swapInstructions({
    inputMint: String(plain.inputMint),
    outputMint: String(plain.outputMint),
    amount: plain.amount,
    slippageBps: plain.slippageBps,
    userPublicKey: plain.vaultPda,
    quote: q.raw,
  })
  return http.post<SolanaDexSwapResult>('/v1/wallet/session/solana/dex/swap', {
    ...plain,
    provider: 'external',
    quote: {
      inAmount: q.inAmount,
      outAmount: q.outAmount,
      otherAmountThreshold: q.otherAmountThreshold,
      priceImpactPct: q.priceImpactPct,
      slippageBps: q.slippageBps,
    },
    swapInstructions: swap.instructions,
    ...(swap.addressLookupTableAddresses?.length
      ? { addressLookupTableAddresses: swap.addressLookupTableAddresses }
      : {}),
  })
}
