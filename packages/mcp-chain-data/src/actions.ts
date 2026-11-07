import { getClient } from './client.js'

/** 分发到 Keel SDK 的 data（DC）子域（仅保留本包 5 个工具需要的动作）。 */
export async function callAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const keel = getClient()
  switch (`data.${action}`) {
    case 'data.events':
      return keel.data.events(args as any)
    case 'data.event_stats':
      return keel.data.eventStats(args.chain as string | undefined)
    case 'data.tokens':
      return keel.data.tokens(args.chain as string | undefined)
    case 'data.chains':
      return keel.data.chains()
    // SDK 未提供带 symbol 过滤的 typed 方法，走 canonical `/v1/data/tokens` 逃生口。
    case 'data.token_info': {
      const q = new URLSearchParams()
      q.set('symbol', String(args.symbol))
      q.set('limit', String(args.limit ?? 20))
      if (args.chain) q.set('chain', String(args.chain))
      return keel.request('GET', `/v1/data/tokens?${q.toString()}`)
    }
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}
