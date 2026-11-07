// ── Solana 子域（Squads Smart Account；relay 只组装/广播，不持私钥）──
export interface SolanaDeriveAccountParams {
  chain: string
  accountIndex: string | number
  smartAccountIndex?: string | number
}

export interface SolanaDerivedAccount {
  chain: string
  accountIndex: string
  smartAccountIndex: number
  settingsPda: string
  smartAccountPda: string
}

export interface SolanaCreateAccountParams {
  chain: string
  blockhash: string
  treasury: string
  creator: string
  settingsPda: string
  signers: Array<Record<string, unknown>>
  settingsAuthority?: string
  threshold?: number
  timeLock?: number
  rentCollector?: string
  memo?: string
}

export interface SolanaInstallPolicyParams {
  chain: string
  blockhash: string
  feePayer: string
  creator: string
  settingsPda: string
  transactionIndex: string | number
  signer: Record<string, unknown>
  /** 旧口径 `SettingsAction::AddSpendingLimit`（已 deprecated） */
  spendingLimit?: Record<string, unknown>
  /** 新口径 `SettingsAction::PolicyCreate`（spending limit policy） */
  spendingLimitPolicy?: SolanaSpendingLimitPolicy
}

/** 新口径 spending limit policy（`PolicyCreate`；金额/seed 为十进制整数，可用字符串）。 */
export interface SolanaSpendingLimitPolicy {
  seed: string | number
  mint: string
  sourceAccountIndex?: number
  amount: string | number
  maxPerUse?: string | number
  /** 旧 `Period` 枚举值（0=OneTime / 1=Day / 2=Week / 3=Month） */
  period?: number
  start?: string | number
  expiration?: string | number
  accumulateUnused?: boolean
  enforceExactQuantity?: boolean
  destinations?: string[]
  signers: Array<Record<string, unknown>>
  threshold?: number
  timeLock?: number
}

export interface SolanaCreatePolicyTransactionParams {
  chain: string
  blockhash: string
  feePayer: string
  /** policy PDA */
  policy: string
  transactionIndex: string | number
  creator: string
  rentPayer?: string
  accountIndex?: number
  amount: string | number
  destination: string
  decimals: number
}

export interface SolanaCreateProposalParams {
  chain: string
  blockhash: string
  feePayer: string
  /** 共识账户：settings PDA（settings 交易）或 policy PDA（policy 交易） */
  settingsPda: string
  transactionIndex: string | number
  creator: string
  rentPayer?: string
  isDraft?: boolean
}

export interface SolanaApproveProposalParams {
  chain: string
  blockhash: string
  feePayer: string
  /** 共识账户：settings PDA（settings 交易）或 policy PDA（policy 交易） */
  settingsPda: string
  transactionIndex: string | number
  signer: string
  memo?: string
}

export interface SolanaExecutePolicyTransactionParams {
  chain: string
  blockhash: string
  feePayer: string
  /** policy PDA */
  policy: string
  transactionIndex: string | number
  signer: string
  /** 策略执行所需的剩余账户（native SOL: [source, destination, systemProgram]） */
  anchorRemainingAccounts: Array<{
    pubkey: string
    isWritable?: boolean
    isSigner?: boolean
  }>
}

export interface SolanaRemovePolicyParams {
  chain: string
  blockhash: string
  feePayer: string
  creator: string
  settingsPda: string
  transactionIndex: string | number
  /** 待删除的 policy PDA（同时需在 execute 时作为 remaining account 传入） */
  policy: string
  rentPayer?: string
  memo?: string
}
