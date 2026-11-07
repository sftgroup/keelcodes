// ── Solana 子域（续）：DEX / 聚合器（agent 自主 swap，链上硬限额）──
import type { SolanaSubmitResult } from './solana-execution-types'
import type { DexInstruction, DexProvider } from './solana-dex-provider'

/** DEX 报价（只读，不构建交易） */
export interface SolanaDexQuoteParams {
  chain: string
  inputMint: string
  outputMint: string
  /** base units（十进制整数） */
  amount: string | number
  slippageBps?: number
}

export interface SolanaDexQuoteResult {
  chain: string
  /** Jupiter 原始报价（字段随聚合器版本变化，按需读取） */
  quote: Record<string, unknown>
  inputMint: string
  inAmount: string
  outputMint: string
  outAmount: string
  otherAmountThreshold: string
  priceImpactPct: string
  slippageBps: number
}

/** `ProgramInteraction` policy 安装入参（`/dex/policy` 与 `/dex/install` 通用） */
export interface SolanaDexPolicyParams {
  chain: string
  blockhash: string
  feePayer: string
  creator: string
  settingsPda: string
  transactionIndex: string | number
  /** policy PDA 的 u64 seed（= 调用前链上 `settings.policySeed + 1`） */
  seed: string | number
  /** 作为 policy 唯一签名者的 session key 公钥 */
  sessionKey: string
  rentPayer?: string
  accountIndex?: number
  /** 缺省 `[1,2,4]`（Initiate | Vote | Execute） */
  permissions?: number[]
  spendingLimits?: Array<{
    mint: string
    /** base units（十进制整数） */
    maxPerPeriod: string | number
    period?: number
    start?: string | number
    expiration?: string | number
  }>
  /** 缺省 = relay 配置里的 program 白名单（Jupiter + 直连 DEX + 辅助 program） */
  constraints?: Array<{
    programId: string
    accountConstraints?: Array<{ accountIndex: number; pubkeys: string[]; owner?: string }>
    dataConstraints?: Array<{ offset: string | number; value?: string; operator?: number }>
  }>
  memo?: string
}

/** 安装计划中的一步（未签名交易，按 `steps` 顺序签名广播） */
export interface SolanaDexInstallStep {
  step:
    | 'createSettingsTransaction'
    | 'createProposal'
    | 'approveProposal'
    | 'executeSettingsTransaction'
  /** 需要本地签名的公钥（base58） */
  signers: string[]
  instructionCount: number
  /** base64（v0） */
  transaction: string
}

export interface SolanaDexInstallResult {
  chain: string
  policyPda: string
  /** 四步共用同一个 blockhash；过期未走完需重新调用 */
  blockhash: string
  steps: SolanaDexInstallStep[]
}

export interface SolanaDexSwapParams {
  chain: string
  blockhash: string
  feePayer: string
  /** policy PDA */
  policy: string
  /** smart account（vault）PDA */
  vaultPda: string
  sessionKey: string
  inputMint: string
  outputMint: string
  amount: string | number
  accountIndex?: number
  numSigners?: number
  slippageBps?: number
  wrapAndUnwrapSol?: boolean
  dynamicComputeUnitLimit?: boolean
  /**
   * policy 创建时 `instructionsConstraints` 的顺序（programId 数组）。
   * 缺省取 relay 配置白名单顺序；链上要求逐条指令都能映射到一条约束。
   * 使用 `dexProvider`（external 模式）时**必须**给出，relay 以它作为 program 白名单。
   */
  policyPrograms?: string[]
  /**
   * 自定义 DEX/聚合器 provider（2026-10-24）。给出时 SDK 先本地取价取指令，
   * 再以 `provider: 'external'` 交给 relay 组装交易；URL/key 不经过 relay。
   */
  dexProvider?: DexProvider
  /** external 模式的报价回显（不参与风控/计费）；`dexProvider` 会自动填充 */
  quote?: {
    inAmount?: string
    outAmount?: string
    otherAmountThreshold?: string
    priceImpactPct?: string
    slippageBps?: number
  }
  /** external 模式的归一化内层指令（`dexProvider` 会自动填充） */
  swapInstructions?: DexInstruction[]
  /** external 模式的地址查找表（`dexProvider` 会自动填充） */
  addressLookupTableAddresses?: string[]
  /**
   * 代建 ATA 的租金付款人（2026-10-24）。给出后 relay 把内层 ATA create 的
   * payer 从 vault 换成该地址，vault 无需持有 SOL。必须是本交易的签名者
   * （通常就是 `feePayer`），否则交易签不出来。
   */
  rentPayer?: string
  /**
   * 同交易扣费（`AA_SOLANA_FEE_MODE=onchain`）的付费稳定币 mint。
   * 缺省按 USDC → USDT → 输出币 自动选；指定后不使用其它币种。
   */
  feeMint?: string
}

export interface SolanaDexSwapResult {
  chain: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  priceImpactPct: string
  slippageBps: number
  innerInstructionCount: number
  instructionConstraintIndices: number[]
  addressLookupTables: number
  transactionBytes: number
  /** 未签名交易（base64 v0）；签名后经 `submit` 广播才会计费 */
  transaction: string
  instructionCount?: number
  /** 计费提示：签名后发到该端点，relay 按 fee payer 收固定服务费 */
  billing?: { endpoint: string; feePayer: string; feeLamports: string }
  /** 同交易扣费信息（费用已在内层指令里；无需账本预付） */
  fee?: { mint: string; symbol: string; amountAtomic: string; position: 'first' | 'last' }
  /** 费用凭证（HMAC 绑定本笔交易）；`dexSwapAndSubmit` 会自动转交 `/submit` */
  feeProof?: string
}

/**
 * 本地签名回调：入参为未签名交易（base64 v0）与需要签名的公钥，
 * 返回已签名的 base64 交易。SDK 不内置 Solana 依赖，由调用方用
 * `@solana/web3.js`（`VersionedTransaction.deserialize` → `sign`）实现。
 */
export type SolanaTransactionSigner = (
  transaction: string,
  signers: string[],
) => Promise<string> | string

/** `dexSwapAndSubmit`：一次完成「取未签名交易 → 本地签名 → 经 relay 计费广播」。 */
export interface SolanaDexSwapAndSubmitParams extends SolanaDexSwapParams {
  sign: SolanaTransactionSigner
  /**
   * 垫付模式下的扣费主体（客户地址）。fee payer 是平台热钱包时必须给，
   * relay 会把「固定服务费 + 实际垫付 lamports」扣在该地址账本上。
   */
  payer?: string
}

export interface SolanaDexSwapAndSubmitResult extends SolanaDexSwapResult {
  /** relay `/submit` 的广播回执（计费发生在这里） */
  submit: SolanaSubmitResult
}
