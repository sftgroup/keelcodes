// ---------------------------------------------------------------------------
// KeelTokenPaymaster 客户端数据编码
// ---------------------------------------------------------------------------

import { concatHex, toHex, type Address, type Hex } from 'viem'

/**
 * token 计费分支的 `paymasterData`：`tokenAddress`（可选再追 32B 客户端报价）。
 * 客户端报价只有比链上价更保守时才会被采用（不会多扣）。
 */
export function buildTokenPaymasterData(args: { token: Address; clientPrice?: bigint }): Hex {
  if (args.clientPrice == null) return args.token
  if (args.clientPrice <= 0n) throw new Error('[keel-sdk] clientPrice must be > 0')
  return concatHex([args.token, toHex(args.clientPrice, { size: 32 })])
}
