// ---------------------------------------------------------------------------
// @keelcodes/sdk — wallet 模块：核心类型
// ---------------------------------------------------------------------------

export type WalletType = 'waas' | 'mpc' | 'safe' | 'aa'

/**
 * 金额一律用**十进制字符串**：SOL 9 位小数、SPL 按 mint decimals、EVM 原生 18 位。
 * 不要传 JSON number，避免精度丢失。
 */
export type AmountString = string

/**
 * Solana 链标识：`solana`（别名 `sol`）；测试网 `solana-devnet`。
 *
 * 约束（与 WAAS 契约一致）：
 * - 地址是 **base58 且大小写敏感**，任何一层都不得 `toLowerCase()`；
 * - `tokenAddress` 在 Solana 上等于 **SPL mint**；
 * - 原生 SOL 传 `token: '*'` 且不传 `tokenAddress`。
 */
export type SolanaChain = 'solana' | 'sol' | 'solana-devnet'

export interface CreateWalletParams {
  type: WalletType
  chain?: string
  /** 幂等键（同 reference 不重复建钱包）。 */
  reference?: string
}

export interface ImportWalletParams {
  type: WalletType
  seed?: string
  privateKey?: string
}

export interface WalletCreated {
  walletId: string
  address: string
}

export interface SignParams {
  walletId: string
  message?: string
  typedData?: Record<string, unknown>
  digest?: string
  chain?: string
}

export interface SignResult {
  signature: string
  address: string
}

export interface SendParams {
  walletId: string
  /** 收款地址（服务端字段名）。Solana 为 base58，**大小写敏感，不得归一化**。 */
  toAddress?: string
  /** @deprecated 旧字段名，等价 `toAddress`（SDK 内部自动映射，两者只传其一）。 */
  to?: string
  amount: AmountString
  /** Solana 传 `solana`（别名 `sol`）；EVM 传链名或 chainId。 */
  chain: string
  /** Solana 上等于 SPL mint（base58，大小写敏感）；ERC-20 为合约地址。 */
  tokenAddress?: string
  /** 幂等键（防重复转账，≤100 字符）。 */
  reference?: string
  /** 资金密码（服务端必填）。 */
  paymentPassword?: string
  /** 账户启用 TOTP 后必填。 */
  totpCode?: string
}

export interface SendResult {
  txHash: string
  status: string
}

/** 估费入参（Solana 返回可精确预知的签名费与目标 ATA rent）。 */
export interface EstimateGasParams {
  walletId: string
  toAddress: string
  amount: AmountString
  chain: string
  tokenAddress?: string
}

/** 清空钱包原生余额到指定地址（sweep）。 */
export interface SweepParams {
  walletId: string
  toAddress: string
  chain: string
  paymentPassword: string
}

export interface ChainParams {
  chain: string
  method: string
  params?: unknown[]
  rawTransaction?: string
}

export interface ChainResult {
  result?: unknown
  txHash?: string
}

// ---------------------------------------------------------------------------
// aa-relay：EVM session（智能账户会话）
// ---------------------------------------------------------------------------

/** session key 托管模式：`client` = 客户自持（relay 不生成、不落库私钥）；`relay` = relay 生成并持久化。 */
export type SessionKeyCustody = 'client' | 'relay'

export interface SessionCreateParams {
  chain: string
  /** 智能账户 owner EOA 地址。 */
  owner: string
  /**
   * 权限声明（由链上 session validator 解释）。
   * 与 `template` 互斥；用模板时省略。
   */
  permissions?: Array<Record<string, unknown>>
  /**
   * 生效截止时间（Unix 秒）。与 `template` 互斥；用模板时省略。
   */
  validUntil?: number
  /** 生效起始时间（Unix 秒，缺省 0）。 */
  validAfter?: number
  /** 客户自持的 session key 地址；传入则 relay 不生成、不落库私钥（`/execute` 不可用）。 */
  signer?: string
  /** 租户/产品标识，缺省 `default`。 */
  product?: string
  /**
   * 限额模板名（当前仅 `agent-default`：单次 $1 / 日 $20 / 7 天过期）。
   * 传入时由 relay 生成 permissions 与 validUntil，调用方不得再传上面两项。
   */
  template?: string
  /** owner 授权签发时间（ms）；与 `ownerSignature` 同时必填。 */
  issuedAt?: number
  /**
   * owner 对 `keelSessionConsentMessage({owner,product,chain,template|permissions,issuedAt})`
   * 的 EIP-191 签名（personal_sign）。relay 默认强制校验。
   */
  ownerSignature?: string
}

export interface SessionCreated {
  product: string
  accountAddress: string
  isDeployed: boolean
  isBound: boolean
  sessionId: string
  /** session key 地址（自持模式即传入的 `signer`）。 */
  signer: string
  /** 仅 `keyCustody: 'relay'` 返回私钥；客户自持模式为 `null`。 */
  sessionKey: string | null
  keyCustody: SessionKeyCustody
  /** 十进制字符串（Unix 秒）。 */
  validAfter: string
  /** 十进制字符串（Unix 秒）。 */
  validUntil: string
  permissions: unknown[]
  /** 链上 validator 副本槽位。 */
  slot: number
  moduleVersion: string
  /** owner 侧启用 session 的 calldata。 */
  enableCallData: string
}

/** token paymaster 发现信息（不暴露私钥）。 */
export interface PaymasterInfo {
  chainId: number
  /** 支持的链（多链部署时长度 > 1）。 */
  chainIds?: number[]
  paymaster: string
  /** voucher 签发地址（仅用于核对）。 */
  signer: string
  voucher: {
    maxCostWei: string
    /** 按链生效上限（已按调用方租户策略收敛）。 */
    maxCostWeiByChain?: Record<string, string>
    ttlSec: number
    maxTtlSec: number
    perSenderPerDay: number
    /** 每链每日签发总额（wei），跨 sender 共享。 */
    dailyBudgetWeiByChain?: Record<string, string>
    /** voucher 允许的 preVerificationGas + verificationGasLimit 上限。 */
    maxPreVerifyPlusVerifyGas?: string
    /** maxFeePerGas ≤ 链上 gasPrice × 该倍数。 */
    gasPriceMultiplier?: string
    /** 固定意图：只赞助 `approve(paymaster, amount)`。 */
    intent: string
  }
  /** 命中租户限额策略时返回；未命中为 null（走部署级默认）。 */
  policy?: { tenant: string; label?: string } | null
}

/** 首笔授权 voucher 申请（无需 native、无需已有 allowance）。 */
export interface PaymasterVoucherParams {
  sender: string
  /** 待赞助的 callData（`approve(paymaster, amount)`，直连或包在 execute 里）。 */
  callData: string
  /** 本笔 op 的最大 gas 成本（wei，十进制字符串）。 */
  maxCost: string | bigint
  /** Unix 秒；缺省按服务端 TTL。 */
  validUntil?: number
  chainId?: number
  /**
   * 待赞助 UserOp 的 gas 字段（必填）。服务端据此校验
   * preVerificationGas + verificationGasLimit 上限与 maxFeePerGas ≤ gasPrice×N。
   */
  gas: PaymasterVoucherGas
}

export interface PaymasterVoucherGas {
  preVerificationGas: string | bigint
  verificationGasLimit: string | bigint
  callGasLimit: string | bigint
  paymasterVerificationGasLimit: string | bigint
  paymasterPostOpGasLimit: string | bigint
  maxFeePerGas: string | bigint
}

export interface PaymasterVoucher {
  chainId: number
  paymaster: string
  sender: string
  nonce: string
  validUntil: number
  maxCost: string
  callDataHash: string
  digest: string
  signature: string
  /** 直接放进 UserOp 的 `paymasterData`。 */
  paymasterData: string
}

export interface WalletBalanceParams {
  address: string
  chain?: string
  token?: string
}

export interface WalletChainBalance {
  chain: string
  address: string
  balances: Array<{
    token: string
    token_address: string
    /** 人类可读金额：EVM 为原生币小数（18 位），Solana 为 SOL 小数（9 位） */
    balance: string
    /** 仅 Solana：原始 lamports（十进制字符串） */
    balance_lamports?: string
    usd_value: string
  }>
  usdTotal: string
  error?: string
}

export interface WalletBalanceResult {
  chainBalances: WalletChainBalance[]
  totalUsd: string
}
