// ---------------------------------------------------------------------------
// UserOp v0.7 构建 / 编码 / 哈希（ERC-4337）
//
// callData = Kernel v3 execute(execMode, executionCalldata)（ERC-7579 单调用）
// userOpHash = viem getUserOperationHash（v0.7 EIP-712，含 chainId 防跨链重放）
// ---------------------------------------------------------------------------

import { concatHex, encodeAbiParameters, encodeFunctionData, toHex, type Address, type Hex } from 'viem'
import { getUserOperationHash, type UserOperation } from 'viem/account-abstraction'
import type { UserOperationV7 } from './types'

/** Kernel v3 execute ABI（ERC-7579：execMode + executionCalldata） */
const KernelV3ExecuteAbi = [
  {
    type: 'function',
    name: 'execute',
    inputs: [
      { name: 'execMode', type: 'bytes32', internalType: 'ExecMode' },
      { name: 'executionCalldata', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

/** DEFAULT execMode（root / call / no-revert-on-error）→ 全零 bytes32 */
const DEFAULT_EXEC_MODE = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

/** 编码 Kernel v3 单调用 callData：executionCalldata = target ‖ value(32B) ‖ data */
export function encodeExecute(target: Address, value: bigint, data: Hex): Hex {
  return encodeFunctionData({
    abi: KernelV3ExecuteAbi,
    functionName: 'execute',
    args: [DEFAULT_EXEC_MODE, concatHex([target, toHex(value ?? 0n, { size: 32 }), data ?? '0x'])],
  })
}

/**
 * IAccountExecute.executeUserOp selector（ERC-4337 v0.7）。
 * 挂 KeelPolicyHook 的 session 配置下，Kernel 在验证期强制 callData 以它开头。
 */
export const EXECUTE_USER_OP_SELECTOR = '0x8dd7712f' as Hex

/** 批量执行单条（ERC-7579 Execution = (target, value, data)） */
export interface Execution {
  target: Address
  value?: bigint
  data: Hex
}

/**
 * BATCH execMode：CALLTYPE_BATCH(0x01) | EXECTYPE_DEFAULT(0x00) → 高 2 字节 0x0100。
 * 用于 owner 侧撤销（validator + hook 两段一次上链）。
 */
export const BATCH_EXEC_MODE =
  '0x0100000000000000000000000000000000000000000000000000000000000000' as Hex

const ExecutionTuple = [
  { name: 'target', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' },
] as const

/** 编码 Kernel v3 批量调用：execute(BATCH_EXEC_MODE, abi.encode(Execution[])) */
export function encodeExecuteBatch(executions: Execution[]): Hex {
  return encodeFunctionData({
    abi: KernelV3ExecuteAbi,
    functionName: 'execute',
    args: [
      BATCH_EXEC_MODE,
      encodeAbiParameters(
        [{ name: 'executions', type: 'tuple[]', components: ExecutionTuple }],
        [executions.map((e) => ({ target: e.target, value: e.value ?? 0n, data: e.data }))]
      ),
    ],
  })
}

/** 外层包装：executeUserOp.selector ‖ execute(...)（Route C / 挂真 hook 时必需） */
export function encodeExecuteUserOp(executeCallData: Hex): Hex {
  return concatHex([EXECUTE_USER_OP_SELECTOR, executeCallData])
}

export interface BuildUserOpWithCallDataParams {
  sender: Address
  nonce: bigint
  /** 已编码的 callData（自定外层，如 {@link encodeExecuteUserOp} 包裹） */
  callData: Hex
  factory?: Address
  factoryData?: Hex
  gas?: Partial<
    Pick<
      UserOperationV7,
      'callGasLimit' | 'verificationGasLimit' | 'preVerificationGas' | 'maxFeePerGas' | 'maxPriorityFeePerGas'
    >
  >
}

/** 以已编码 callData 构建 UserOp v0.7（未签名）。 */
export function buildUserOpWithCallData(params: BuildUserOpWithCallDataParams): UserOperationV7 {
  return {
    sender: params.sender,
    nonce: params.nonce,
    factory: params.factory,
    factoryData: params.factoryData,
    callData: params.callData,
    callGasLimit: params.gas?.callGasLimit ?? 0n,
    verificationGasLimit: params.gas?.verificationGasLimit ?? 0n,
    preVerificationGas: params.gas?.preVerificationGas ?? 0n,
    maxFeePerGas: params.gas?.maxFeePerGas ?? 0n,
    maxPriorityFeePerGas: params.gas?.maxPriorityFeePerGas ?? 0n,
    signature: '0x',
  }
}

/** EIP-712 userOpHash（v0.7 标准，含 chainId）。 */
export function getUserOpHash(op: UserOperationV7, entryPoint: Address, chainId: number): Hex {
  return getUserOperationHash({
    chainId,
    entryPointAddress: entryPoint,
    entryPointVersion: '0.7',
    userOperation: op as unknown as UserOperation<'0.7'>,
  })
}

/** UserOp v0.7 → bundler RPC 参数（bigint → hex；paymaster 字段缺省剔除）。 */
export function userOpToRpc(op: UserOperationV7): Record<string, unknown> {
  const rpc: Record<string, unknown> = {
    sender: op.sender,
    nonce: toHex(op.nonce),
    factory: op.factory,
    factoryData: op.factoryData,
    callData: op.callData,
    callGasLimit: toHex(op.callGasLimit),
    verificationGasLimit: toHex(op.verificationGasLimit),
    preVerificationGas: toHex(op.preVerificationGas),
    maxFeePerGas: toHex(op.maxFeePerGas),
    maxPriorityFeePerGas: toHex(op.maxPriorityFeePerGas),
    signature: op.signature,
  }
  if (op.paymaster) {
    rpc.paymaster = op.paymaster
    if (op.paymasterVerificationGasLimit !== undefined) {
      rpc.paymasterVerificationGasLimit = toHex(op.paymasterVerificationGasLimit)
    }
    if (op.paymasterPostOpGasLimit !== undefined) {
      rpc.paymasterPostOpGasLimit = toHex(op.paymasterPostOpGasLimit)
    }
    rpc.paymasterData = op.paymasterData
  }
  return rpc
}
