// ---------------------------------------------------------------------------
// @keelcodes/sdk — AA 客户端共享类型（EVM / Kernel v3 / ERC-4337 v0.7）
//
// 这里只保留「客户端自己签 UserOp + 自己组 x402 凭证」所需的最小形状，
// 与 @0xinfrax/aa-sdk 的 ChainAAConfig / SessionPolicy 逐字节兼容。
// ---------------------------------------------------------------------------

import type { Address, Hex } from 'viem'

export type EvmNetwork = 'evm'

export interface BundlerConfig {
  url: string
  /** 0 = 主端点（缺省） */
  priority?: number
  headers?: Record<string, string>
  timeoutMs?: number
}

/** 链配置：B 端可用 `keelChainConfig()` 取内置三链默认，再按需覆盖。 */
export interface ChainAAConfig {
  chainId: number
  /** EntryPoint v0.7 */
  entryPoint: Address
  rpcUrl?: string
  /** Kernel 版本（缺省 '0.3.1'） */
  kernelVersion?: string
  /** Kernel v3 factory（首笔部署用；缺省取内置三链默认） */
  kernelFactory?: Address
  /** Kernel v3 root validator（ECDSA；缺省取内置三链默认） */
  rootValidator?: Address
  /** Keel(v1) session validator 副本（slot i → 第 i 个；append-only） */
  sessionValidatorCopies?: Address[]
  /** Keel(v1) policy hook 副本（与 validator 成对） */
  sessionHookCopies?: Address[]
  bundlers?: BundlerConfig[]
}

/** 统一签名器（自持私钥 / MPC / 外部钱包）。 */
export interface Signer {
  readonly type: 'private-key' | 'mpc' | 'external-wallet'
  readonly address: Address
  /** 对 UserOp hash（或等价的 EIP-712 摘要）签名，返回 65 字节 ECDSA */
  signUserOp(hash: Hex): Promise<Hex>
  /** 对任意消息签名（EIP-191） */
  signMessage(message: Hex): Promise<Hex>
}

/** ERC-20 金额级限额（单笔 / 日累计；0 = 不限） */
export interface TokenLimit {
  token: Address
  maxPerTx: bigint
  maxDaily: bigint
}

/** 单条策略（target 维度） */
export interface SessionPermission {
  targets: Address[]
  selectors?: Hex[]
  valueLimit?: bigint
  countLimit?: number
  dailyLimit?: bigint
  tokenLimits?: TokenLimit[]
}

/** session 策略：链上 `policyData` 的唯一来源（须与 enable 时逐字节一致）。 */
export interface SessionPolicy {
  network?: EvmNetwork
  sessionId: string
  signer: Address
  validUntil: bigint
  validAfter: bigint
  permissions: SessionPermission[]
}

/** ERC-4337 v0.7 UserOperation（非打包形态，bundler RPC 字段） */
export interface UserOperationV7 {
  sender: Address
  nonce: bigint
  factory?: Address
  factoryData?: Hex
  callData: Hex
  callGasLimit: bigint
  verificationGasLimit: bigint
  preVerificationGas: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  paymaster?: Address
  paymasterVerificationGasLimit?: bigint
  paymasterPostOpGasLimit?: bigint
  paymasterData?: Hex
  signature: Hex
}

export interface UserOpReceipt {
  txHash?: Hex
  success: boolean
  actualGasCost: bigint
  actualGasUsed: bigint
  logs: unknown[]
}

export interface UserOpResult {
  userOpHash: Hex
  bundlerUrl: string
  /** 轮询到的收据（可能为 null = 未确认） */
  receipt?: UserOpReceipt
}

/** payX402WithSession 所需的最小 bundler 能力（HTTP 实现见 ./bundler）。 */
export interface BundlerLike {
  estimateUserOperationGas(
    op: UserOperationV7
  ): Promise<
    Partial<Pick<UserOperationV7, 'callGasLimit' | 'verificationGasLimit' | 'preVerificationGas'>>
  >
  sendUserOperation(op: UserOperationV7): Promise<UserOpResult>
}
