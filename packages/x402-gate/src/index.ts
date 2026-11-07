/**
 * x402 v2 资源网关（标准 exact：EIP-3009 / Permit2）
 *
 * 让任意对外接口在没有平台 API Key 时也接受 agent 的 x402 付款。
 * 鉴权优先级（命中即停）：
 *   1. 已有平台凭证（Authorization / X-API-Key / X-Service-Key）→ 放行
 *   2. 无付款凭证 → 402；响应体降级为 v1 结构供老客户端读取，`PAYMENT-REQUIRED` 头为 v2
 *   3. 有 `PAYMENT-SIGNATURE`（或 v1 的 `X-PAYMENT`）→ 调支付引擎 `/x402/settle`
 *      （Keel 轨走 `/x402/verify`）→ 200 + `PAYMENT-RESPONSE`（同时回 v1 的 `X-PAYMENT-RESPONSE`）
 *
 * 本包不持私钥、不接触链，只依赖全局 fetch 与 Web 标准 API，因此可以跑在
 * Node / Next.js App Router（含 edge runtime）/ Cloudflare Workers。
 *
 * 多 accept：同时给出 EIP-3009 与 Permit2，客户端按自身能力选择；服务端把完整
 * 挑战（`accepts[]`）转发给支付引擎，由引擎按载荷匹配。
 */

/** canonical Permit2（各链同址） */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
/** canonical x402 exact over Permit2 代理（spender，资金只流向 witness.to） */
export const X402_EXACT_PERMIT2_PROXY = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001'

export interface X402Accept {
  scheme: 'exact'
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra?: Record<string, unknown>
}

export interface X402PaymentRequired {
  x402Version: 2
  error?: string
  resource: {
    url: string
    description?: string
    mimeType?: string
    serviceName?: string
    tags?: string[]
    iconUrl?: string
  }
  accepts: X402Accept[]
  /** Bazaar 扩展（x402 v2 §extensions/bazaar）：让 facilitator 能索引本资源 */
  extensions?: { bazaar: { info: Record<string, unknown>; schema?: Record<string, unknown> } }
  /**
   * 非标准扩展：给「按次太贵，买包更便宜」的引导链接。
   * 标准客户端会忽略未知字段，不影响验签与结算。
   */
  links?: X402Link[]
}

export interface X402Link {
  /** 目前只用 `purchase`：引导到额度包购买页 */
  rel: 'purchase'
  href: string
  title?: string
}

/** 资源元数据（写进 402 的 resource，供目录/agent 读取） */
export interface X402ResourceMeta {
  description?: string
  mimeType?: string
  serviceName?: string
  tags?: string[]
  iconUrl?: string
}

/** Bazaar 扩展内容：input/output 由服务方声明，缺 schema 时 facilitator 按 info 索引 */
export interface X402BazaarExtension {
  info: Record<string, unknown>
  schema?: Record<string, unknown>
}

/** 免费额度（B13.3）：每个调用方在一个窗口内前 N 次直接放行，之后转 402 */
export interface X402FreeQuota {
  calls: number
  /** 窗口长度；缺省按 period 推（day=24h / month=30d） */
  windowMs?: number
  period?: 'day' | 'month'
  /** 调用方标识（缺省用 req.ip；同一 key 共享额度） */
  key?: (req: GateRequest) => string
  now?: () => number
}

/** 单个可收款资产：EIP-3009 或 Permit2，二选一。 */
export interface X402GateAccept {
  /** CAIP-2，如 eip155:8453 */
  network: string
  /** ERC-20 合约 */
  asset: string
  /** 覆盖单次价格（缺省用 amount / amountFor） */
  amount?: string
  /** 覆盖收款地址（缺省用顶层 payTo） */
  payTo?: string
  maxTimeoutSeconds?: number
  /** EIP-3009 域；有 `domainName` 的代币（如 Base USDC）走这条 */
  eip3009?: { name: string; version: string }
  /** 启用 Permit2（任意 ERC-20，含 BSC USDT/USDC 与智能账户） */
  permit2?: boolean | { address?: string; proxy?: string }
}

export interface X402GateOptions {
  /** 支付引擎基础地址，如 https://keel.codes/v1/payment */
  paymentsUrl: string
  /** 支付引擎鉴权（Bearer） */
  paymentsKey?: string
  /** 单 accept 简写 */
  payTo?: string
  network?: string
  asset?: string
  amount?: string
  domain?: { name: string; version: string }
  /** 多 accept（优先于上面的简写） */
  accepts?: X402GateAccept[]
  /** 命中这些路径前缀的请求不收费（探针/文档） */
  exempt?: string[]
  /** 按请求覆盖价格（最小单位）；返回 null 表示不收费。A7.9.3：第二参可读 query 做 limit 阶梯 */
  amountFor?: (path: string, req: GateRequest) => string | null
  /** 额外视为「已有平台凭证」的请求头（如 x-tenant-id） */
  passthroughHeaders?: string[]
  /** 资源元数据（写进 402 的 resource；B13.1 目录展示用） */
  resource?: X402ResourceMeta
  /** Bazaar 扩展（写进 402；B13.2 让 facilitator 自动索引） */
  bazaar?: X402BazaarExtension
  /** 免费额度（B13.3）：窗口内前 N 次不收费 */
  freeQuota?: X402FreeQuota
  /**
   * 购买引导链接（写进 402 的 `links`，A7.1）：按次单价通常高于包内均价，
   * 用这个字段告诉 agent/用户「买额度包更便宜」。返回 null 表示该路径不给链接。
   */
  purchaseUrl?: string | ((path: string) => string | null)
  /** 结算超时（毫秒，默认 15s） */
  timeoutMs?: number
  log?: (msg: string) => void
}

/** 框架无关的请求视图 */
export interface GateRequest {
  path: string
  url: string
  header: (name: string) => string | null
  /** 查询串（A7.9.3：`amountFor` 按 `limit` 阶梯计价用） */
  query?: URLSearchParams
  /** 调用方地址（免费额度分桶用；缺省视为同一桶） */
  ip?: string
}

export type GateResult =
  | { action: 'pass'; headers?: Record<string, string> }
  | { action: 'challenge'; status: number; headers: Record<string, string>; body: unknown }

const KEY_HEADERS = ['authorization', 'x-api-key', 'x-service-key']
const DEFAULT_EXEMPT = ['/health', '/metrics']

// ── base64（Node 与 edge runtime 通用，不依赖 Buffer）───────────────────────
export function encodeBase64Json(obj: unknown): string {
  const json = JSON.stringify(obj)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function decodeBase64Json(input: string): unknown {
  const binary = atob(input)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

/**
 * 把「单 accept 简写」与「多 accept」统一展开。
 * 有 `eip3009` 用 EIP-3009 extra；有 `permit2` 用 Permit2 extra；都没给则按 EIP-3009
 * 无域输出（兼容老服务：只靠 `amount` 覆盖价格的场景）。
 */
export function buildAccepts(opts: X402GateOptions, amount: string): X402Accept[] {
  if (opts.accepts?.length) {
    return opts.accepts.map((a) => {
      const target = a.payTo ?? opts.payTo
      if (!target) throw new Error('x402 gate: payTo is required (top-level or per accept)')
      const priced = a.amount ?? amount
      if (!priced) throw new Error('x402 gate: every accept needs an `amount` (or a top-level amount)')
      const base: X402Accept = {
        scheme: 'exact',
        network: a.network,
        amount: priced,
        asset: a.asset,
        payTo: target,
        maxTimeoutSeconds: a.maxTimeoutSeconds ?? 300,
      }
      if (a.permit2) {
        const cfg = typeof a.permit2 === 'object' ? a.permit2 : {}
        return {
          ...base,
          extra: {
            assetTransferMethod: 'permit2',
            permit2Address: cfg.address ?? PERMIT2_ADDRESS,
            permit2Proxy: cfg.proxy ?? X402_EXACT_PERMIT2_PROXY,
          },
        }
      }
      const domain = a.eip3009 ?? opts.domain
      return domain ? { ...base, extra: { name: domain.name, version: domain.version } } : base
    })
  }

  if (!opts.payTo || !opts.network || !opts.asset) {
    throw new Error('x402 gate: payTo / network / asset are required when `accepts` is not set')
  }
  return [
    {
      scheme: 'exact',
      network: opts.network,
      amount,
      asset: opts.asset,
      payTo: opts.payTo,
      maxTimeoutSeconds: 300,
      ...(opts.domain ? { extra: { name: opts.domain.name, version: opts.domain.version } } : {}),
    },
  ]
}

/** 402 挑战（标准 v2）——`resource` 带上服务元数据，`extensions.bazaar` 供 facilitator 索引。 */
export function buildChallenge(
  opts: X402GateOptions,
  url: string,
  amount: string,
  path?: string
): X402PaymentRequired {
  const challenge: X402PaymentRequired = {
    x402Version: 2,
    resource: { url, ...(opts.resource ?? {}) },
    accepts: buildAccepts(opts, amount),
  }
  if (opts.bazaar) challenge.extensions = { bazaar: opts.bazaar }
  const purchase = typeof opts.purchaseUrl === 'function'
    ? (path ? opts.purchaseUrl(path) : null)
    : opts.purchaseUrl
  if (purchase) {
    challenge.links = [{ rel: 'purchase', href: purchase, title: 'Buy a credit pack (cheaper per call)' }]
  }
  return challenge
}

// ── x402 v1 兼容（B15.3）────────────────────────────────────────────────────
// v1 客户端不会读 `PAYMENT-REQUIRED` 头，只看 402 响应体；并按短网络名匹配
// （`base` 而非 `eip155:8453`）。因此响应体降级成 v1 结构，请求侧再接受 `X-PAYMENT`。
const V1_NETWORK_NAMES: Record<string, string> = {
  'eip155:1': 'ethereum',
  'eip155:11155111': 'sepolia',
  'eip155:8453': 'base',
  'eip155:84532': 'base-sepolia',
  'eip155:56': 'bsc',
  'eip155:97': 'bsc-testnet',
  'eip155:137': 'polygon',
  'eip155:43114': 'avalanche',
  'eip155:10': 'optimism',
  'eip155:42161': 'arbitrum',
}

/** CAIP-2 → v1 短网络名；未知网络原样返回（v1 客户端自然不支持）。 */
export function toV1Network(network: string): string {
  return V1_NETWORK_NAMES[network] ?? network
}

/**
 * v2 挑战 → v1 `PaymentRequirementsResponse`（v1 把 resource/description/mimeType
 * 放在每个 accept 内，金额字段叫 `maxAmountRequired`）。
 */
export function toV1Challenge(challenge: X402PaymentRequired): Record<string, unknown> {
  const resource = challenge.resource
  return {
    x402Version: 1,
    ...(challenge.error ? { error: challenge.error } : {}),
    accepts: challenge.accepts.map((a) => ({
      scheme: a.scheme,
      network: toV1Network(a.network),
      maxAmountRequired: a.amount,
      resource: resource.url,
      ...(resource.description ? { description: resource.description } : {}),
      mimeType: resource.mimeType ?? 'application/json',
      payTo: a.payTo,
      maxTimeoutSeconds: a.maxTimeoutSeconds,
      asset: a.asset,
      ...(a.extra ? { extra: a.extra } : {}),
    })),
  }
}

/** 读付款凭证：v2 的 `PAYMENT-SIGNATURE` 优先，回退 v1 的 `X-PAYMENT`。 */
function paymentSignature(req: GateRequest): string | undefined {
  return (req.header('payment-signature') ?? req.header('x-payment'))?.trim() || undefined
}

// ── 免费额度（B13.3）─────────────────────────────────────────────────────────
// 每个调用方在窗口内前 N 次直接放行；窗口滚动（不按自然日重置）。
// 额度按「服务命名空间 + 调用方」分桶，避免同进程内多个资源服务互相占用。
interface QuotaBucket {
  count: number
  windowStart: number
}

const quotaBuckets = new Map<string, QuotaBucket>()

/** 仅用于测试/运维：清空内存额度。 */
export function resetFreeQuota(): void {
  quotaBuckets.clear()
}

function quotaWindowMs(q: X402FreeQuota): number {
  if (q.windowMs && q.windowMs > 0) return q.windowMs
  return q.period === 'month' ? 30 * 24 * 3_600_000 : 24 * 3_600_000
}

function consumeFreeQuota(
  opts: X402GateOptions,
  req: GateRequest,
  now: number
): { allowed: boolean; remaining: number } {
  const q = opts.freeQuota!
  const ns = opts.resource?.serviceName ?? opts.payTo ?? opts.accepts?.[0]?.payTo ?? 'x402'
  const caller = q.key ? q.key(req) : req.ip ?? 'anonymous'
  const key = `${ns}\u0000${caller}`
  const win = quotaWindowMs(q)
  const bucket = quotaBuckets.get(key)
  if (!bucket || now - bucket.windowStart >= win) {
    quotaBuckets.set(key, { count: 1, windowStart: now })
    return { allowed: q.calls > 0, remaining: Math.max(0, q.calls - 1) }
  }
  if (bucket.count >= q.calls) return { allowed: false, remaining: 0 }
  bucket.count += 1
  return { allowed: true, remaining: Math.max(0, q.calls - bucket.count) }
}

/**
 * Keel 轨（legacy verifyOnly）：客户端先广播转账，载荷里带 `txHash`。
 * 这类请求走 `/x402/verify`（验链上凭证），而不是 `/x402/settle`（代广播）。
 */
export function legacyTxHash(header: string): string | null {
  try {
    const body = decodeBase64Json(header) as { payload?: { txHash?: unknown } }
    const txHash = body?.payload?.txHash
    return typeof txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(txHash) ? txHash : null
  } catch {
    return null
  }
}

function hasPlatformCredential(req: GateRequest, extra: string[]): boolean {
  return [...KEY_HEADERS, ...extra].some((h) => {
    const v = req.header(h)
    return typeof v === 'string' && v.trim().length > 0
  })
}

/**
 * B5.1：透传调用方身份头，供支付引擎按 `key:<hash>` / `agent:<id>` 做预算主体。
 * 只转发这两个命名空间内的头，并裁剪长度。
 */
function identityHeaders(req: GateRequest): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of ['x-keel-key-id', 'x-keel-agent-id']) {
    const value = (req.header(name) ?? '').trim()
    if (value) out[name] = value.slice(0, 256)
  }
  return out
}

interface SettleResult {
  success?: boolean
  isValid?: boolean
  transaction?: string
  network?: string
  payer?: string
  amount?: string
  errorReason?: string
  invalidReason?: string
  message?: string
  code?: string
}

/**
 * 本次调用的价格（最小单位）。
 * 优先级：`amountFor(path, req)` > 顶层 `amount` > 第一个带价格的 accept。
 * 只配 `accepts`（多币种）而不写顶层 `amount` 是文档里的标准用法，必须从 accept 取价，
 * 否则 `amount` 为 undefined 会命中下面的「不收费」分支，等于整站免费。
 */
function resolveAmount(opts: X402GateOptions): string | undefined {
  return opts.amount ?? opts.accepts?.find((a) => a.amount)?.amount
}

/**
 * 网关核心：返回「放行」或「402 挑战」，与框架无关。
 * 结算失败一律 402（携带原因），避免把上游错误变成 500。
 */
export async function authorizeX402(
  opts: X402GateOptions,
  req: GateRequest
): Promise<GateResult> {
  const exempt = [...DEFAULT_EXEMPT, ...(opts.exempt ?? [])]
  if (exempt.some((e) => req.path === e || req.path.startsWith(e))) return { action: 'pass' }
  if (hasPlatformCredential(req, opts.passthroughHeaders ?? [])) return { action: 'pass' }

  const amount = opts.amountFor ? opts.amountFor(req.path, req) : resolveAmount(opts)
  // `amountFor` 返回 null = 该路径明确免费；但「压根没配价格」必须报错，
  // 不能静默放行（否则漏配一个 amount 就等于整站免费）。
  if (amount === null) return { action: 'pass' }
  if (!amount) throw new Error('x402 gate: no price configured (set `amount` or a priced accept)')

  const signature = paymentSignature(req)

  // 免费额度：只对「本来要收费、且没带付款凭证」的请求计数；已付款的正常走结算。
  if (opts.freeQuota && !signature) {
    const now = opts.freeQuota.now?.() ?? Date.now()
    const quota = consumeFreeQuota(opts, req, now)
    if (quota.allowed) {
      return { action: 'pass', headers: { 'X-Free-Quota-Remaining': String(quota.remaining) } }
    }
  }

  const challenge = buildChallenge(opts, req.url, amount, req.path)
  const required = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    'PAYMENT-REQUIRED': encodeBase64Json(challenge),
  })

  if (!signature) {
    challenge.error = opts.freeQuota
      ? 'free quota exhausted; payment signature is required (X-PAYMENT or PAYMENT-SIGNATURE)'
      : 'payment signature is required (X-PAYMENT or PAYMENT-SIGNATURE)'
    return { action: 'challenge', status: 402, headers: required(), body: toV1Challenge(challenge) }
  }

  const base = opts.paymentsUrl.replace(/\/+$/, '')
  const txHash = legacyTxHash(signature)
  try {
    const resp = await fetch(`${base}${txHash ? '/x402/verify' : '/x402/settle'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.paymentsKey ? { Authorization: `Bearer ${opts.paymentsKey}` } : {}),
        ...identityHeaders(req),
      },
      // 转发完整挑战：引擎按载荷在 `accepts[]` 中匹配（EIP-3009 / Permit2）。
      body: JSON.stringify({ paymentPayload: signature, paymentRequirements: challenge }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(opts.timeoutMs ?? 15_000)
        : undefined,
    })
    const result = (await resp.json().catch(() => ({}))) as SettleResult

    // Keel 轨：交易已由客户端广播，验通过即放行；回执带客户端给的 txHash。
    if (txHash) {
      if (!resp.ok || result.isValid !== true) {
        challenge.error = result.invalidReason || result.errorReason || result.message || `verification failed (${resp.status})`
        opts.log?.(`x402 gate: verify rejected ${req.path} → ${challenge.error}`)
        return { action: 'challenge', status: 402, headers: required(), body: toV1Challenge(challenge) }
      }
      const receipt = {
        success: true,
        transaction: txHash,
        network: result.network ?? challenge.accepts[0]?.network,
        payer: result.payer,
        amount,
      }
      return {
        action: 'pass',
        headers: {
          'PAYMENT-RESPONSE': encodeBase64Json(receipt),
          // v1 回执头：老客户端只读这个，network 用短名
          'X-PAYMENT-RESPONSE': encodeBase64Json({ ...receipt, network: toV1Network(receipt.network ?? '') }),
        },
      }
    }

    if (!resp.ok || !result.success) {
      challenge.error = result.errorReason || result.invalidReason || result.message || `settlement failed (${resp.status})`
      opts.log?.(`x402 gate: settle rejected ${req.path} → ${challenge.error}`)
      return { action: 'challenge', status: 402, headers: required(), body: toV1Challenge(challenge) }
    }
    const receipt = {
      success: true,
      transaction: result.transaction,
      network: result.network,
      payer: result.payer,
      amount: result.amount ?? amount,
    }
    return {
      action: 'pass',
      headers: {
        'PAYMENT-RESPONSE': encodeBase64Json(receipt),
        // v1 回执头：老客户端只读这个，network 用短名
        'X-PAYMENT-RESPONSE': encodeBase64Json({ ...receipt, network: toV1Network(receipt.network ?? '') }),
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'settlement unavailable'
    opts.log?.(`x402 gate: settle error ${req.path} → ${message}`)
    challenge.error = 'payment settlement unavailable, retry shortly'
    return { action: 'challenge', status: 402, headers: required(), body: toV1Challenge(challenge) }
  }
}

/** Express / Connect 适配器 */
export function createX402Gate(opts: X402GateOptions) {
  return async function x402Gate(req: any, res: any, next: any): Promise<void> {
    const path: string = req.path || '/'
    const url = `${req.protocol || 'https'}://${req.get?.('host') || 'localhost'}${req.originalUrl || path}`
    const result = await authorizeX402(opts, {
      path,
      url,
      ip: typeof req.ip === 'string' ? req.ip : undefined,
      header: (name) => {
        const v = req.headers?.[name]
        return Array.isArray(v) ? v[0] ?? null : v ?? null
      },
    })
    if (result.action === 'pass') {
      for (const [k, v] of Object.entries(result.headers ?? {})) res.set(k, v)
      next()
      return
    }
    for (const [k, v] of Object.entries(result.headers)) res.set(k, v)
    res.status(result.status).json(result.body)
  }
}

/** Fetch 处理器（Next.js App Router / Workers 同形） */
export type FetchHandler = (request: Request) => Promise<Response> | Response

/**
 * 包装一个 Fetch 处理器：未付款 → 402；已付款/有平台凭证 → 原处理器。
 *
 * ```ts
 * // app/api/quote/route.ts
 * export const GET = withX402(opts, async () => Response.json({ price: 42 }))
 * ```
 */
export function withX402(opts: X402GateOptions, handler: FetchHandler): FetchHandler {
  return async (request: Request): Promise<Response> => {
    const url = request.url
    const parsed = new URL(url)
    const result = await authorizeX402(opts, {
      path: parsed.pathname,
      url,
      query: parsed.searchParams,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      header: (name) => request.headers.get(name),
    })
    if (result.action === 'pass') {
      const response = await handler(request)
      for (const [k, v] of Object.entries(result.headers ?? {})) response.headers.set(k, v)
      return response
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: result.headers,
    })
  }
}
