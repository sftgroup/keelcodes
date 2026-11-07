// ---------------------------------------------------------------------------
// x402 v2 标准 `exact` over Permit2 客户端（任意 ERC-20，含 BSC USDT/USDC）
// ---------------------------------------------------------------------------
// 与 payments 协议侧逐字段对齐（`protocol/stablecoin.ts` + `protocol/x402-standard.ts`）：
//
//   domain = { name: 'Permit2', chainId, verifyingContract: Permit2 }   ← 没有 version
//   types  = PermitWitnessTransferFrom{ permitted, spender, nonce, deadline, witness }
//            + TokenPermissions{ token, amount } + Witness{ to, validAfter }
//   header = base64(JSON({ x402Version: 2, scheme: 'exact', network,
//                          payload: { signature, permit2Authorization } }))
//
// 关键约束（与服务端/链上代理一致）：
//   * `spender` 必须是 x402 exact 代理（`X402_EXACT_PERMIT2_PROXY`），不是 facilitator
//   * `witness.to` 才是收款地址 —— 资金只可能流向它
//   * 首次使用需先 `approve(Permit2)`；否则 `/settle` 答 412
//     `PERMIT2_ALLOWANCE_REQUIRED`
// ---------------------------------------------------------------------------

import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'
import { toBase64, type X402Accept, type X402PaymentRequired } from './x402'
import { chainIdOfX402Network, randomX402Nonce } from './x402-exact'

/** Uniswap Permit2（canonical，各链同址）。 */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const
/** x402 exact 代理（Permit2 的 spender，资金只流向 witness.to）。 */
export const X402_EXACT_PERMIT2_PROXY = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001' as const

/** Permit2 EIP-712 域（**没有 version**）。 */
export const PERMIT2_DOMAIN_NAME = 'Permit2'

export const PERMIT2_WITNESS_TYPES = {
  PermitWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'Witness' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  Witness: [
    { name: 'to', type: 'address' },
    { name: 'validAfter', type: 'uint256' },
  ],
} as const

/** 402 挑战里的 Permit2 exact accept（`extra.assetTransferMethod === 'permit2'`）。 */
export interface X402Permit2Accept extends X402Accept {
  scheme: 'exact'
  extra: {
    assetTransferMethod: 'permit2'
    /** Permit2 合约（缺省用 canonical 地址）。 */
    permit2Address?: string
    /** x402 exact 代理（缺省用 canonical 地址）。 */
    permit2Proxy?: string
  } & Record<string, unknown>
}

export interface X402Permit2Authorization {
  from: string
  permitted: { token: string; amount: string }
  /** 必须是 x402 exact 代理。 */
  spender: string
  nonce: string
  /** unix 秒 */
  deadline: string
  witness: { to: string; validAfter: string }
}

export interface X402Permit2Payload {
  x402Version: 2
  /** 官方 v2 信封：402 挑战里选定 accept 的原文。 */
  accepted: X402Permit2Accept
  payload: {
    signature: Hex
    permit2Authorization: X402Permit2Authorization
    /**
     * B19.6：智能账户已用 UserOp 自行广播结算时附带的 txHash。
     * 服务端见到它只核验回执，不再代播（Permit2 nonce 已用，重播必 revert）。
     */
    txHash?: Hex
  }
}

/** EIP-712 待签结构（provider 的 `signTypedData` 直接消费）。 */
export interface X402Permit2TypedData {
  domain: { name: typeof PERMIT2_DOMAIN_NAME; chainId: number; verifyingContract: Address }
  types: typeof PERMIT2_WITNESS_TYPES
  primaryType: 'PermitWitnessTransferFrom'
  message: {
    permitted: { token: Address; amount: bigint }
    spender: Address
    nonce: bigint
    deadline: bigint
    witness: { to: Address; validAfter: bigint }
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** 该 accept 是否走 Permit2。 */
export function isPermit2Accept(accept: X402Accept): accept is X402Permit2Accept {
  return accept.scheme === 'exact' && (accept.extra as { assetTransferMethod?: unknown } | undefined)?.assetTransferMethod === 'permit2'
}

/**
 * 找出可签的 Permit2 exact accept（不抛错）：
 * `scheme=exact` + `extra.assetTransferMethod='permit2'` + 匹配 network / asset。
 */
export function findPermit2Accept(
  challenge: X402PaymentRequired,
  opts: { network?: string; asset?: string } = {}
): X402Permit2Accept | null {
  return (
    challenge.accepts.find(
      (a): a is X402Permit2Accept =>
        isPermit2Accept(a) &&
        (opts.network === undefined || a.network === opts.network) &&
        (opts.asset === undefined || a.asset.toLowerCase() === opts.asset.toLowerCase())
    ) ?? null
  )
}

/** 选出可签的 Permit2 accept；没有候选时抛错。 */
export function selectPermit2Accept(
  challenge: X402PaymentRequired,
  opts: { network?: string; asset?: string } = {}
): X402Permit2Accept {
  const pick = findPermit2Accept(challenge, opts)
  if (!pick) {
    throw new Error(
      '[keel-sdk] no x402 exact accept is payable with Permit2' +
        (opts.network || opts.asset ? ` (network=${opts.network ?? '*'}, asset=${opts.asset ?? '*'})` : '')
    )
  }
  return pick
}

/** accept 上的 Permit2 / 代理地址（缺省回落 canonical）。 */
export function permit2Of(accept: X402Permit2Accept): Address {
  const v = accept.extra.permit2Address
  if (v !== undefined) {
    if (!ADDRESS.test(v)) throw new Error(`[keel-sdk] invalid permit2Address in x402 challenge: ${v}`)
    return v as Address
  }
  return PERMIT2_ADDRESS
}

export function permit2ProxyOf(accept: X402Permit2Accept): Address {
  const v = accept.extra.permit2Proxy
  if (v !== undefined) {
    if (!ADDRESS.test(v)) throw new Error(`[keel-sdk] invalid permit2Proxy in x402 challenge: ${v}`)
    return v as Address
  }
  return X402_EXACT_PERMIT2_PROXY
}

/**
 * 组装授权（金额/收款方取自 accept；默认 validAfter=0、deadline=now+有效期）。
 * `spender` 固定为代理 —— 资金只可能流向 `witness.to`（= accept.payTo）。
 */
export function createX402Permit2Authorization(args: {
  accept: X402Permit2Accept
  from: string
  validForSeconds?: number
  validAfter?: number
  nonce?: bigint
  nowMs?: number
}): X402Permit2Authorization {
  const { accept, from } = args
  if (!ADDRESS.test(from)) throw new Error(`[keel-sdk] invalid payer address: ${from}`)
  if (!ADDRESS.test(accept.payTo)) throw new Error(`[keel-sdk] invalid payTo in x402 challenge: ${accept.payTo}`)
  if (!ADDRESS.test(accept.asset)) throw new Error(`[keel-sdk] invalid asset in x402 challenge: ${accept.asset}`)
  const amount = BigInt(accept.amount)
  if (amount <= 0n) throw new Error('[keel-sdk] x402 amount must be > 0')

  const nowSec = Math.floor((args.nowMs ?? Date.now()) / 1000)
  const maxTtl = accept.maxTimeoutSeconds && accept.maxTimeoutSeconds > 0 ? accept.maxTimeoutSeconds : 300
  const ttl = Math.max(1, Math.min(args.validForSeconds ?? maxTtl, maxTtl))
  const nonce = args.nonce ?? BigInt(randomX402Nonce())
  return {
    from,
    permitted: { token: accept.asset, amount: amount.toString() },
    spender: permit2ProxyOf(accept),
    nonce: nonce.toString(),
    deadline: String(nowSec + ttl),
    witness: { to: accept.payTo, validAfter: String(args.validAfter ?? 0) },
  }
}

/** 构造 EIP-712 待签结构（Permit2 域；无 version）。 */
export function buildX402Permit2TypedData(
  accept: X402Permit2Accept,
  authorization: X402Permit2Authorization,
  permit2: Address = permit2Of(accept)
): X402Permit2TypedData {
  return {
    domain: {
      name: PERMIT2_DOMAIN_NAME,
      chainId: chainIdOfX402Network(accept.network),
      verifyingContract: permit2,
    },
    types: PERMIT2_WITNESS_TYPES,
    primaryType: 'PermitWitnessTransferFrom',
    message: {
      permitted: {
        token: authorization.permitted.token as Address,
        amount: BigInt(authorization.permitted.amount),
      },
      spender: authorization.spender as Address,
      nonce: BigInt(authorization.nonce),
      deadline: BigInt(authorization.deadline),
      witness: {
        to: authorization.witness.to as Address,
        validAfter: BigInt(authorization.witness.validAfter),
      },
    },
  }
}

/** 组装未签名的 Permit2 `PAYMENT-SIGNATURE` 载荷。 */
export function buildX402Permit2Payload(
  accept: X402Permit2Accept,
  authorization: X402Permit2Authorization,
  signature: Hex,
  /** B19.6：账户已自播的结算回执（UserOp 执行时带上）。 */
  txHash?: Hex
): X402Permit2Payload {
  return {
    x402Version: 2,
    accepted: accept,
    payload: { signature, permit2Authorization: authorization, ...(txHash ? { txHash } : {}) },
  }
}

/** 载荷 → `PAYMENT-SIGNATURE` 头（base64）。 */
export function encodeX402Permit2Header(payload: X402Permit2Payload): string {
  return toBase64(JSON.stringify(payload))
}

/**
 * x402ExactPermit2Proxy.settle 的调用体（B19.6）：智能账户自己执行时用它。
 * 与 payments 侧 `X402_EXACT_PERMIT2_PROXY_ABI` 的 4 参布局逐字段一致。
 */
const X402_EXACT_PERMIT2_PROXY_ABI = parseAbi([
  'function settle(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, address owner, (address to, uint256 validAfter) witness, bytes signature)',
])

export function encodePermit2SettleCall(
  authorization: X402Permit2Authorization,
  signature: Hex
): { to: Address; value: 0n; data: Hex; asset: Address } {
  const token = authorization.permitted.token as Address
  return {
    // spender 就是代理：资金只可能流向 witness.to。
    to: authorization.spender as Address,
    value: 0n,
    data: encodeFunctionData({
      abi: X402_EXACT_PERMIT2_PROXY_ABI,
      functionName: 'settle',
      args: [
        {
          permitted: { token, amount: BigInt(authorization.permitted.amount) },
          nonce: BigInt(authorization.nonce),
          deadline: BigInt(authorization.deadline),
        },
        authorization.from as Address,
        {
          to: authorization.witness.to as Address,
          validAfter: BigInt(authorization.witness.validAfter),
        },
        signature,
      ],
    }),
    asset: token,
  }
}

export interface SignX402Permit2Params {
  /** 完整 402 挑战（二选一） */
  challenge?: X402PaymentRequired
  /** 已选定的 accept（二选一，优先） */
  accept?: X402Permit2Accept
  from: string
  signTypedData: (typed: X402Permit2TypedData) => Promise<Hex> | Hex
  network?: string
  asset?: string
  validForSeconds?: number
  validAfter?: number
  nonce?: bigint
  nowMs?: number
}

/**
 * 完成一次 Permit2 exact 付款签名（不发交易、不需要原生 gas）。
 * 智能账户（ERC-1271）的签名长度不限；EOA 通常为 65 字节。
 * @returns `header` 可直接作为 `PAYMENT-SIGNATURE` 发送。
 */
export async function signX402Permit2(params: SignX402Permit2Params): Promise<{
  header: string
  payload: X402Permit2Payload
  accept: X402Permit2Accept
  authorization: X402Permit2Authorization
}> {
  const accept =
    params.accept ??
    (params.challenge
      ? selectPermit2Accept(params.challenge, { network: params.network, asset: params.asset })
      : undefined)
  if (!accept) throw new Error('[keel-sdk] signX402Permit2 requires a challenge or an accept')

  const authorization = createX402Permit2Authorization({
    accept,
    from: params.from,
    validForSeconds: params.validForSeconds,
    validAfter: params.validAfter,
    nonce: params.nonce,
    nowMs: params.nowMs,
  })
  const signature = await params.signTypedData(buildX402Permit2TypedData(accept, authorization))
  if (!/^0x([0-9a-fA-F]{2})+$/.test(signature)) {
    throw new Error('[keel-sdk] signTypedData must return a hex signature')
  }
  const payload = buildX402Permit2Payload(accept, authorization, signature)
  return { header: encodeX402Permit2Header(payload), payload, accept, authorization }
}
