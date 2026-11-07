import { AsyncLocalStorage } from 'node:async_hooks'
import type { IncomingHttpHeaders } from 'node:http'

/** 钱包签名三头（waas account/wallet 自助面鉴权）。 */
const WALLET_HEADER_KEYS = ['x-wallet-address', 'x-wallet-timestamp', 'x-wallet-signature'] as const

/** keel 用户 key 的模块前缀（`sk_<module>_*`，由 account 模块签发）。 */
export const KEEL_MODULES = ['payment', 'wallet', 'data', 'account'] as const
export type KeelModule = (typeof KEEL_MODULES)[number]

/** 从入站 key 解析模块；不是 `sk_<module>_*` 形状则返回 null。 */
export function moduleOfUserKey(key: string): KeelModule | null {
  const m = /^sk_([a-z]+)_/.exec(key)
  if (!m) return null
  return (KEEL_MODULES as readonly string[]).includes(m[1]) ? (m[1] as KeelModule) : null
}

export interface RequestContext {
  /** 客户端透传的钱包签名头；缺任一头则为 undefined。 */
  walletHeaders?: Record<string, string>
  /**
   * A7.4：调用方自带的 `sk_<module>_*`（per-user 身份）。
   * 存在时该模块的出站请求只带这个 key、**不再**注入平台 `KEEL_SERVICE_KEY`，
   * 从而由网关按 key → owner 逐用户计量。
   */
  userKey?: { key: string; module: KeelModule }
}

/** 请求级上下文：无状态 HTTP 模式下每个 MCP 请求独立，避免跨请求串租户。 */
export const requestContext = new AsyncLocalStorage<RequestContext>()

/** 从入站请求头提取完整的钱包签名三头。 */
export function pickWalletHeaders(headers: IncomingHttpHeaders): Record<string, string> | undefined {
  const picked: Record<string, string> = {}
  for (const key of WALLET_HEADER_KEYS) {
    const value = headers[key]
    if (typeof value !== 'string' || !value) return undefined
    picked[key] = value
  }
  return picked
}

/** 当前请求透传的钱包签名头（无则为 undefined）。 */
export function walletHeaders(): Record<string, string> | undefined {
  return requestContext.getStore()?.walletHeaders
}

/** 当前请求携带的用户 key（仅当 key 的模块与目标模块一致时返回）。 */
export function userKeyFor(module: KeelModule): string | undefined {
  const issued = requestContext.getStore()?.userKey
  return issued && issued.module === module ? issued.key : undefined
}

/** 当前请求是否带了「别的模块」的用户 key（用于给出可操作错误）。 */
export function mismatchedUserModule(module: KeelModule): KeelModule | undefined {
  const issued = requestContext.getStore()?.userKey
  return issued && issued.module !== module ? issued.module : undefined
}

/** account 自助面要求客户端签名；缺失时给出可操作的错误。 */
export function requireWalletHeaders(): Record<string, string> {
  const headers = walletHeaders()
  if (!headers) {
    throw new Error(
      'account 工具需要客户端钱包签名：请在 MCP HTTP 请求头携带 ' +
        'x-wallet-address / x-wallet-timestamp / x-wallet-signature ' +
        '（签名消息为 "Keel auth: <timestamp>"，EIP-191）',
    )
  }
  return headers
}
