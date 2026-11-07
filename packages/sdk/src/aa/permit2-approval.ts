// ---------------------------------------------------------------------------
// B10.5：Permit2 首次授权免 gas（voucher 赞助的 UserOp）
// ---------------------------------------------------------------------------
// 背景：BSC / ETH 的 Permit2 轨要求用户先 `approve(Permit2, 预算)` 才能签
// PermitSingle。这笔 approve 是普通 ERC-20 交易，天然要用户自付一次 gas ——
// 对「账户里只有 USDT、没有 BNB/ETH」的用户就是死锁。
//
// 做法：把 approve 包成 Kernel `execute(...)`（session 场景再套 v1 的
// `executeUserOp`）→ 向 aa-relay 申请 voucher（paymaster 用自己 deposit 赞助
// 这一笔）→ 客户端签名 → bundler 广播。用户全程不持有 native。
//
// 边界：
//   - 只赞助 `approve(spender, amount)` 且 spender ∈ 服务端白名单
//     （paymaster / canonical Permit2 / 额外配置）；
//   - Permit2 必须是**有限预算**，`MaxUint256` 会被服务端拒绝（B11.3）；
//   - 只有已部署的账户能拿 voucher（懒部署仍需一次自付，见 voucher 闸门）。
// ---------------------------------------------------------------------------

import type { Address, Hex } from 'viem'
import type { BundlerLike, ChainAAConfig, SessionPolicy, Signer, UserOperationV7 } from './types'
import { encodePermit2Approval } from './x402-permit2-session'
import { buildUserOpWithCallData, encodeExecute, encodeExecuteUserOp, getUserOpHash } from './userop'
import {
  encodeKeelPolicyData,
  encodeKeelSessionSignature,
  keelSessionDigest,
  resolveKeelValidator,
  toBytes32,
} from './keel-session'
import { validatorNonceKey } from './nonce'

const ENTRYPOINT_NONCE_ABI = [
  {
    type: 'function',
    name: 'getNonce',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/** 申请 voucher 前的占位 gas：approve 本身很轻，但要覆盖 bundler 校验开销。 */
const PROBE_GAS = {
  callGasLimit: 200_000n,
  verificationGasLimit: 600_000n,
  preVerificationGas: 150_000n,
} as const
const PROBE_PAYMASTER_GAS = {
  paymasterVerificationGasLimit: 250_000n,
  paymasterPostOpGasLimit: 80_000n,
} as const

/** 与 aa-relay `POST /v1/wallet/session/paymaster/voucher` 的请求体对齐。 */
export interface Permit2VoucherRequest {
  sender: Address
  callData: Hex
  maxCost: bigint
  chainId: number
  gas: {
    preVerificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
    paymasterVerificationGasLimit: bigint
    paymasterPostOpGasLimit: bigint
    maxFeePerGas: bigint
  }
}

/** 只需 `paymaster` + `paymasterData`（其余字段调用方可用于日志/审计）。 */
export interface Permit2Voucher {
  paymaster: Address
  paymasterData: Hex
  maxCost: bigint
}

export interface SponsorPermit2ApprovalParams {
  chainConfig: ChainAAConfig
  /** 智能账户（Kernel）地址，必须是已部署账户 */
  account: Address
  /** ERC-20 代币（USDT / USDC） */
  token: Address
  /** 授权上限（最小单位）；0 表示撤销 */
  amount: bigint
  /** 缺省 canonical Permit2 */
  permit2?: Address
  /** root owner 或 session key */
  signer: Signer
  /** session 场景必填：与 enable 时逐字节一致的 policy + validator slot */
  policy?: SessionPolicy
  slot?: number
  bundler: BundlerLike
  publicClient: { readContract: (args: any) => Promise<unknown> }
  /** 用 `Keel.wallet.paymaster.voucher()` 包装即可 */
  requestVoucher: (req: Permit2VoucherRequest) => Promise<Permit2Voucher>
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  /** session 通道号（nonceKey 隔离并发 agent），缺省 0 */
  agentIndex?: number
}

export interface SponsorPermit2ApprovalResult {
  txHash: Hex
  userOpHash: Hex
  userOp: UserOperationV7
  /** 生效后的授权上限（与 `amount` 一致；0 表示已撤销） */
  amount: bigint
}

/**
 * 用 voucher 赞助执行一次 `approve(Permit2, amount)`，用户零 native。
 *
 * `amount` 必须是**有限预算**（服务端会拒绝 MaxUint256）；预算用尽后再补一笔，
 * 撤销传 `amount: 0n`。
 */
export async function sponsorPermit2Approval(
  p: SponsorPermit2ApprovalParams
): Promise<SponsorPermit2ApprovalResult> {
  const approval = encodePermit2Approval({ token: p.token, amount: p.amount, permit2: p.permit2 })
  const inner = encodeExecute(approval.to, 0n, approval.data)
  const session = p.policy != null && p.slot != null
  const callData = session ? encodeExecuteUserOp(inner) : inner

  const entryPoint = p.chainConfig.entryPoint
  const chainId = p.chainConfig.chainId

  // nonce：root 走 key=0；session 走 validator 隔离通道
  const nonceKey = session
    ? validatorNonceKey(resolveKeelValidator(p.chainConfig, p.slot as number), p.agentIndex ?? 0)
    : 0n
  const nonce = (await p.publicClient.readContract({
    address: entryPoint,
    abi: ENTRYPOINT_NONCE_ABI,
    functionName: 'getNonce',
    args: [p.account, nonceKey],
  })) as bigint

  const probeTotalGas =
    PROBE_GAS.preVerificationGas +
    PROBE_GAS.verificationGasLimit +
    PROBE_GAS.callGasLimit +
    PROBE_PAYMASTER_GAS.paymasterVerificationGasLimit +
    PROBE_PAYMASTER_GAS.paymasterPostOpGasLimit
  const probeMaxCost = probeTotalGas * p.maxFeePerGas

  const voucher = await p.requestVoucher({
    sender: p.account,
    callData,
    maxCost: probeMaxCost,
    chainId,
    gas: {
      ...PROBE_GAS,
      ...PROBE_PAYMASTER_GAS,
      maxFeePerGas: p.maxFeePerGas,
    },
  })

  const policyData = session ? encodeKeelPolicyData(p.policy as SessionPolicy) : null
  const buildOp = (gas: {
    callGasLimit: bigint
    verificationGasLimit: bigint
    preVerificationGas: bigint
  }): UserOperationV7 => ({
    ...buildUserOpWithCallData({
      sender: p.account,
      nonce,
      callData,
      gas: {
        ...gas,
        maxFeePerGas: p.maxFeePerGas,
        maxPriorityFeePerGas: p.maxPriorityFeePerGas,
      },
    }),
    paymaster: voucher.paymaster,
    paymasterData: voucher.paymasterData,
    ...PROBE_PAYMASTER_GAS,
  })

  const signOp = async (op: UserOperationV7): Promise<UserOperationV7> => {
    const hash = getUserOpHash(op, entryPoint, chainId)
    if (!policyData) {
      return { ...op, signature: await p.signer.signUserOp(hash) }
    }
    const sig = await p.signer.signUserOp(keelSessionDigest(hash, policyData))
    return {
      ...op,
      signature: encodeKeelSessionSignature({
        sessionId: toBytes32((p.policy as SessionPolicy).sessionId),
        policyData,
        sig,
      }),
    }
  }

  // 估算会跑真实 paymaster 校验，所以必须先带 voucher 签一次。
  const probed = await signOp(buildOp(PROBE_GAS))
  const est = await p.bundler.estimateUserOperationGas(probed)
  const gas = {
    callGasLimit: est.callGasLimit ?? PROBE_GAS.callGasLimit,
    verificationGasLimit: est.verificationGasLimit ?? PROBE_GAS.verificationGasLimit,
    preVerificationGas: est.preVerificationGas ?? PROBE_GAS.preVerificationGas,
  }
  const estimatedTotalGas =
    gas.preVerificationGas +
    gas.verificationGasLimit +
    gas.callGasLimit +
    PROBE_PAYMASTER_GAS.paymasterVerificationGasLimit +
    PROBE_PAYMASTER_GAS.paymasterPostOpGasLimit
  if (estimatedTotalGas > probeTotalGas) {
    throw new Error(
      `[keel-sdk] permit2 approval gas estimate (${estimatedTotalGas}) exceeds the voucher budget (${probeTotalGas}); retry`
    )
  }

  const op = await signOp(buildOp(gas))
  const sent = await p.bundler.sendUserOperation(op)
  if (!sent.receipt?.success) {
    const detail = JSON.stringify(sent.receipt, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    throw new Error(
      `[keel-sdk] sponsored permit2 approval failed (hash ${sent.userOpHash}): ${detail}`
    )
  }
  const txHash = sent.receipt.txHash
  if (!txHash) throw new Error('[keel-sdk] bundler receipt has no transactionHash')

  return { txHash, userOpHash: sent.userOpHash, userOp: op, amount: p.amount }
}
