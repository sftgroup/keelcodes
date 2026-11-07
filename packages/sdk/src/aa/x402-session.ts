// ---------------------------------------------------------------------------
// x402 + Keel session 整合：agent 自主付款 + paymaster 垫付 gas
//
// 闭环：
//   1. agent 用 session key 签一笔 UserOp：ERC-20 transfer → x402 payTo
//   2. 同一笔 UserOp 由 KeelTokenPaymaster 计费（gas 从 paymaster deposit 垫付，
//      账户以同一 token 结算）——零 native
//   3. 上链后 session key 再产一份 ERC-1271 签名，作为 x402 `PAYMENT-SIGNATURE`
//      （服务端用 `Kernel.isValidSignature` 校验，返回 0x1626ba7e）
//
// 签名布局：
//   UserOp.signature = sessionId(32B) ‖ policyData ‖ agentSig(65B)
//   ERC-1271 sig     = 0x01 ‖ validator(20B) ‖ sessionId(32B) ‖ policyData ‖ agentSig(65B)
// ---------------------------------------------------------------------------

import { concatHex, hashTypedData, keccak256, parseAbi, type Address, type Hex } from 'viem'
import type { BundlerLike, ChainAAConfig, SessionPolicy, Signer, UserOperationV7 } from './types'
import {
  encodeKeelPolicyData,
  encodeKeelSessionSignature,
  keelSessionDigest,
  resolveKeelValidator,
  toBytes32,
} from './keel-session'
import { validatorNonceKey } from './nonce'
import { buildTokenPaymasterData } from './token-paymaster'
import {
  buildUserOpWithCallData,
  encodeExecute,
  encodeExecuteUserOp,
  getUserOpHash,
} from './userop'
import {
  buildX402Payload,
  buildX402Payment,
  buildX402TypedData,
  encodePaymentSignature,
  selectX402Accept,
  type X402Accept,
  type X402Payment,
  type X402PaymentPayload,
  type X402PaymentRequired,
  type X402TypedData,
} from './x402'

/** Kernel 包装结构类型哈希：`Kernel(bytes32 hash)` */
export const KERNEL_WRAPPER_TYPE_HASH =
  '0x1547321c374afde8a591d972a084b071c594c275e36724931ff96c25f2999c83' as Hex

/** Kernel EIP-712 domain */
export const KERNEL_DOMAIN_NAME = 'Kernel'
export const KERNEL_DOMAIN_VERSION = '0.3.1'

/** VALIDATION_TYPE_VALIDATOR：ERC-1271 签名首字节 */
export const VALIDATION_TYPE_VALIDATOR_PREFIX = '0x01' as Hex

const ENTRYPOINT_NONCE_ABI = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256)',
])

/**
 * 估算前的占位 gas 上限。
 * ⚠️ 不能开太大：token paymaster 在 validation 阶段按
 * `maxFeePerGas × 全部 gas 上限` **预扣** token（postOp 退差），
 * ETH 主网上一笔 2M/1.2M 的占位就能预扣 ~2.4 USDC，小额账户直接 AA33。
 * 真实用量 ~300k，这里 800k/600k 已留足余量。
 */
const DEFAULT_OP_GAS = {
  callGasLimit: 800_000n,
  verificationGasLimit: 600_000n,
  preVerificationGas: 100_000n,
} as const

/** paymaster 两段 gas 上限默认值；postOp 必须 ≥ refundPostopCost(40000) */
const DEFAULT_PAYMASTER_GAS = {
  paymasterVerificationGasLimit: 200_000n,
  paymasterPostOpGasLimit: 60_000n,
} as const

/**
 * Kernel ERC-1271 包装摘要：与 `Kernel._toWrappedHash` 完全一致
 * （domain = Kernel/0.3.1/chainId/account）。
 */
export function kernelWrappedDigest(args: {
  account: Address
  chainId: number
  digest: Hex
  kernelVersion?: string
}): Hex {
  return hashTypedData({
    domain: {
      name: KERNEL_DOMAIN_NAME,
      version: args.kernelVersion ?? KERNEL_DOMAIN_VERSION,
      chainId: args.chainId,
      verifyingContract: args.account,
    },
    types: { Kernel: [{ name: 'hash', type: 'bytes32' }] },
    primaryType: 'Kernel',
    message: { hash: args.digest },
  })
}

/**
 * session key 在 ERC-1271 场景要签的摘要：
 *   keccak256(kernelWrapped(typedDataHash) ‖ keccak256(policyData))
 * —— 与 `KeelSessionValidator.isValidSignatureWithSender` 逐字节一致。
 *
 * 对任意 EIP-712 结构成立，因此 EIP-3009（EOA）之外的 Permit2 载荷复用同一条路径。
 */
export function sessionTypedDataDigest(args: {
  typed: SessionTypedDataLike
  account: Address
  chainId: number
  policy: SessionPolicy
  kernelVersion?: string
}): Hex {
  const typedDigest = hashTypedData(args.typed as any)
  const wrapped = kernelWrappedDigest({
    account: args.account,
    chainId: args.chainId,
    digest: typedDigest,
    kernelVersion: args.kernelVersion,
  })
  return keccak256(concatHex([wrapped, keccak256(encodeKeelPolicyData(args.policy))]))
}

/** 任意 EIP-712 待签结构的形状（`hashTypedData` 的输入）。 */
export interface SessionTypedDataLike {
  domain: Record<string, unknown>
  types: Record<string, readonly { name: string; type: string }[]>
  primaryType: string
  message: Record<string, unknown>
}

/** 旧 x402 `Payment` 结构（txHash 轨）的 session 摘要。 */
export function sessionX402Digest(args: {
  typed: X402TypedData
  account: Address
  chainId: number
  policy: SessionPolicy
  kernelVersion?: string
}): Hex {
  return sessionTypedDataDigest(args)
}

export interface SignX402WithSessionParams {
  /** x402 待签结构（由 {@link buildX402TypedData} 生成） */
  typed: X402TypedData
  chainConfig: ChainAAConfig
  account: Address
  policy: SessionPolicy
  /** session validator 副本 slot（一 key 一副本） */
  slot: number
  /** session key（客户端自持） */
  sessionSigner: Signer
}

/**
 * 产出可直接放进 x402 `payload.signature` 的 ERC-1271 签名：
 *   `0x01 ‖ validator ‖ sessionId ‖ policyData ‖ sessionKeySig`
 */
export async function signX402WithSession(p: SignX402WithSessionParams): Promise<Hex> {
  const validator = resolveKeelValidator(p.chainConfig, p.slot)
  const policyData = encodeKeelPolicyData(p.policy)
  const digest = sessionX402Digest({
    typed: p.typed,
    account: p.account,
    chainId: p.chainConfig.chainId,
    policy: p.policy,
    kernelVersion: p.chainConfig.kernelVersion,
  })
  const sig = await p.sessionSigner.signUserOp(digest)
  return concatHex([
    VALIDATION_TYPE_VALIDATOR_PREFIX,
    validator,
    toBytes32(p.policy.sessionId),
    policyData,
    sig,
  ])
}

export interface PayX402WithSessionParams {
  challenge: X402PaymentRequired
  /** 指定 accept；缺省按 `token` 自动匹配（只接受稳定币） */
  accept?: X402Accept
  chainConfig: ChainAAConfig
  account: Address
  policy: SessionPolicy
  slot: number
  sessionSigner: Signer
  /** 查询 nonce（viem PublicClient 可直接传入） */
  publicClient: {
    readContract: (args: any) => Promise<unknown>
  }
  bundler: BundlerLike
  /** KeelTokenPaymaster：gas 由它垫付，按 token 向账户结算 */
  paymaster: {
    address: Address
    token: Address
    /** 客户端自报价（可选，只有比链上价更保守才生效） */
    clientPrice?: bigint
    validationGasLimit?: bigint
    postOpGasLimit?: bigint
  }
  /** EIP-1559 费用（调用方按链取实时值；BSC 必须给非零 tip） */
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  /** agent 通道号（nonceKey 隔离并发 agent），缺省 0 */
  agentIndex?: number
  method?: string
  url?: string
  salt?: Hex
}

export interface PayX402WithSessionResult {
  /** 可直接写入 `PAYMENT-SIGNATURE` 头 */
  header: string
  payload: X402PaymentPayload
  /** 链上付款交易哈希（= payload.payload.txHash） */
  txHash: Hex
  userOpHash: Hex
  payment: X402Payment
  userOp: UserOperationV7
  accept: X402Accept
}

/**
 * 一次完成「链上付款 + gas 垫付 + x402 凭证签名」。
 *
 * 流程：session key 签 UserOp（ERC-20 transfer → payTo，paymaster 计费）
 *      → bundler 广播并等待收据 → 组 x402 payload → session key 产 ERC-1271 签名。
 */
export async function payX402WithSession(
  p: PayX402WithSessionParams
): Promise<PayX402WithSessionResult> {
  const accept =
    p.accept ??
    selectX402Accept(p.challenge, {
      asset: p.paymaster.token,
      network: `eip155:${p.chainConfig.chainId}`,
    })
  const payment = buildX402Payment(accept)

  const validator = resolveKeelValidator(p.chainConfig, p.slot)
  const nonceKey = validatorNonceKey(validator, p.agentIndex ?? 0)
  const nonce = (await p.publicClient.readContract({
    address: p.chainConfig.entryPoint,
    abi: ENTRYPOINT_NONCE_ABI,
    functionName: 'getNonce',
    args: [p.account, nonceKey],
  })) as bigint

  const paymasterGas = {
    paymasterVerificationGasLimit:
      p.paymaster.validationGasLimit ?? DEFAULT_PAYMASTER_GAS.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit:
      p.paymaster.postOpGasLimit ?? DEFAULT_PAYMASTER_GAS.paymasterPostOpGasLimit,
  }

  /** 构建未签名 session op（paymaster 字段必须在签名前就位：userOpHash 覆盖它们） */
  const buildOp = (gas: {
    callGasLimit: bigint
    verificationGasLimit: bigint
    preVerificationGas: bigint
  }): UserOperationV7 => ({
    ...buildUserOpWithCallData({
      sender: p.account,
      nonce,
      callData: encodeExecuteUserOp(encodeExecute(payment.to, payment.value, payment.data)),
      gas: {
        ...gas,
        maxFeePerGas: p.maxFeePerGas,
        maxPriorityFeePerGas: p.maxPriorityFeePerGas,
      },
    }),
    paymaster: p.paymaster.address,
    paymasterData: buildTokenPaymasterData({
      token: p.paymaster.token,
      clientPrice: p.paymaster.clientPrice,
    }),
    ...paymasterGas,
  })

  const policyData = encodeKeelPolicyData(p.policy)
  const signOp = async (op: UserOperationV7): Promise<UserOperationV7> => {
    const hash = getUserOpHash(op, p.chainConfig.entryPoint, p.chainConfig.chainId)
    const sig = await p.sessionSigner.signUserOp(keelSessionDigest(hash, policyData))
    return {
      ...op,
      signature: encodeKeelSessionSignature({ sessionId: p.policy.sessionId, policyData, sig }),
    }
  }

  // 估算必须先签名（bundler 会跑真实验证），因此用占位 gas 签一次
  const probe = await signOp(buildOp(DEFAULT_OP_GAS))
  const est = await p.bundler.estimateUserOperationGas(probe)
  const op = await signOp(
    buildOp({
      callGasLimit: est.callGasLimit ?? DEFAULT_OP_GAS.callGasLimit,
      verificationGasLimit: est.verificationGasLimit ?? DEFAULT_OP_GAS.verificationGasLimit,
      preVerificationGas: est.preVerificationGas ?? DEFAULT_OP_GAS.preVerificationGas,
    })
  )

  const sent = await p.bundler.sendUserOperation(op)
  if (!sent.receipt?.success) {
    throw new Error(
      `[keel-sdk] x402 payment UserOp failed (hash ${sent.userOpHash}): ${JSON.stringify(sent.receipt)}`
    )
  }
  const txHash = sent.receipt.txHash
  if (!txHash) throw new Error('[keel-sdk] bundler receipt has no transactionHash')

  const unsigned = buildX402Payload({
    challenge: p.challenge,
    accepted: accept,
    txHash,
    method: p.method,
    url: p.url,
    salt: p.salt,
  })
  unsigned.signature = await signX402WithSession({
    typed: buildX402TypedData(unsigned),
    chainConfig: p.chainConfig,
    account: p.account,
    policy: p.policy,
    slot: p.slot,
    sessionSigner: p.sessionSigner,
  })

  return {
    header: encodePaymentSignature(unsigned),
    payload: unsigned,
    txHash,
    userOpHash: sent.userOpHash,
    payment,
    userOp: op,
    accept,
  }
}
