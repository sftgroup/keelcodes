// ---------------------------------------------------------------------------
// x402 v2 · Solana（verifyOnly）客户端
//
// 结算模型与 EVM 一致：客户端自己广播 SOL 转账，服务端只做「验签 + 链上校验 +
// 入账」，没有 facilitator `/settle`。
//
// 与 payments 服务端（`protocol/x402-v2.ts`）逐字节对齐：
//   message = ["x402-solana-v2", scheme, network, amount, asset, payTo,
//              method, url, salt, txHash].join("\n")
//   header  = base64(JSON({ x402Version, resource, accepted,
//                 payload:{method,url,salt,txHash,payer}, signature }))
//
// EVM 用 EIP-712 把「accepted + payload」绑定到付款人；SVM 没有等价的结构化
// 签名，改用 ed25519 对上面这条确定性消息签名，payer 由 `payload.payer` 显式给出
// （ed25519 无法从签名恢复公钥），服务端再用该公钥验签 + 校验链上同址。
// ---------------------------------------------------------------------------

import { toBase64 } from './x402'
import type { X402Accept, X402PaymentRequired, X402ResourceInfo } from './x402'

/** CAIP-2 Solana network 前缀（如 `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`）。 */
export const SOLANA_NETWORK_PREFIX = 'solana:'
/** Solana x402 签名域分隔标签。 */
export const SOLANA_X402_DOMAIN = 'x402-solana-v2'
/** Solana 原生资产标签（与账本 `asset` 列一致，金额单位为 lamports）。 */
export const SOLANA_X402_ASSET = 'sol'

export interface X402SolanaPaymentPayload {
  x402Version: 2
  resource?: X402ResourceInfo
  accepted: X402Accept
  payload: {
    method: string
    url: string
    /** 重放保护随机串（字符串即可；缺省由 txHash + 时间派生） */
    salt: string
    /** 链上付款交易签名（base58） */
    txHash: string
    /** 付款人公钥（base58） */
    payer: string
  }
  extensions?: Record<string, unknown>
  /** base58(ed25519 signature, 64B) */
  signature: string
}

/** 链上付款参数：向 `to` 转 `lamports`，原生 SOL。 */
export interface X402SolanaPayment {
  to: string
  lamports: bigint
  asset: typeof SOLANA_X402_ASSET
}

/**
 * Solana 会话签名器：只需公钥 + 对原始消息签名。
 * 私钥始终留在客户端（session key / 智能账户），SDK 不接触。
 */
export interface X402SolanaSigner {
  /** base58 公钥（= payload.payer） */
  publicKey: string
  /** 返回 64B 签名：Uint8Array 或 base58 字符串 */
  signMessage(message: Uint8Array): Promise<Uint8Array | string>
}

export interface PayX402WithSolanaParams {
  challenge: X402PaymentRequired
  /** 不传则自动选第一个 Solana accept */
  accept?: X402Accept
  /** 发起链上转账并返回交易签名（base58） */
  sendPayment: (payment: X402SolanaPayment) => Promise<{ signature: string; payer?: string }>
  signer: X402SolanaSigner
  /** 等交易确认（建议传入，避免服务端校验时还查不到） */
  waitForConfirmation?: (signature: string) => Promise<unknown>
  method?: string
  url?: string
  salt?: string
}

export interface PayX402WithSolanaResult {
  /** 可直接写入 `PAYMENT-SIGNATURE` 头 */
  header: string
  payload: X402SolanaPaymentPayload
  /** 链上付款交易签名（= payload.payload.txHash） */
  txHash: string
  payment: X402SolanaPayment
  accept: X402Accept
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** base58 编码（仅用于把 64B ed25519 签名转成 wire 形态）。 */
export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  const digits: number[] = []
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let out = '1'.repeat(zeros)
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]]
  return out
}

export function isSolanaAccept(accept: X402Accept): boolean {
  return (
    String(accept.network ?? '').startsWith(SOLANA_NETWORK_PREFIX) &&
    String(accept.asset ?? '').toLowerCase() === SOLANA_X402_ASSET
  )
}

/** 选 Solana accept：优先 exact；可按 network 精确过滤。 */
export function selectSolanaAccept(
  challenge: X402PaymentRequired,
  opts: { network?: string } = {},
): X402Accept {
  const matches = challenge.accepts.filter(
    (a) => isSolanaAccept(a) && (opts.network === undefined || a.network === opts.network),
  )
  const pick = matches.find((a) => a.scheme === 'exact') ?? matches[0]
  if (!pick) throw new Error('[keel-sdk] no Solana accept in this x402 challenge')
  return pick
}

/** 按 accept 组装转账参数（原生 SOL）。 */
export function buildSolanaX402Payment(accept: X402Accept): X402SolanaPayment {
  if (!isSolanaAccept(accept)) {
    throw new Error(`[keel-sdk] accept is not Solana native: ${accept.network}/${accept.asset}`)
  }
  const lamports = BigInt(accept.amount)
  if (lamports <= 0n) throw new Error('[keel-sdk] x402 amount must be > 0')
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(accept.payTo)) {
    throw new Error(`[keel-sdk] invalid Solana payTo: ${accept.payTo}`)
  }
  return { to: accept.payTo, lamports, asset: SOLANA_X402_ASSET }
}

/** 构造待签消息（必须与 payments `buildSolanaPaymentMessage` 逐字节一致）。 */
export function buildSolanaX402Message(payload: X402SolanaPaymentPayload): Uint8Array {
  const { accepted } = payload
  return new TextEncoder().encode(
    [
      SOLANA_X402_DOMAIN,
      accepted.scheme,
      accepted.network,
      accepted.amount,
      accepted.asset,
      accepted.payTo,
      payload.payload.method,
      payload.payload.url,
      payload.payload.salt,
      payload.payload.txHash,
    ].join('\n'),
  )
}

/** 由链上付款结果构造未签名的 payload。 */
export function buildSolanaX402Payload(args: {
  challenge: X402PaymentRequired
  accepted: X402Accept
  txHash: string
  payer: string
  method?: string
  url?: string
  salt?: string
}): X402SolanaPaymentPayload {
  return {
    x402Version: 2,
    resource: args.challenge.resource,
    accepted: args.accepted,
    payload: {
      method: args.method ?? 'GET',
      url: args.url ?? args.challenge.resource?.url ?? '',
      salt: args.salt ?? `${args.txHash}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      txHash: args.txHash,
      payer: args.payer,
    },
    signature: '',
  }
}

/**
 * 用 Solana 会话密钥签 x402 payload，返回 base58 签名。
 * 写入 `payload.signature` 后即可 base64 成 `PAYMENT-SIGNATURE`。
 */
export async function signX402WithSolanaSession(
  payload: X402SolanaPaymentPayload,
  signer: X402SolanaSigner,
): Promise<string> {
  if (payload.payload.payer !== signer.publicKey) {
    throw new Error('[keel-sdk] payload.payer does not match the signing publicKey')
  }
  const raw = await signer.signMessage(buildSolanaX402Message(payload))
  const sig = typeof raw === 'string' ? raw : encodeBase58(raw)
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(sig)) {
    throw new Error('[keel-sdk] signMessage must return a 64-byte ed25519 signature')
  }
  return sig
}

/** 把已签名的 payload 编码成 `PAYMENT-SIGNATURE` 头。 */
export function encodeSolanaPaymentSignature(payload: X402SolanaPaymentPayload): string {
  return toBase64(JSON.stringify(payload))
}

/**
 * 一次完成「链上转账 → 等确认 → x402 凭证签名」。
 * 转账由调用方注入（可用 aa-relay `/solana/submit` 广播，gas 可垫付）。
 */
export async function payX402WithSolana(
  params: PayX402WithSolanaParams,
): Promise<PayX402WithSolanaResult> {
  const accept = params.accept ?? selectSolanaAccept(params.challenge)
  const payment = buildSolanaX402Payment(accept)

  const sent = await params.sendPayment(payment)
  const txHash = String(sent?.signature ?? '').trim()
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(txHash)) {
    throw new Error(`[keel-sdk] sendPayment must return a base58 tx signature, got ${txHash}`)
  }
  const payer = String(sent.payer ?? params.signer.publicKey)
  if (payer !== params.signer.publicKey) {
    throw new Error('[keel-sdk] sendPayment payer differs from the x402 signing key')
  }
  if (params.waitForConfirmation) await params.waitForConfirmation(txHash)

  const unsigned = buildSolanaX402Payload({
    challenge: params.challenge,
    accepted: accept,
    txHash,
    payer,
    method: params.method,
    url: params.url,
    salt: params.salt,
  })
  unsigned.signature = await signX402WithSolanaSession(unsigned, params.signer)

  return {
    header: encodeSolanaPaymentSignature(unsigned),
    payload: unsigned,
    txHash,
    payment,
    accept,
  }
}
