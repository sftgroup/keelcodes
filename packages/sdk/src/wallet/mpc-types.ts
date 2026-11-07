// ── MPC 子域（email 分片钱包：onboarding / 会话 / 链上 / 合约 / 计费）──
export interface MpcSendCodeParams {
  email: string
}
export interface MpcVerifyParams {
  email: string
  code: string
}
export interface MpcBalanceParams {
  token: string
  chain?: string
  tokenAddress?: string
}

/** 注册参数：`curve='ed25519'` 时创建 Solana 钱包（可选 seed 导入存量私钥）。 */
export interface MpcRegisterParams extends MpcVerifyParams {
  /** 签名曲线，默认 `secp256k1`（EVM）。 */
  curve?: 'secp256k1' | 'ed25519'
  /** 仅 ed25519：32B 种子 hex（可带 0x）；导入后 base58 地址与导入前逐字节一致。 */
  seed?: string
  walletAddress?: string
}

/** 注册结果。 */
export interface MpcRegisterResult {
  walletId: string
  email: string
  /** EVM 为 0x 地址；ed25519 为 base58 地址。 */
  walletAddress: string
  curve: string
  createdAt: string
}

/** Solana 签名参数。 */
export interface MpcSolanaSignParams {
  token: string
  /** Solana 交易 message **原文**（hex，可带 0x），不是 32B 摘要（Ed25519ph 不被 Solana 支持）。 */
  message: string
  /** 2-of-3 选片，默认 1。 */
  partnerIndex?: number
}

/** Solana 签名结果（Ed25519 无 `v` 恢复 id）。 */
export interface MpcSolanaSignResult {
  curve: 'ed25519'
  /** 64B `R‖z`，128 hex，无 0x。 */
  signature: string
  publicKey: string
  address: string
}

/** Solana 广播参数。 */
export interface MpcSolanaSendParams {
  token: string
  /** base64 编码的**已签名**交易（交易构建与签名组装由客户端完成）。 */
  transaction: string
  /** 是否等待确认，默认 true。 */
  wait?: boolean
}

/** Solana 广播结果。 */
export interface MpcSolanaSendResult {
  chain: 'solana'
  txHash: string | null
  from: string
  confirmed: boolean
  reason: string | null
  signatureStatus: string | null
}

export interface MpcSignMessageParams {
  token: string
  message: string
}
export interface MpcSignTypedDataParams {
  token: string
  domain: Record<string, unknown>
  types: Record<string, unknown>
  value: Record<string, unknown>
}
export interface MpcSendTransactionParams {
  token: string
  to: string
  amount: string
  chain?: string
  tokenAddress?: string
}
export interface MpcContractCallParams {
  contractAddress: string
  abi: unknown[]
  method: string
  args?: unknown[]
  chain?: string
}
export interface MpcContractWriteParams extends MpcContractCallParams {
  token: string
  value?: string
  gasLimit?: string
}
export interface MpcGasEstimateParams {
  to?: string
  value?: string
  data?: string
  chain?: string
}
