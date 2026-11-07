import { Keel } from '@keelcodes/sdk'

// ── 出站客户端（发布包）──
// 只认可用户自带的 KEEL_API_KEY（sk_quant_*）；不读取任何平台级 / 服务级凭据。
export const KEEL_API_BASE = process.env.KEEL_API_BASE || 'https://keel.codes'
// 归因链（A8.8）：`module` 让定价页直接选中本包对应模块，`src` 随下单落库到 credit_orders.source。
export const PURCHASE_URL = 'https://keel.codes/pricing?module=quant&src=mcp-quant'
export const SUPPORT_EMAIL = 'support@keel.codes'

let client: Keel | undefined

/** 首次调用时惰性创建（便于未配置 key 时也能枚举工具）。 */
export function getClient(): Keel {
  if (!client) {
    const apiKey = process.env.KEEL_API_KEY
    if (!apiKey) throw new Error(missingApiKeyMessage())
    client = new Keel({ baseUrl: KEEL_API_BASE, apiKey })
  }
  return client
}

export function missingApiKeyMessage(): string {
  return [
    '[keel-mcp-quant] KEEL_API_KEY 未配置。',
    '',
    '请先到 https://keel.codes 领取免费 API key（免费额度按模块、按 owner 计，每月自动重置）。',
    '',
    '临时运行：',
    '  KEEL_API_KEY=sk_quant_xxx npx @keelcodes/mcp-quant',
    '',
    'MCP 客户端配置（Claude Desktop / Cursor 等）：',
    '  "env": { "KEEL_API_KEY": "sk_quant_xxx" }',
    '',
    `需要帮助？${SUPPORT_EMAIL}`,
  ].join('\n')
}

/** stdio 入口启动校验：缺 key 时打印可操作提示并以非 0 退出。 */
export function assertApiKey(): void {
  if (process.env.KEEL_API_KEY && process.env.KEEL_API_KEY.trim()) return
  console.error(missingApiKeyMessage())
  process.exit(1)
}
