// ---------------------------------------------------------------------------
// Session 创建授权（owner 签名）—— 与 aa-relay / @0xinfrax/aa-sdk 的
// `sessionConsentMessage()` 逐字符一致（服务端用它复算消息并 recover 地址）。
//
// 用途：B 端后端在调用 `wallet.session.create` 前，让终端用户钱包对
// `keelSessionConsentMessage(...)` 做 EIP-191 personal_sign，把签名作为
// `ownerSignature` 一起提交（relay 默认强制校验）。
//
// ⚠️ 本文件是规范文本的**镜像实现**（SDK 不依赖内部 aa-sdk 包）。改动任何一行
//    字段顺序/大小写都必须同步 aa-sdk 的 session-consent.ts，否则验签失败。
// ---------------------------------------------------------------------------

export const KEEL_SESSION_CONSENT_VERSION = 1

/** 授权消息绑定字段（两种模式互斥：permissions+validUntil 或 template） */
export interface KeelSessionConsentFields {
  owner: string
  product: string
  chain: string
  /** 限额模板名（金额与有效期由服务端模板决定） */
  template?: string
  permissions?: Array<Record<string, unknown>>
  validUntil?: number | string
  validAfter?: number | string
  /** 签发时间（ms，防重放；relay 只接受 5 分钟内的授权） */
  issuedAt: number
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v === undefined) continue
      out[key] = canonicalize(v)
    }
    return out
  }
  return value
}

/** 构造 owner 需签名的授权文本（EIP-191 消息原文） */
export function keelSessionConsentMessage(fields: KeelSessionConsentFields): string {
  const lines = [
    `Keel session consent v${KEEL_SESSION_CONSENT_VERSION}`,
    `owner: ${String(fields.owner).toLowerCase()}`,
    `product: ${fields.product}`,
    `chain: ${fields.chain}`,
  ]
  if (fields.template) {
    lines.push(`template: ${fields.template}`)
  } else {
    lines.push(`validAfter: ${String(fields.validAfter ?? 0)}`)
    lines.push(`validUntil: ${String(fields.validUntil)}`)
  }
  lines.push(`issuedAt: ${fields.issuedAt}`)
  if (!fields.template) {
    lines.push(`permissions: ${JSON.stringify(canonicalize(fields.permissions ?? []))}`)
  }
  return lines.join('\n')
}
