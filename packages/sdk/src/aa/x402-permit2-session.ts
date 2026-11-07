// ---------------------------------------------------------------------------
// x402 标准 exact over Permit2 —— session key（ERC-1271）签名
// ---------------------------------------------------------------------------
// 与 `x402-permit2.ts`（EOA 直接签）的区别只在签名者：
//
//   EOA      : signTypedData(typed)                      → 65B ECDSA
//   session  : sign(keccak256(kernelWrapped(typedHash) ‖ keccak256(policyData)))
//              并用 validator 信封包起来：
//              0x01 ‖ validator(20B) ‖ sessionId(32B) ‖ policyData ‖ agentSig
//
// 服务端（`verifyPermit2SmartAccountSignature`）会把 Permit2 的 typed-data hash
// 交给账户的 `isValidSignature`，Kernel 再路由到 session validator —— 所以两端
// 只需对「typed data 的 hash」保持一致，EIP-3009 那条轨的结构无需改动。
//
// 适用场景：AA 钱包 / agent 钱包向**外部**标准 x402 商家付款。
// 不适用：只有 EIP-3009 accept 的商家（代币侧只做 ecrecover）。
// ---------------------------------------------------------------------------

import { concatHex, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'
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
import { buildUserOpWithCallData, encodeExecute, encodeExecuteUserOp, getUserOpHash } from './userop'
import {
  sessionTypedDataDigest,
  VALIDATION_TYPE_VALIDATOR_PREFIX,
} from './x402-session'
import {
  buildX402Permit2Payload,
  buildX402Permit2TypedData,
  createX402Permit2Authorization,
  encodePermit2SettleCall,
  encodeX402Permit2Header,
  PERMIT2_ADDRESS,
  permit2Of,
  selectPermit2Accept,
  type X402Permit2Accept,
  type X402Permit2Authorization,
  type X402Permit2Payload,
  type X402Permit2TypedData,
} from './x402-permit2'
import type { X402PaymentRequired } from './x402'

/** 首次使用 Permit2 前必须的 ERC-20 授权（额度 = 预算，禁止 unlimited）。 */
const ERC20_APPROVE_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
])

export interface Permit2SessionSignerArgs {
  /** AA 账户（也是 `permit2Authorization.from`） */
  account: Address
  chainConfig: ChainAAConfig
  /** 必须与 enable session 时的 policy 逐字节一致 */
  policy: SessionPolicy
  /** session validator 副本 slot */
  slot: number
  sessionSigner: Signer
  kernelVersion?: string
}

/**
 * 生成可挂到 `X402PayerConfig.signPermit2TypedData` 的回调：
 * 收到 Permit2 typed data → 返回 Kernel 1271 信封签名。
 */
export function permit2SessionSigner(
  args: Permit2SessionSignerArgs
): (typed: X402Permit2TypedData) => Promise<Hex> {
  const validator = resolveKeelValidator(args.chainConfig, args.slot)
  const policyData = encodeKeelPolicyData(args.policy)
  const sessionId = toBytes32(args.policy.sessionId)
  return async (typed) => {
    const digest = sessionTypedDataDigest({
      typed,
      account: args.account,
      chainId: args.chainConfig.chainId,
      policy: args.policy,
      kernelVersion: args.kernelVersion ?? args.chainConfig.kernelVersion,
    })
    const sig = await args.sessionSigner.signUserOp(digest)
    return concatHex([
      VALIDATION_TYPE_VALIDATOR_PREFIX,
      validator,
      sessionId,
      policyData,
      sig,
    ])
  }
}

export interface SignX402Permit2WithSessionParams extends Permit2SessionSignerArgs {
  /** 完整 402 挑战（二选一） */
  challenge?: X402PaymentRequired
  /** 已选定的 Permit2 accept（二选一，优先） */
  accept?: X402Permit2Accept
  network?: string
  asset?: string
  validForSeconds?: number
  validAfter?: number
  nonce?: bigint
  nowMs?: number
  /** 覆盖 Permit2 合约地址（缺省取 accept.extra.permit2Address / canonical） */
  permit2?: Address
}

/**
 * 用 session key 完成一次 Permit2 exact 付款签名（不发交易、不需要原生 gas）。
 * @returns `header` 可直接作为 `PAYMENT-SIGNATURE` 发送
 */
export async function signX402Permit2WithSession(
  p: SignX402Permit2WithSessionParams
): Promise<{
  header: string
  payload: X402Permit2Payload
  accept: X402Permit2Accept
  authorization: X402Permit2Authorization
  signature: Hex
}> {
  const accept =
    p.accept ??
    (p.challenge
      ? selectPermit2Accept(p.challenge, { network: p.network, asset: p.asset })
      : undefined)
  if (!accept) {
    throw new Error('[keel-sdk] signX402Permit2WithSession requires a challenge or an accept')
  }

  const authorization = createX402Permit2Authorization({
    accept,
    from: p.account,
    validForSeconds: p.validForSeconds,
    validAfter: p.validAfter,
    nonce: p.nonce,
    nowMs: p.nowMs,
  })
  const typed = buildX402Permit2TypedData(accept, authorization, p.permit2 ?? permit2Of(accept))
  const signature = await permit2SessionSigner(p)(typed)
  const payload = buildX402Permit2Payload(accept, authorization, signature)
  return {
    header: encodeX402Permit2Header(payload),
    payload,
    accept,
    authorization,
    signature,
  }
}

/**
 * `approve(Permit2, 预算)` 的调用体（预算上限 = 这一笔额度，禁止 unlimited）。
 *
 * 用法：从资金池/owner 账户执行一次（可由 paymaster 代付 gas）；
 * 预算用尽后再补一笔。撤销 = `amount: 0n`。
 */
export function encodePermit2Approval(args: {
  token: Address
  /** 允许 Permit2 划走的上限（最小单位） */
  amount: bigint
  /** 缺省 canonical Permit2 */
  permit2?: Address
}): { to: Address; value: 0n; data: Hex; asset: Address } {
  if (args.amount < 0n) throw new Error('[keel-sdk] permit2 approval amount must be >= 0')
  return {
    to: args.token,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [args.permit2 ?? PERMIT2_ADDRESS, args.amount],
    }),
    asset: args.token,
  }
}

const ENTRYPOINT_NONCE_ABI = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256)',
])

/**
 * 估算前的占位 gas 上限（与 `payX402WithSession` 同口径）：
 * token paymaster 在 validation 阶段按「price × 全部 gas 上限」预扣，不能开太大。
 */
const DEFAULT_OP_GAS = {
  callGasLimit: 800_000n,
  verificationGasLimit: 600_000n,
  preVerificationGas: 100_000n,
} as const

const DEFAULT_PAYMASTER_GAS = {
  paymasterVerificationGasLimit: 200_000n,
  paymasterPostOpGasLimit: 60_000n,
} as const

export interface PayX402Permit2WithSessionParams extends SignX402Permit2WithSessionParams {
  /** 查 EntryPoint nonce（viem PublicClient 可直接传入） */
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
}

export interface PayX402Permit2WithSessionResult {
  /** 可直接作为 `PAYMENT-SIGNATURE` 发送（payload 里带 txHash） */
  header: string
  payload: X402Permit2Payload
  /** 结算交易哈希（= payload.payload.txHash） */
  txHash: Hex
  userOpHash: Hex
  userOp: UserOperationV7
  accept: X402Permit2Accept
  authorization: X402Permit2Authorization
  signature: Hex
}

/**
 * B19.6：402 自动重试的「智能账户自播」参数（挂到 `X402PayerConfig.sessionPayer`）。
 *
 * 账户地址、accept、有效期由客户端在重试时补齐，其余（链、policy、bundler、
 * paymaster、费用）一次配好即可让 `HttpClient` 的 402 重试直接走 UserOp 结算。
 */
export type X402SessionPayerConfig = Omit<
  PayX402Permit2WithSessionParams,
  'challenge' | 'accept' | 'network' | 'asset' | 'account' | 'nonce' | 'nowMs' | 'validForSeconds'
>

/**
 * B19.6：智能账户**自己执行** Permit2 结算（不再由平台的 settler 代播）。
 *
 * 流程：session key 签 Permit2 witness（ERC-1271 信封）
 *      → 账户发一笔 UserOp 调 `x402ExactPermit2Proxy.settle`（paymaster 付 gas）
 *      → 等收据成功后把 txHash 一并写进标准载荷，服务端只核验回执。
 *
 * 这样 gas 由账户 + paymaster 承担（零 native 也可用），平台既不广播也不垫付。
 */
export async function payX402Permit2WithSession(
  p: PayX402Permit2WithSessionParams
): Promise<PayX402Permit2WithSessionResult> {
  const accept =
    p.accept ??
    (p.challenge
      ? selectPermit2Accept(p.challenge, { network: p.network, asset: p.asset })
      : undefined)
  if (!accept) {
    throw new Error('[keel-sdk] payX402Permit2WithSession requires a challenge or an accept')
  }

  const authorization = createX402Permit2Authorization({
    accept,
    from: p.account,
    validForSeconds: p.validForSeconds,
    validAfter: p.validAfter,
    nonce: p.nonce,
    nowMs: p.nowMs,
  })
  const typed = buildX402Permit2TypedData(accept, authorization, p.permit2 ?? permit2Of(accept))
  const signature = await permit2SessionSigner(p)(typed)
  // 链上执行体：spender（代理）.settle(permit, owner, witness, signature)
  const call = encodePermit2SettleCall(authorization, signature)

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

  const buildOp = (gas: {
    callGasLimit: bigint
    verificationGasLimit: bigint
    preVerificationGas: bigint
  }): UserOperationV7 => ({
    ...buildUserOpWithCallData({
      sender: p.account,
      nonce,
      callData: encodeExecuteUserOp(encodeExecute(call.to, call.value, call.data)),
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

  // 估算必须先签名（bundler 会跑真实验证），因此用占位 gas 签一次。
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
    // 回执里有 bigint 字段，JSON.stringify 需转字符串才能安全拼进错误信息。
    const detail = JSON.stringify(sent.receipt, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    throw new Error(
      `[keel-sdk] Permit2 settle UserOp failed (hash ${sent.userOpHash}): ${detail}`
    )
  }
  const txHash = sent.receipt.txHash
  if (!txHash) throw new Error('[keel-sdk] bundler receipt has no transactionHash')

  const payload = buildX402Permit2Payload(accept, authorization, signature, txHash)
  return {
    header: encodeX402Permit2Header(payload),
    payload,
    txHash,
    userOpHash: sent.userOpHash,
    userOp: op,
    accept,
    authorization,
    signature,
  }
}
