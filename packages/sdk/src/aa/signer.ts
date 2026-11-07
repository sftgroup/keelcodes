// ---------------------------------------------------------------------------
// 自持私钥签名器（最简单接入形态；MPC / 外部钱包请自行实现 Signer）
// ---------------------------------------------------------------------------

import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Signer } from './types'

export function privateKeySigner(privateKey: Hex): Signer {
  const account = privateKeyToAccount(privateKey)
  return {
    type: 'private-key',
    address: account.address,
    signUserOp: (hash) => account.sign({ hash }),
    signMessage: (message) => account.signMessage({ message: { raw: message } }),
  }
}
