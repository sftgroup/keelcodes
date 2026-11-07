import { getClient } from './client.js'

/** 分发到 Keel SDK 的 data（Quant）子域（仅保留本包 5 个工具需要的动作）。 */
export async function callAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const keel = getClient()
  switch (`data.${action}`) {
    case 'data.bars':
      return keel.data.bars(args as any)
    case 'data.tickers':
      return keel.data.tickers(args as any)
    case 'data.factors':
      return keel.data.factors(args as any)
    case 'data.predictions':
      return keel.data.predictions(args as any)
    // SDK 未提供交易日历的 typed 方法，走 canonical `/v1/data/trading-calendar` 逃生口。
    case 'data.trading_calendar': {
      const q = new URLSearchParams()
      if (args.exchange) q.set('exchange', String(args.exchange))
      if (args.start) q.set('start', String(args.start))
      if (args.end) q.set('end', String(args.end))
      const qs = q.toString()
      return keel.request('GET', `/v1/data/trading-calendar${qs ? `?${qs}` : ''}`)
    }
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}
