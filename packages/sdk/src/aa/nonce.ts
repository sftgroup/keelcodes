// ---------------------------------------------------------------------------
// Kernel v3 nonce key 编码（ValidatorLib.encodeAsNonceKey）
//
// EntryPoint nonce = nonceKey << 64 | sequence；Kernel 用 nonceKey 路由到
// 具体 validator：key = (mode << 184) | (vType << 176) | (validator << 16) | nonceKey
// ---------------------------------------------------------------------------

import type { Address } from 'viem'

export const VALIDATION_MODE_DEFAULT = 0
export const VALIDATION_MODE_ENABLE = 1
export const VALIDATION_TYPE_ROOT = 0
export const VALIDATION_TYPE_VALIDATOR = 1

export function encodeAsNonceKey(
  mode: number,
  vType: number,
  validator: Address,
  nonceKey: number | bigint = 0
): bigint {
  return (BigInt(mode) << 184n) | (BigInt(vType) << 176n) | (BigInt(validator) << 16n) | BigInt(nonceKey)
}

/** 已安装 validator 的常规 UserOp（agent session key 走此通道）。 */
export function validatorNonceKey(validator: Address, nonceKey: number | bigint = 0): bigint {
  return encodeAsNonceKey(VALIDATION_MODE_DEFAULT, VALIDATION_TYPE_VALIDATOR, validator, nonceKey)
}
