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
  { name: 'bars', description: '取 K线', module: 'data', action: 'bars', schema: { symbol: str, timeframe: optStr, marketType: optStr, start: z.number().optional(), end: z.number().optional(), limit: z.number().optional() } },
  { name: 'tickers', description: '取实时行情', module: 'data', action: 'tickers', schema: { symbols: z.union([z.string(), z.array(z.string())]), marketType: optStr } },
  { name: 'factors', description: '取因子', module: 'data', action: 'factors', schema: { symbols: optStr, category: optStr } },
  { name: 'ml_predictions', description: '取 ML 预测', module: 'data', action: 'predictions', schema: { model: z.enum(['bolt', 'moirai', 'timesfm']), symbol: str, start: z.number().optional(), end: z.number().optional(), limit: z.number().optional() } },
  { name: 'trading_calendar', description: 'A 股交易日历（区间内开市日清单）', module: 'data', action: 'trading_calendar', schema: { exchange: optStr, start: optStr, end: optStr } },
]
