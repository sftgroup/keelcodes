import { z } from 'zod'

export interface ToolDef {
  name: string
  description: string
  module: 'data'
  action: string
  schema: Record<string, z.ZodTypeAny>
}

const str = z.string()
const optStr = z.string().optional()

export const TOOLS: ToolDef[] = [
  { name: 'events', description: '取事件流', module: 'data', action: 'events', schema: { chain: optStr, address: optStr, contract: optStr, eventType: optStr, category: optStr, fromBlock: optStr, toBlock: optStr, limit: z.number().optional() } },
  { name: 'event_stats', description: '按业务分类聚合的事件计数', module: 'data', action: 'event_stats', schema: { chain: optStr } },
  { name: 'tokens', description: '支持的代币列表（含元数据）', module: 'data', action: 'tokens', schema: { chain: optStr } },
  { name: 'chains', description: '支持的区块链网络列表', module: 'data', action: 'chains', schema: {} },
  { name: 'token_info', description: '查询代币元数据（按符号 / 链过滤 DC 代币目录）', module: 'data', action: 'token_info', schema: { symbol: str, chain: optStr, limit: z.number().optional() } },
]
