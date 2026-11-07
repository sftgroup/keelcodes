// ── Solana DEX provider 抽象（2026-10-24）──
//
// 目的：让 B 端用**自己的** DEX/聚合器端点（Jupiter 兼容网关、Raydium、OKX、
// 自建路由……）取价取指令，再把归一化结果交给 relay 组装 Squads 交易。
// relay 不再外呼，B 端的 URL / API key 只存在于自己的进程里。
//
// 契约：provider 只需实现两个方法
//   - `quote(req)`            → 统一的报价字段（用于回显，不参与风控/计费）
//   - `swapInstructions(req)` → `{ instructions, addressLookupTableAddresses? }`
//     `instructions` 的每项：{ programId, accounts: [{ pubkey, isSigner?, isWritable? }], data(base64) }
//
// 安全边界不变：真正的约束是链上 Squads policy（program 白名单 + 每 mint 限额），
// relay 侧只额外校验「结构 + program ∈ policyPrograms」。
import type { SolanaDexQuoteParams, SolanaDexSwapParams } from './solana-dex-types'

export interface DexInstructionAccount {
  pubkey: string
  isSigner?: boolean
  isWritable?: boolean
}

/** 归一化后的单条内层指令（data 为 base64） */
export interface DexInstruction {
  programId: string
  accounts: DexInstructionAccount[]
  data: string
}

/** 统一报价（字段口径与 relay `/dex/swap` 的响应一致） */
export interface DexProviderQuote {
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  priceImpactPct: string
  slippageBps: number
  /** provider 原始响应，供 `swapInstructions` 复用（不会发给 relay） */
  raw?: unknown
}

export interface DexProviderSwapRequest {
  inputMint: string
  outputMint: string
  amount: string | number
  slippageBps?: number
  /** swap 的 user（= Squads vault PDA） */
  userPublicKey: string
  /** `quote()` 返回的 `raw` */
  quote?: unknown
}

export interface DexProviderSwap {
  instructions: DexInstruction[]
  addressLookupTableAddresses?: string[]
}

export interface DexProvider {
  readonly name: string
  quote(req: SolanaDexQuoteParams): Promise<DexProviderQuote>
  swapInstructions(req: DexProviderSwapRequest): Promise<DexProviderSwap>
}

export interface JupiterProviderOptions {
  /** 默认 https://lite-api.jup.ag */
  baseUrl?: string
  /** Jupiter Pro（或自建网关）的 key，非空时作为 `x-api-key` 头 */
  apiKey?: string
  /** 便于测试注入；默认全局 fetch */
  fetchImpl?: typeof fetch
}

interface JupiterInstruction {
  programId: string
  accounts: DexInstructionAccount[]
  data: string
}

/** Jupiter `/swap/v1/swap-instructions` → 有顺序的指令列表（与 relay 内部口径一致）。 */
function collectJupiterInstructions(body: any): DexInstruction[] {
  const out: DexInstruction[] = []
  const push = (ix?: JupiterInstruction) => {
    if (ix && ix.programId) out.push({ programId: ix.programId, accounts: ix.accounts ?? [], data: ix.data })
  }
  push(body?.tokenLedgerInstruction)
  for (const ix of body?.computeBudgetInstructions ?? []) push(ix)
  for (const ix of body?.setupInstructions ?? []) push(ix)
  push(body?.swapInstruction)
  push(body?.cleanupInstruction)
  for (const ix of body?.otherInstructions ?? []) push(ix)
  return out
}

/**
 * Jupiter（含任意 Jupiter 兼容端点）provider。
 * 只需要 base URL 与可选 key，B 端即可用自己的额度/网关取价取指令。
 */
export function jupiterProvider(opts: JupiterProviderOptions = {}): DexProvider {
  const baseUrl = (opts.baseUrl ?? 'https://lite-api.jup.ag').replace(/\/+$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    ...(opts.apiKey ? { 'x-api-key': opts.apiKey } : {}),
  })

  async function readJson(res: Response, path: string): Promise<any> {
    const text = await res.text()
    if (!res.ok) throw new Error(`jupiter ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`)
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`jupiter ${path} returned invalid JSON`)
    }
  }

  return {
    name: 'jupiter',

    async quote(req: SolanaDexQuoteParams): Promise<DexProviderQuote> {
      const qs = new URLSearchParams({
        inputMint: req.inputMint,
        outputMint: req.outputMint,
        amount: String(req.amount),
        ...(req.slippageBps === undefined ? {} : { slippageBps: String(req.slippageBps) }),
      })
      const path = `/swap/v1/quote?${qs.toString()}`
      const raw = await readJson(await doFetch(`${baseUrl}${path}`, { headers: headers() }), path)
      return {
        inAmount: String(raw.inAmount),
        outAmount: String(raw.outAmount),
        otherAmountThreshold: String(raw.otherAmountThreshold ?? ''),
        priceImpactPct: String(raw.priceImpactPct ?? '0'),
        slippageBps: Number(raw.slippageBps ?? req.slippageBps ?? 50),
        raw,
      }
    },

    async swapInstructions(req: DexProviderSwapRequest): Promise<DexProviderSwap> {
      const path = '/swap/v1/swap-instructions'
      const body = {
        quoteResponse: req.quote,
        userPublicKey: req.userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }
      const raw = await readJson(
        await doFetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(body),
        }),
        path,
      )
      if (raw?.error) throw new Error(`jupiter swap-instructions error: ${String(raw.error)}`)
      return {
        instructions: collectJupiterInstructions(raw),
        addressLookupTableAddresses: Array.isArray(raw?.addressLookupTableAddresses)
          ? raw.addressLookupTableAddresses
          : [],
      }
    },
  }
}

/** B 端自定义 provider 的便捷校验：确保 relay 需要的字段齐全。 */
export function assertDexProvider(provider: DexProvider): void {
  if (!provider || typeof provider.quote !== 'function' || typeof provider.swapInstructions !== 'function') {
    throw new Error('dexProvider must implement quote() and swapInstructions()')
  }
}
