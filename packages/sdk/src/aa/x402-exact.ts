// ---------------------------------------------------------------------------
// x402 v2 标准 `exact`（EIP-3009 transferWithAuthorization）客户端
// ---------------------------------------------------------------------------
// 与 payments 协议侧逐字段对齐（`protocol/stablecoin.ts` + `protocol/x402-standard.ts`）：
//
//   domain = { name: <代币域名，如 'USD Coin'>, version: '2', chainId, verifyingContract: 代币合约 }
//   types  = TransferWithAuthorization{ from, to, value, validAfter, validBefore, nonce }
//   header = base64(JSON({ x402Version: 2, accepted: <选定 accept 原文>,
//                          payload: { signature, authorization } }))
//
// 与自家 legacy 轨（`./x402.ts`，客户端先转账再提交 txHash）的区别：
//   * 客户端**只签名、不广播**，gas 由 facilitator（收款方）承担
//   * 资产与金额由 402 挑战的 `accepts[]` 决定，载荷本身不带 asset
//   * 金额必须与挑战严格相等（exact 不做超付容忍）
// ---------------------------------------------------------------------------

import { keccak256, stringToHex, toHex, type Address, type Hex } from 'viem'
import { toBase64, type X402Accept, type X402PaymentRequired } from './x402'
import type { X402Permit2TypedData } from './x402-permit2'
import type { X402SessionPayerConfig } from './x402-permit2-session'

/** EIP-3009 域名版本（USDC = '2'）。 */
export const EIP3009_DOMAIN_VERSION = '2'

/** EIP-3009 类型结构（必须与代币合约的 typehash 一致）。 */
export const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

/** 402 挑战里的标准 exact accept（`extra` 必带代币 EIP-712 域名）。 */
export interface X402ExactAccept extends X402Accept {
  scheme: 'exact'
  extra?: { name?: string; version?: string } & Record<string, unknown>
}

export interface X402ExactAuthorization {
  from: string
  to: string
  /** 代币最小单位（十进制字符串） */
  value: string
  /** unix 秒 */
  validAfter: string
  /** unix 秒 */
  validBefore: string
  nonce: Hex
}

/** 官方 v2 `PAYMENT-SIGNATURE` 载荷（`accepted` = 402 挑战里选定 accept 的原文）。 */
export interface X402ExactPayload {
  x402Version: 2
  accepted: X402ExactAccept
  payload: {
    signature: Hex
    authorization: X402ExactAuthorization
  }
}

/** EIP-712 待签结构（provider 的 `signTypedData` 直接消费）。 */
export interface X402ExactTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address }
  types: typeof EIP3009_TYPES
  primaryType: 'TransferWithAuthorization'
  message: {
    from: Address
    to: Address
    value: bigint
    validAfter: bigint
    validBefore: bigint
    nonce: Hex
  }
}

/**
 * 自动付款配置：`HttpClient` 收到 402 时用该钱包签一份标准 exact 授权并重试一次。
 * 优先 EIP-3009（`extra.name`），否则自动选择 Permit2（`extra.assetTransferMethod`），
 * 因此 BSC USDT/USDC 等无 EIP-3009 的代币也可直接付款。
 */
export interface X402PayerConfig {
  /** 付款人地址（会成为 `authorization.from`）。 */
  address: string
  /** EIP-712 签名（EOA 用 `walletClient.signTypedData`；智能账户用其 1271 签名）。 */
  signTypedData: (typed: X402ExactTypedData) => Promise<Hex> | Hex
  /** 只对指定 network（CAIP-2，如 `eip155:8453`）付款。 */
  network?: string
  /** 只对指定代币合约付款。 */
  asset?: string
  /** 单笔上限（代币最小单位）；超过则拒绝付款并抛错。 */
  maxAmount?: string
  /** 授权有效期（秒）；默认取挑战 `maxTimeoutSeconds`（缺省 300），不会超过挑战上限。 */
  validForSeconds?: number
  /**
   * Permit2 的 EIP-712 签名器（可选）。缺省复用 `signTypedData`。
   * 智能账户（ERC-1271）用 `permit2SessionSigner()`（`./x402-permit2-session`）
   * 生成 Kernel 信封签名，直接挂到这里即可让 402 自动重试走 session key。
   */
  signPermit2TypedData?: (typed: X402Permit2TypedData) => Promise<Hex> | Hex
  /**
   * B19.6：智能账户自播（UserOp + paymaster）付款参数。配置后，Permit2 accept 的
   * 402 重试改由**账户自己**广播 `proxy.settle`，服务端只核验 txHash 回执，
   * 不再由平台 settler 代播、也不再占平台 gas。优先级高于 `signPermit2TypedData`。
   */
  sessionPayer?: X402SessionPayerConfig
  /**
   * A9.9：显式允许走 EOA 直付。默认 false —— 配了 session key 时一律走 L2，
   * 超限直接报错、**不静默回退 EOA**。置 true 后 SDK 会用 EOA 签名并附带
   * `x-keel-pay-with: eoa`，结算侧据此在流水标记 `fallback=eoa`。
   */
  allowEoaFallback?: boolean
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** CAIP-2 `eip155:<id>` → chainId（Solana 等非 EVM 网络不支持本模块）。 */
export function chainIdOfX402Network(network: string): number {
  const m = /^eip155:(\d+)$/.exec(network)
  const chainId = m ? Number(m[1]) : NaN
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`[keel-sdk] unsupported x402 network for exact (EIP-3009): ${network}`)
  }
  return chainId
}

/**
 * 找出可签的 exact accept（不抛错）。
 * 条件：`scheme=exact` + `extra.name` 存在（代币 EIP-712 域名）+ 匹配 network / asset。
 */
export function findExactAccept(
  challenge: X402PaymentRequired,
  opts: { network?: string; asset?: string } = {}
): X402ExactAccept | null {
  return (
    challenge.accepts.find(
      (a): a is X402ExactAccept =>
        a.scheme === 'exact' &&
        typeof (a.extra as { name?: unknown } | undefined)?.name === 'string' &&
        (opts.network === undefined || a.network === opts.network) &&
        (opts.asset === undefined || a.asset.toLowerCase() === opts.asset.toLowerCase())
    ) ?? null
  )
}

/**
 * 选出可签的 exact accept：必须有 `extra.name`（代币 EIP-712 域名），
 * 且（若指定）匹配 network / asset。没有候选时抛错。
 */
export function selectExactAccept(
  challenge: X402PaymentRequired,
  opts: { network?: string; asset?: string } = {}
): X402ExactAccept {
  const pick = findExactAccept(challenge, opts)
  if (!pick) {
    throw new Error(
      '[keel-sdk] no x402 exact accept is payable with EIP-3009' +
        (opts.network || opts.asset ? ` (network=${opts.network ?? '*'}, asset=${opts.asset ?? '*'})` : '')
    )
  }
  return pick
}

/** 随机 32 字节 nonce（WebCrypto 优先，退化到 keccak 派生）。 */
export function randomX402Nonce(): Hex {
  const webcrypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto
  if (webcrypto?.getRandomValues) {
    const bytes = new Uint8Array(32)
    webcrypto.getRandomValues(bytes)
    return toHex(bytes)
  }
  return keccak256(stringToHex(`${Date.now()}:${Math.random()}:${Math.random()}`))
}

/** 组装授权（金额/收款方取自 accept，默认 validAfter=0、validBefore=now+有效期）。 */
export function createX402ExactAuthorization(args: {
  accept: X402ExactAccept
  from: string
  validForSeconds?: number
  validAfter?: number
  nonce?: Hex
  nowMs?: number
}): X402ExactAuthorization {
  const { accept, from } = args
  if (!ADDRESS.test(from)) throw new Error(`[keel-sdk] invalid payer address: ${from}`)
  if (!ADDRESS.test(accept.payTo)) throw new Error(`[keel-sdk] invalid payTo in x402 challenge: ${accept.payTo}`)
  const value = BigInt(accept.amount)
  if (value <= 0n) throw new Error('[keel-sdk] x402 amount must be > 0')

  const nowSec = Math.floor((args.nowMs ?? Date.now()) / 1000)
  const maxTtl = accept.maxTimeoutSeconds && accept.maxTimeoutSeconds > 0 ? accept.maxTimeoutSeconds : 300
  const ttl = Math.max(1, Math.min(args.validForSeconds ?? maxTtl, maxTtl))
  return {
    from,
    to: accept.payTo,
    value: value.toString(),
    validAfter: String(args.validAfter ?? 0),
    validBefore: String(nowSec + ttl),
    nonce: args.nonce ?? randomX402Nonce(),
  }
}

/** 构造 EIP-712 待签结构（domain 名称/版本来自挑战的 `accept.extra`）。 */
export function buildX402ExactTypedData(
  accept: X402ExactAccept,
  authorization: X402ExactAuthorization
): X402ExactTypedData {
  const name = accept.extra?.name
  if (typeof name !== 'string' || !name) {
    throw new Error('[keel-sdk] x402 accept is missing extra.name (token EIP-712 domain name)')
  }
  return {
    domain: {
      name,
      version: typeof accept.extra?.version === 'string' ? accept.extra.version : EIP3009_DOMAIN_VERSION,
      chainId: chainIdOfX402Network(accept.network),
      verifyingContract: accept.asset as Address,
    },
    types: EIP3009_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from as Address,
      to: authorization.to as Address,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  }
}

/** 组装未签名的 `PAYMENT-SIGNATURE` 载荷。 */
export function buildX402ExactPayload(
  accept: X402ExactAccept,
  authorization: X402ExactAuthorization,
  signature: Hex
): X402ExactPayload {
  return {
    x402Version: 2,
    accepted: accept,
    payload: { signature, authorization },
  }
}

/** 载荷 → `PAYMENT-SIGNATURE` 头（base64）。 */
export function encodeX402ExactHeader(payload: X402ExactPayload): string {
  return toBase64(JSON.stringify(payload))
}

export interface SignX402ExactParams {
  /** 完整 402 挑战（二选一） */
  challenge?: X402PaymentRequired
  /** 已选定的 accept（二选一，优先） */
  accept?: X402ExactAccept
  from: string
  signTypedData: (typed: X402ExactTypedData) => Promise<Hex> | Hex
  network?: string
  asset?: string
  validForSeconds?: number
  validAfter?: number
  nonce?: Hex
  nowMs?: number
}

/**
 * 完成一次标准 exact 付款签名（不发交易、不需要原生 gas）。
 * @returns `header` 可直接作为 `PAYMENT-SIGNATURE` 发送。
 */
export async function signX402Exact(params: SignX402ExactParams): Promise<{
  header: string
  payload: X402ExactPayload
  accept: X402ExactAccept
  authorization: X402ExactAuthorization
}> {
  const accept =
    params.accept ??
    (params.challenge
      ? selectExactAccept(params.challenge, { network: params.network, asset: params.asset })
      : undefined)
  if (!accept) throw new Error('[keel-sdk] signX402Exact requires a challenge or an accept')

  const authorization = createX402ExactAuthorization({
    accept,
    from: params.from,
    validForSeconds: params.validForSeconds,
    validAfter: params.validAfter,
    nonce: params.nonce,
    nowMs: params.nowMs,
  })
  const signature = await params.signTypedData(buildX402ExactTypedData(accept, authorization))
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error('[keel-sdk] signTypedData must return a 65-byte signature for EIP-3009')
  }
  const payload = buildX402ExactPayload(accept, authorization, signature)
  return { header: encodeX402ExactHeader(payload), payload, accept, authorization }
}
