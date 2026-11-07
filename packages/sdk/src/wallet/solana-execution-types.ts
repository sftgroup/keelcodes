// ── Solana 子域（续）：执行 / 关闭 / 提交 ──
export interface SolanaCloseTransactionParams {
  chain: string
  blockhash: string
  feePayer: string
  /** 共识账户：policy PDA（policy 交易）或 settings PDA（settings 交易） */
  settingsPda: string
  transactionIndex: string | number
  /** transaction 账户 rent 回收地址；缺省 feePayer */
  transactionRentCollector?: string
  /** proposal 账户 rent 回收地址；缺省 transactionRentCollector */
  proposalRentCollector?: string
}

export interface SolanaExecutePolicyPayloadParams {
  chain: string
  blockhash: string
  feePayer: string
  /** policy PDA */
  policy: string
  accountIndex?: number
  numSigners: number
  amount: string | number
  destination: string
  decimals: number
  instructionAccounts: Array<{
    pubkey: string
    isWritable?: boolean
    isSigner?: boolean
  }>
}

export interface SolanaCloseSettingsParams {
  chain: string
  blockhash: string
  feePayer: string
  settingsPda: string
  transactionIndex: string | number
  transactionRentCollector?: string
  proposalRentCollector?: string
}

export interface SolanaExecutePolicyParams {
  chain: string
  blockhash: string
  feePayer: string
  settingsPda: string
  transactionIndex: string | number
  signer: string
  rentPayer?: string
  spendingLimits?: Array<Record<string, unknown>>
  /** `PolicyCreate` / `PolicyRemove` 的 policy PDA 列表（remaining accounts） */
  policies?: string[]
}

export interface SolanaExecuteParams {
  chain: string
  blockhash: string
  feePayer: string
  settingsPda: string
  signer: string
  spendingLimit: string
  mint?: string
  accountIndex: number
  amount: string | number
  decimals: number
  destination: string
  tokenProgram?: string
  memo?: string
}

export interface SolanaRemoveSignerParams {
  chain: string
  blockhash: string
  feePayer: string
  settingsPda: string
  settingsAuthority: string
  oldSigner: string
  memo?: string
}

export interface SolanaSubmitParams {
  chain: string
  transaction: string
  /**
   * 垫付模式的扣费主体（客户 base58 地址）。仅当交易 fee payer 是平台热钱包时需要；
   * relay 会把固定服务费 + 实际垫付 lamports 扣在该地址。
   */
  payer?: string
  /**
   * 同交易扣费凭证（`/dex/swap` 响应里的 `feeProof`）。给出且校验通过时，
   * relay 不再从账本扣服务费（费用已在交易内由智能账户直接支付）。
   */
  feeProof?: string
}

/** 构建端点返回的未签名交易（base64）。 */
export interface SolanaUnsignedTransaction {
  chain: string
  transaction: string
  feePayer?: string
  instructionCount?: number
}

export interface SolanaSubmitResult {
  chain: string
  signature: string
  feePayer?: string
  /** 同交易扣费：服务费已由智能账户在交易内支付（无账本扣费） */
  fee?: { mode: 'onchain' }
}
