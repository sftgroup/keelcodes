import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isKeelApiError } from '@keelcodes/sdk'
import { TOOLS } from './tools.js'
import { callAction } from './actions.js'
import { PURCHASE_URL } from './client.js'
import { trackTelemetry } from './telemetry.js'
import { VERSION } from './version.js'

function isQuotaError(err: unknown): boolean {
  if (isKeelApiError(err)) {
    if (err.status === 429) return true
    const code = String(err.code || '').toUpperCase()
    return code.includes('QUOTA') || code.includes('INSUFFICIENT') || code.includes('LIMIT_EXCEEDED')
  }
  const message = err instanceof Error ? err.message : String(err)
  return /\b429\b|quota|insufficient|rate.?limit/i.test(message)
}

/** 把 SDK / 网络错误转成给 agent 的可读文本；额度类错误附带购买链接便于归因。 */
export function formatToolError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (isQuotaError(err)) {
    return [
      `Keel 额度不足或请求过多（429）：${message}`,
      '免费额度按模块、按 owner 计，每月自动重置。',
      `购买额度包（即时生效）：${PURCHASE_URL}`,
      '若是 agent 钱包的链上限额不足：升级到 L2 可提高限额 → npx @keelcodes/agent-wallet upgrade',
    ].join('\n')
  }
  return message
}

/** 构造本包的 MCP server（5 个只读量化数据工具）。 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: 'keel-quant', version: VERSION })
  for (const t of TOOLS) {
    server.tool(t.name, t.description, t.schema, async (args: Record<string, unknown>) => {
      try {
        const result = await callAction(t.action, args)
        trackTelemetry('activate')
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      } catch (err) {
        if (isQuotaError(err)) trackTelemetry('quota_exhausted')
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true }
      }
    })
  }
  return server
}
