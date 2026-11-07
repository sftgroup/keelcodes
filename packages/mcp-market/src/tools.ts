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
  { name: 'market_price', description: 'DEX 代币实时价', module: 'data', action: 'market_price', schema: { chainIndex: str, tokenAddress: str } },
  { name: 'market_candles', description: 'DEX 代币 K 线（OHLCV）', module: 'data', action: 'market_candles', schema: { chainIndex: str, tokenAddress: str, period: optStr, limit: optStr } },
  { name: 'market_hot_tokens', description: '热门 DEX 池（GeckoTerminal trending）', module: 'data', action: 'market_hot', schema: { chainIndex: optStr, limit: optStr } },
  { name: 'market_token_search', description: '按名称/符号搜索 DEX 代币（DexScreener）', module: 'data', action: 'market_search', schema: { keyword: str, chainIndex: optStr, limit: optStr } },
]
