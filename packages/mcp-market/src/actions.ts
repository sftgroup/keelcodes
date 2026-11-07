import { getClient } from './client.js'

/** 分发到 Keel SDK 的 data.market 子域（仅保留本包 4 个工具需要的动作）。 */
export async function callAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const keel = getClient()
  switch (`data.${action}`) {
    case 'data.market_price':
      return keel.data.market.price(args as any)
    case 'data.market_candles':
      return keel.data.market.candles(args as any)
    case 'data.market_hot':
      return keel.data.market.hot(args as any)
    case 'data.market_search':
      return keel.data.market.search(args as any)
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}
