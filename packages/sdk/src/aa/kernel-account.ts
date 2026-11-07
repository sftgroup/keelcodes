// ---------------------------------------------------------------------------
// Kernel v3 账户：factory initData 编码 / 反事实地址预测
//
// 首笔 owner 操作（enable session）之前账户通常尚未部署，UserOp 必须携带
// factory + factoryData，由 EntryPoint 在验证阶段 CREATE2 部署。
//
//   initializeData = initialize(
//     rootValidator,            // bytes21 = 0x01 ‖ ECDSA validator(20B)
//     hook,                     // address(0) → Kernel 内部归一为 address(1)（不挂 hook）
//     validatorData,            // owner EOA（20B）
//     hookData,                 // '0x'
//     initConfig                // []
//   )                            // Kernel v3.1+，selector 0x3c3b752b
//   factoryData    = KernelFactory.createAccount(initializeData, bytes32 salt)
//
// ⚠️ 仅支持 Kernel v3.1+（0.3.0-beta 的 initialize 为 4 参数，Keel session 路径不支持）。
// ---------------------------------------------------------------------------

import { concatHex, encodeFunctionData, toHex, zeroAddress, type Address, type Hex, type PublicClient } from 'viem'
import type { ChainAAConfig } from './types'
import { KEEL_ROOT_VALIDATOR } from './chain-defaults'

/** ValidationId 前缀：VALIDATOR 类型（0x01） */
const VALIDATOR_TYPE_VALIDATOR = '0x01' as Hex

/** Kernel v3.1+：initialize(bytes21, address, bytes, bytes, bytes[]) */
const KernelV3Init5Abi = [
  {
    type: 'function',
    name: 'initialize',
    inputs: [
      { name: '_rootValidator', type: 'bytes21', internalType: 'ValidationId' },
      { name: 'hook', type: 'address', internalType: 'contract IHook' },
      { name: 'validatorData', type: 'bytes', internalType: 'bytes' },
      { name: 'hookData', type: 'bytes', internalType: 'bytes' },
      { name: 'initConfig', type: 'bytes[]', internalType: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

/** KernelFactory.createAccount(bytes data, bytes32 salt) */
const KernelFactoryAbi = [
  {
    type: 'function',
    name: 'createAccount',
    inputs: [
      { name: 'data', type: 'bytes' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'payable',
  },
] as const

/** KernelFactory.getAddress(bytes data, bytes32 salt)（纯 CREATE2 计算） */
const KernelFactoryGetAddressAbi = [
  {
    type: 'function',
    name: 'getAddress',
    inputs: [
      { name: 'data', type: 'bytes' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const

/**
 * 编码 Kernel v3.1 `initialize(...)` calldata。
 * rootValidator = 0x01 ‖ rootValidator 地址（21B）；validatorData = owner（20B）。
 */
export function encodeKernelInitialize(
  chainConfig: ChainAAConfig,
  owner: Address,
  rootValidator: Address = chainConfig.rootValidator ?? KEEL_ROOT_VALIDATOR
): Hex {
  if (chainConfig.kernelVersion && chainConfig.kernelVersion !== '0.3.1') {
    throw new Error(
      `[keel-sdk] encodeKernelInitialize 仅支持 Kernel 0.3.1+，got ${chainConfig.kernelVersion}`
    )
  }
  return encodeFunctionData({
    abi: KernelV3Init5Abi,
    functionName: 'initialize',
    args: [concatHex([VALIDATOR_TYPE_VALIDATOR, rootValidator]), zeroAddress, owner, '0x', []],
  })
}

/**
 * 首笔部署参数：`factory` + `factoryData = createAccount(initializeData, salt)`。
 * salt 缺省 0（与 relay 的账户派生一致）。
 */
export function encodeKernelFactoryData(
  chainConfig: ChainAAConfig,
  owner: Address,
  salt: bigint = 0n
): { factory: Address; factoryData: Hex } {
  const factory = chainConfig.kernelFactory
  if (!factory) {
    throw new Error(`[keel-sdk] missing kernelFactory for chain ${chainConfig.chainId}`)
  }
  return {
    factory,
    factoryData: encodeFunctionData({
      abi: KernelFactoryAbi,
      functionName: 'createAccount',
      args: [encodeKernelInitialize(chainConfig, owner), toHex(salt, { size: 32 })],
    }),
  }
}

/**
 * 构建「用户钱包直接部署智能账户」的普通交易（**不是** UserOp）。
 *
 * 产品上的「点击创建智能账户」应走这条：用户 EOA 直接发这笔交易调 factory，
 * gas 从 EOA 自身 native 余额扣，不经过 EntryPoint / paymaster。部署完成后
 * 账户已存在，后续 UserOp 不再携带 factory/factoryData；账户零 native 时的
 * 首笔 `approve(paymaster, amount)` 才需要 voucher 垫付。
 *
 * 懒部署路径（把 factoryData 塞进首笔 UserOp，由 EntryPoint 统一收 gas）与之
 * 地址一致（同 owner + salt），可随时切换。
 */
export function buildCreateAccountTx(
  chainConfig: ChainAAConfig,
  owner: Address,
  salt: bigint = 0n
): { to: Address; data: Hex; value: 0n } {
  const { factory, factoryData } = encodeKernelFactoryData(chainConfig, owner, salt)
  return { to: factory, data: factoryData, value: 0n }
}

/** 从 createAccount 编码中解包 (data, salt) —— 供 factory.getAddress 预测复用。 */
export function unpackFactoryData(factoryData: Hex): { data: Hex; salt: Hex } {
  const body = factoryData.slice(10)
  const salt = ('0x' + body.slice(64, 128)) as Hex
  const dataLen = parseInt(body.slice(128, 192), 16)
  return { data: ('0x' + body.slice(192, 192 + dataLen * 2)) as Hex, salt }
}

/**
 * 反事实地址预测：`factory.getAddress(data, salt)` view（纯 CREATE2，无合约创建）。
 * 不依赖 `EntryPoint.getSenderAddress`（部分 RPC 拒绝 eth_call 内的 CREATE2 模拟）。
 */
export async function predictAccountAddress(params: {
  client: PublicClient
  chainConfig: ChainAAConfig
  owner: Address
  salt?: bigint
}): Promise<Address> {
  const { factory, factoryData } = encodeKernelFactoryData(
    params.chainConfig,
    params.owner,
    params.salt ?? 0n
  )
  const { data, salt } = unpackFactoryData(factoryData)
  return (await params.client.readContract({
    address: factory,
    abi: KernelFactoryGetAddressAbi,
    functionName: 'getAddress',
    args: [data, salt],
  })) as Address
}
