// ---------------------------------------------------------------------------
// x402 v2 客户端：解 challenge / 选 accept / 组 EIP-712 / 出 PAYMENT-SIGNATURE
//
// 与 payments 服务端（`protocol/x402-v2.ts`）逐字段对齐：
//   domain = { name:'x402', version:'2', chainId, verifyingContract: payTo }
//   types  = Payment{ scheme, network, amount, asset, payTo, method, url, salt, txHash }
//   header = base64(JSON({ x402Version, resource, accepted, payload:{method,url,salt,txHash}, signature }))
//
// 两条用法：
//   1. 自己已有 txHash（例如用 session key / 任意钱包先发了转账）→ `buildX402Payment` +
//      `buildX402TypedData` + `encodePaymentSignature`
//   2. 由 SDK 驱动付款（回调里发 tx）→ `payX402`
// ---------------------------------------------------------------------------

import { encodeFunctionData, keccak256, stringToHex, toHex, type Address, type Hex } from 'viem'

export interface X402Accept {
  scheme: 'exact' | 'upto'
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra?: Record<string, unknown>
}

export interface X402ResourceInfo {
  url: string
  description?: string
  mimeType?: string
}

export interface X402PaymentRequired {
  x402Version: 2
  error?: string
  resource?: X402ResourceInfo
  accepts: X402Accept[]
  extensions?: Record<string, unknown>
}

export interface X402PaymentPayload {
  x402Version: 2
  resource?: X402ResourceInfo
  accepted: X402Accept
  payload: {
    method: string
    url: string
    salt: Hex
    txHash: Hex
  }
  extensions?: Record<string, unknown>
  signature: Hex
}

export interface X402Payment {
  /** 交易目标：native → payTo；token → token 合约 */
  to: Address
  value: bigint
  data: Hex
  /** 计费资产（native 为 0x0 哨兵） */
  asset: Address
}

export interface X402TypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address }
  types: {
    Payment: readonly { name: string; type: string }[]
  }
  primaryType: 'Payment'
  message: Record<string, string>
}

export interface PayX402Params {
  challenge: X402PaymentRequired
  /** 不传则按 asset/network 自动选第一个可用 accept */
  accept?: X402Accept
  /** 发起链上付款并返回 txHash */
  sendPayment: (payment: X402Payment) => Promise<Hex>
  /** EIP-712 签名（EOA 用 walletClient.signTypedData；智能账户用其 1271 签名） */
  signTypedData: (typed: X402TypedData) => Promise<Hex>
  /** 等 tx 上链（建议传入，避免服务端 verify 时查不到 receipt） */
  waitForTransaction?: (hash: Hex) => Promise<unknown>
  method?: string
  url?: string
  /** 覆盖盐值（默认由 txHash + 时间派生） */
  salt?: Hex
}

const TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

export const X402_DOMAIN_NAME = 'x402'
export const X402_DOMAIN_VERSION = '2'
export const X402_TYPES = {
  Payment: [
    { name: 'scheme', type: 'string' },
    { name: 'network', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'asset', type: 'address' },
    { name: 'payTo', type: 'address' },
    { name: 'method', type: 'string' },
    { name: 'url', type: 'string' },
    { name: 'salt', type: 'string' },
    { name: 'txHash', type: 'string' },
  ],
} as const

/** 解 `PAYMENT-REQUIRED` 头（base64 或直接 JSON）。 */
export function decodePaymentRequired(header: string): X402PaymentRequired {
  const raw = header.trim()
  const text = raw.startsWith('{') ? raw : fromBase64(raw)
  const parsed = JSON.parse(text) as X402PaymentRequired
  if (parsed?.x402Version !== 2 || !Array.isArray(parsed.accepts) || parsed.accepts.length === 0) {
    throw new Error('[keel-sdk] PAYMENT-REQUIRED is not a valid x402 v2 challenge')
  }
  return parsed
}

/** 选 accept：优先 exact，其次按传入的 asset / network 过滤。 */
export function selectX402Accept(
  challenge: X402PaymentRequired,
  opts: { asset?: string; network?: string } = {}
): X402Accept {
  const matches = challenge.accepts.filter(
    (a) =>
      (opts.asset === undefined || a.asset.toLowerCase() === opts.asset.toLowerCase()) &&
      (opts.network === undefined || a.network === opts.network)
  )
  const pick = matches.find((a) => a.scheme === 'exact') ?? matches[0]
  if (!pick) throw new Error('[keel-sdk] no x402 accept matches the requested asset/network')
  return pick
}

/** 按 accept 组装链上付款参数（native 转账或 ERC20 transfer）。 */
export function buildX402Payment(accept: X402Accept): X402Payment {
  const amount = BigInt(accept.amount)
  if (amount <= 0n) throw new Error('[keel-sdk] x402 amount must be > 0')
  const asset = accept.asset as Address
  const payTo = accept.payTo as Address
  const isNative = /^0x0{40}$/i.test(asset)
  if (isNative) return { to: payTo, value: amount, data: '0x', asset }
  return {
    to: asset,
    value: 0n,
    data: encodeFunctionData({
      abi: TRANSFER_ABI,
      functionName: 'transfer',
      args: [payTo, amount],
    }),
    asset,
  }
}

/** 构造待签的 EIP-712 结构（必须与 payments 侧逐字段一致）。 */
export function buildX402TypedData(payload: X402PaymentPayload): X402TypedData {
  const { accepted } = payload
  const chainId = Number(accepted.network.replace('eip155:', ''))
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`[keel-sdk] unsupported x402 network: ${accepted.network}`)
  }
  return {
    domain: {
      name: X402_DOMAIN_NAME,
      version: X402_DOMAIN_VERSION,
      chainId,
      verifyingContract: accepted.payTo as Address,
    },
    types: X402_TYPES,
    primaryType: 'Payment',
    message: {
      scheme: accepted.scheme,
      network: accepted.network,
      amount: accepted.amount,
      asset: accepted.asset,
      payTo: accepted.payTo,
      method: payload.payload.method,
      url: payload.payload.url,
      salt: payload.payload.salt,
      txHash: payload.payload.txHash,
    },
  }
}

/**
 * 已有签名时组装 `PAYMENT-SIGNATURE` 头（base64）。
 * 配合 {@link buildX402TypedData} + `wallet.signTypedData` 用于纯 EOA 客户端。
 */
export function encodePaymentSignature(payload: X402PaymentPayload): string {
  return toBase64(JSON.stringify(payload))
}

/** 由链上付款结果构造未签名的 payload（salt 缺省自动派生）。 */
export function buildX402Payload(args: {
  challenge: X402PaymentRequired
  accepted: X402Accept
  txHash: Hex
  method?: string
  url?: string
  salt?: Hex
}): X402PaymentPayload {
  return {
    x402Version: 2,
    resource: args.challenge.resource,
    accepted: args.accepted,
    payload: {
      method: args.method ?? 'GET',
      url: args.url ?? args.challenge.resource?.url ?? '',
      salt:
        args.salt ??
        keccak256(stringToHex(`${args.txHash}:${Date.now()}:${Math.random().toString(36).slice(2)}`)),
      txHash: args.txHash,
    },
    signature: '0x',
  }
}

/**
 * 完成一次 x402 付款：发起链上支付 → 等确认 → 构造并签名 PaymentPayload。
 * @returns `header` 可直接写入 `PAYMENT-SIGNATURE`。
 */
export async function payX402(params: PayX402Params): Promise<{
  header: string
  payload: X402PaymentPayload
  txHash: Hex
  payment: X402Payment
}> {
  const accept = params.accept ?? selectX402Accept(params.challenge)
  const payment = buildX402Payment(accept)

  const txHash = await params.sendPayment(payment)
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error(`[keel-sdk] sendPayment must return a tx hash, got ${txHash}`)
  }
  if (params.waitForTransaction) await params.waitForTransaction(txHash)

  const unsigned = buildX402Payload({
    challenge: params.challenge,
    accepted: accept,
    txHash,
    method: params.method,
    url: params.url,
    salt: params.salt,
  })

  unsigned.signature = await params.signTypedData(buildX402TypedData(unsigned))
  return { header: encodePaymentSignature(unsigned), payload: unsigned, txHash, payment }
}

/** 供调试：把任意 32 字节值转成 x402 salt 形态 */
export function toX402Salt(value: bigint | number): Hex {
  return toHex(BigInt(value), { size: 32 })
}

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(encoded: string): string {
  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
