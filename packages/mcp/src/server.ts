import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import crypto from 'node:crypto'
import { TOOLS } from './tools/index.js'
import { callAction } from './actions.js'
import {
  moduleOfUserKey,
  pickWalletHeaders,
  requestContext,
  type KeelModule,
} from './request-context.js'

/** 构造一个带全部 149 tools 的 MCP server（HTTP 无状态模式下每请求新建）。 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: 'keel', version: '1.4.0' })
  for (const t of TOOLS) {
    server.tool(t.name, t.description, t.schema, async (args: Record<string, unknown>) => {
      const result = await callAction(t.module, t.action, args)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    })
  }
  return server
}

// ── 入站鉴权（HTTP 模式）──
// 两种身份（A7.4）：
//   ① 运维白名单 `MCP_API_KEY`（逗号分隔，三 header 三选一）——内部/stdio 形态，出站用平台 key；
//   ② 用户自带 `sk_<module>_*`——per-user 身份，出站只用这把 key，网关按 owner 计量。
// `/health` 与 `/` 豁免；`MCP_ALLOW_USER_KEYS=off` 可关掉 ②（回到「只允许白名单」）。
const INBOUND_KEYS = (process.env.MCP_API_KEY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** 是否接受用户 `sk_<module>_*`（默认开：这是对外分发的前提）。 */
const ALLOW_USER_KEYS = (process.env.MCP_ALLOW_USER_KEYS || 'on').toLowerCase() !== 'off'

function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

function extractInboundKey(req: IncomingMessage): string {
  const auth = String(req.headers['authorization'] || '').trim()
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return String(req.headers['x-api-key'] || req.headers['x-service-key'] || '').trim()
}

interface InboundIdentity {
  userKey?: { key: string; module: KeelModule }
}

/** 解析入站身份；未通过鉴权返回 null。 */
function resolveIdentity(req: IncomingMessage): InboundIdentity | null {
  const key = extractInboundKey(req)
  if (!key) return null
  if (INBOUND_KEYS.some((k) => timingSafeEqualStr(k, key))) return {}
  if (!ALLOW_USER_KEYS) return null
  const module = moduleOfUserKey(key)
  // 形如 `sk_<module>_*` 即放行：真伪由网关（waas 校验）判定，假的会在下游拿 401。
  return module ? { userKey: { key, module } } : null
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** HTTP 传输（Streamable HTTP，无状态 + JSON 响应）：POST /mcp/message 处理 JSON-RPC。 */
export async function startHttpServer(port: number): Promise<Server> {
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js')
  if (INBOUND_KEYS.length === 0) {
    console.error(
      ALLOW_USER_KEYS
        ? '[keel-mcp] MCP_API_KEY 未配置 —— 仅接受用户 sk_<module>_*（per-user 身份）'
        : '[keel-mcp] WARN: MCP_API_KEY 未配置 —— HTTP 入站鉴权 fail-closed（全部 401）',
    )
  }
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', name: 'keel', transport: 'http', tools: TOOLS.length }))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 'METHOD_NOT_ALLOWED', message: 'POST /mcp/message' }))
      return
    }
    const identity = resolveIdentity(req)
    if (!identity) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          code: 'UNAUTHORIZED',
          message:
            '需要 sk_<module>_* API key（keel.codes 免费领取），或运维白名单 MCP_API_KEY',
        }),
      )
      return
    }
    try {
      const body = await readJsonBody(req)
      const server = buildServer()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => {
        transport.close()
        server.close()
      })
      await server.connect(transport)
      // 透传客户端钱包签名头 + 用户 key：仅对当前请求生效（无状态，不跨租户）。
      await requestContext.run(
        { walletHeaders: pickWalletHeaders(req.headers), userKey: identity.userKey },
        () => transport.handleRequest(req, res, body),
      )
    } catch (err) {
      console.error('[keel-mcp] request error:', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ code: 'INTERNAL', message: 'internal error' }))
      }
    }
  })
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, () => {
      console.error(`[keel-mcp] HTTP transport listening on :${port} (tools=${TOOLS.length})`)
      resolve()
    })
  })
  return httpServer
}
