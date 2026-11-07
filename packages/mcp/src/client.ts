import { createHash } from 'node:crypto'
import { Keel } from '@keelcodes/sdk'
import { mismatchedUserModule, userKeyFor, type KeelModule } from './request-context.js'

// ── 出站客户端：按模块选 key ──
// 网关对 /v1/<module>/* 强制 `Authorization: Bearer sk_<module>_*` 且模块 scope 严格匹配
// （projects/web/server.js verifyKeelKey）。聚合 MCP 跨 payment/wallet/data/account 四模块，
// 故按模块取 key：KEEL_API_KEY_PAYMENT / _WALLET / _DATA / _ACCOUNT，回退 KEEL_API_KEY（单模块 / 本地）。
export const KEEL_API_BASE = process.env.KEEL_API_BASE || 'https://keel.codes'
// 内部服务旁路（T1.3b）：keel-mcp 作为可信内部组件，以 X-Service-Key = KEEL_SERVICE_KEY
// 直连网关 /v1/<module>/*（跳过 sk_<module>_* 逐模块校验）；本地/单模块调试仍可用 KEEL_API_KEY_*。
export const KEEL_SERVICE_KEY = process.env.KEEL_SERVICE_KEY || undefined
export function moduleApiKey(module: string): string | undefined {
  return process.env[`KEEL_API_KEY_${module.toUpperCase()}`] || process.env.KEEL_API_KEY
}

// ── 钱包签名（account 自助面）──
// waas 要求 `x-wallet-address / x-wallet-timestamp / x-wallet-signature`（EIP-191，
// 消息 `Keel auth: <ts>`，旧前缀 `InfraX auth:` 服务端过渡期内仍接受）。MCP 不持有任何租户私钥：由客户端在 MCP 请求头自带，
// 经 request-context 透传给下游（见 actions.ts account 分支）。

/**
 * 公开端点专用客户端：不携带任何身份头。
 * 代播费自助面（settle-fees/balance、settle-fees/self-topup）由 payments 侧按
 * public-paths 放行，鉴权靠请求体里的 payTo 签名；若复用 `clientFor('payment')`，
 * 入站 key 属于其它模块（如 sk_wallet_*）时会被本地模块校验提前拒绝。
 */
export const publicClient = new Keel({ baseUrl: KEEL_API_BASE })

/** 运维/stdio 形态：按 env 配置出的固定客户端（无 per-user 身份）。 */
export const clients: Record<string, Keel> = {
  payment: new Keel({ baseUrl: KEEL_API_BASE, apiKey: moduleApiKey('payment'), serviceKey: KEEL_SERVICE_KEY }),
  wallet: new Keel({ baseUrl: KEEL_API_BASE, apiKey: moduleApiKey('wallet'), serviceKey: KEEL_SERVICE_KEY }),
  data: new Keel({ baseUrl: KEEL_API_BASE, apiKey: moduleApiKey('data'), serviceKey: KEEL_SERVICE_KEY }),
  account: new Keel({ baseUrl: KEEL_API_BASE, apiKey: moduleApiKey('account'), serviceKey: KEEL_SERVICE_KEY }),
}

/**
 * A7.4：按请求解析客户端。
 *
 * - 请求头带了用户 `sk_<module>_*` ⇒ **只用这个 key**（不带 serviceKey），
 *   网关会把它解析成 owner 并写入 `usage_counters`（A7.3/A11.3），实现逐用户计量；
 * - 否则回落到运维/stdio 的 env 客户端（内部或本地调试）。
 *
 * 密钥不同 ⇒ 客户端实例不能复用，这里按 `module + key 指纹` 缓存，避免每次工具调用重建。
 */
const userClients = new Map<string, Keel>()

function fingerprint(key: string): string {
  // 缓存键用 sha256：不能靠长度/短哈希，碰撞会把 A 用户的 key 用到 B 用户身上。
  return createHash('sha256').update(key).digest('hex')
}

export function clientFor(module: string): Keel {
  const mod = module as KeelModule
  const userKey = userKeyFor(mod)
  if (userKey) {
    const cacheKey = `${mod}:${fingerprint(userKey)}`
    const cached = userClients.get(cacheKey)
    if (cached) return cached
    const created = new Keel({ baseUrl: KEEL_API_BASE, apiKey: userKey })
    if (userClients.size >= 500) userClients.clear()
    userClients.set(cacheKey, created)
    return created
  }
  const other = mismatchedUserModule(mod)
  // account 面按钱包签名鉴权、不走 sk_ 闸门，因此不因 key 模块不匹配而拒绝。
  if (other && mod !== 'account') {
    // 明确告知：一个 key 只能调它所属模块，避免用户看到网关的 403 却不知原因。
    throw new Error(
      `当前 MCP 请求携带的是 ${other} 模块的 key，无法调用 ${mod} 工具；` +
        `请改用 sk_${mod}_* key，或在不带用户 key 的运维通道下调用`,
    )
  }
  return clients[mod] ?? clients.data
}
