// ---------------------------------------------------------------------------
// Keel(v1) session 编码：policyData / 摘要 / 签名布局
//
// 链上契约（KeelSessionValidator + KeelPolicyHook 共用同一份 policyData）：
//   policyData   = abi.encode(version=1, validAfter, validUntil, Rule[])
//   UserOp 摘要  = keccak256(userOpHash ‖ keccak256(policyData))
//   signature    = sessionId(32B) ‖ policyData ‖ sessionKeySig(65B)
// 链上只存 keccak256(policyData) 作为 commitment，因此这里必须逐字节一致。
// ---------------------------------------------------------------------------

import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  isHex,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import type { ChainAAConfig, SessionPolicy, Signer, UserOperationV7 } from './types'
import {
  buildUserOpWithCallData,
  encodeExecute,
  encodeExecuteBatch,
  encodeExecuteUserOp,
  getUserOpHash,
} from './userop'
import { validatorNonceKey } from './nonce'
import { encodeKernelFactoryData, predictAccountAddress } from './kernel-account'

export const KEEL_POLICY_VERSION = 1n

/** bytes32 归一化（已是 0x+64 hex 直接用，否则左对齐补零） */
export function toBytes32(id: string): Hex {
  return (isHex(id) && id.length === 66 ? id : toHex(id, { size: 32 })) as Hex
}

/** 链上 Rule（字段顺序即 ABI 顺序，不可调换） */
export interface KeelRule {
  target: Address
  selectors: Hex[]
  maxPerTx: bigint
  maxDaily: bigint
  maxCalls: bigint
  tokenLimits: KeelTokenLimit[]
}

export interface KeelTokenLimit {
  token: Address
  maxPerTx: bigint
  maxDaily: bigint
}

const KeelTokenLimitTuple = [
  { name: 'token', type: 'address' },
  { name: 'maxPerTx', type: 'uint256' },
  { name: 'maxDaily', type: 'uint256' },
] as const

const KeelRuleTuple = [
  { name: 'target', type: 'address' },
  { name: 'selectors', type: 'bytes4[]' },
  { name: 'maxPerTx', type: 'uint256' },
  { name: 'maxDaily', type: 'uint256' },
  { name: 'maxCalls', type: 'uint256' },
  { name: 'tokenLimits', type: 'tuple[]', components: KeelTokenLimitTuple },
] as const

/**
 * SessionPermission[] → 链上 Rule[]（每条 target 一个 Rule）。
 * tokenLimits 只挂到 `token == target` 的那条 Rule（链上强制同址）。
 */
export function toKeelRules(policy: SessionPolicy): KeelRule[] {
  const rules: KeelRule[] = []
  for (const p of policy.permissions) {
    const limits = p.tokenLimits ?? []
    for (const target of p.targets) {
      rules.push({
        target,
        selectors: [...(p.selectors ?? [])],
        maxPerTx: p.valueLimit ?? 0n,
        maxDaily: p.dailyLimit ?? 0n,
        maxCalls: BigInt(p.countLimit ?? 0),
        tokenLimits: limits
          .filter((t) => t.token.toLowerCase() === target.toLowerCase())
          .map((t) => ({ token: t.token, maxPerTx: t.maxPerTx, maxDaily: t.maxDaily })),
      })
    }
  }
  if (rules.length === 0) {
    throw new Error('[keel-sdk] session policy needs at least one target')
  }
  return rules
}

/** `policyData = abi.encode(version, validAfter, validUntil, Rule[])` */
export function encodeKeelPolicyData(policy: SessionPolicy): Hex {
  return encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'tuple[]', components: KeelRuleTuple },
    ],
    [KEEL_POLICY_VERSION, policy.validAfter, policy.validUntil, toKeelRules(policy)] as never
  )
}

// ---------------------------------------------------------------------------
// owner 侧编码（session 授权安装 / 撤销卸载）
//
// 安装 initData（Kernel v3.1 紧凑布局）：
//   initData = hook(20B) ‖ abi.encode(bytes validatorData, bytes hookData, bytes selectorData)
//   validatorData = enableSession(sessionId, sessionKey, policyData) 完整 calldata
//   hookData      = flag(1B) ‖ abi.encode(bytes32 sessionId, bytes policyData)
//   selectorData  = 0xe9ae5c53（Kernel.execute，恰好 4 字节；长度≠4 时内核静默不 set）
// ⚠️ flag：0x00 = 仅未初始化时调 onInstall；0xff = 强制（同账户换 key 必须用 0xff）。
//
// 撤销 = 一次批量 execute：
//   ① uninstallModule(VALIDATOR=1, validatorCopy, '0x')
//   ② uninstallModule(HOOK=4, hookCopy, abi.encode(bytes32 sessionId))
// 只发①不发②会在 hook 残留 session（union 语义 ⇒ 旧更宽策略仍参与准入）。
// ---------------------------------------------------------------------------

/** Kernel.execute selector（安装期的 selectorData，必须恰好 4 字节） */
export const KEEL_SELECTOR_DATA = '0xe9ae5c53' as Hex
/** hookData flag：仅未初始化时调 onInstall */
export const KEEL_HOOK_FLAG_IF_UNINITIALIZED = '0x00' as Hex
/** hookData flag：强制调 onInstall（同账户轮换/换 key 必须用） */
export const KEEL_HOOK_FLAG_FORCE = '0xff' as Hex

const MODULE_TYPE_VALIDATOR = 1n
const MODULE_TYPE_HOOK = 4n
/** address(1) = Kernel 约定「不挂 hook」 */
const HOOK_NONE = '0x0000000000000000000000000000000000000001' as Address

/** KeelSessionValidator.enableSession(bytes32,address,bytes) */
const KeelSessionValidatorAbi = [
  {
    type: 'function',
    name: 'enableSession',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'sessionKey', type: 'address' },
      { name: 'policyData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

/** Kernel 账户自身的 ERC-7579 模块管理方法 */
const KeelModuleManagerAbi = [
  {
    type: 'function',
    name: 'installModule',
    inputs: [
      { name: 'moduleTypeId', type: 'uint256' },
      { name: 'module', type: 'address' },
      { name: 'initData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'uninstallModule',
    inputs: [
      { name: 'moduleTypeId', type: 'uint256' },
      { name: 'module', type: 'address' },
      { name: 'deInitData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

/** `enableSession(sessionId, sessionKey, policyData)` 完整 calldata（安装期 validatorData） */
export function encodeKeelEnableData(policy: SessionPolicy): Hex {
  return encodeFunctionData({
    abi: KeelSessionValidatorAbi,
    functionName: 'enableSession',
    args: [toBytes32(policy.sessionId), policy.signer, encodeKeelPolicyData(policy)],
  })
}

/** hookData = flag(1B) ‖ abi.encode(sessionId, policyData)（Kernel 剥掉首字节后交给 hook） */
export function encodeKeelHookData(
  policy: SessionPolicy,
  flag: Hex = KEEL_HOOK_FLAG_IF_UNINITIALIZED
): Hex {
  return concatHex([
    flag,
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes' }],
      [toBytes32(policy.sessionId), encodeKeelPolicyData(policy)]
    ),
  ])
}

/** 解析 slot 对应的 hook 副本；未配置返回 address(1)（= 不挂 hook）。 */
export function resolveKeelHook(chainConfig: ChainAAConfig, slot: number): Address {
  return chainConfig.sessionHookCopies?.[slot] ?? HOOK_NONE
}

/** 组装 installModule 的 initData（Kernel v3.1 紧凑布局） */
export function encodeKeelValidatorInstallData(params: {
  enableData: Hex
  hook: Address
  hookData: Hex
  selectorData?: Hex
}): Hex {
  return concatHex([
    params.hook,
    encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }],
      [params.enableData, params.hookData, params.selectorData ?? KEEL_SELECTOR_DATA]
    ),
  ])
}

export interface EncodeKeelEnableSessionCallParams {
  accountAddress: Address
  policy: SessionPolicy
  chainConfig: ChainAAConfig
  /** slot 序号（= validator 副本下标；一 key 一副本） */
  slot: number
  /** 同账户换 key / 轮换必须传 {@link KEEL_HOOK_FLAG_FORCE} */
  hookFlag?: Hex
}

/**
 * owner 侧「安装/授权」callData：
 *   execute( installModule(VALIDATOR, validatorCopy, initData) )
 * 作为 UserOp.callData 由 owner 签名后提交（root nonce；账户未部署时同笔带 factory）。
 */
export function encodeKeelEnableSessionCall(p: EncodeKeelEnableSessionCallParams): Hex {
  const validator = resolveKeelValidator(p.chainConfig, p.slot)
  const hook = resolveKeelHook(p.chainConfig, p.slot)
  const initData = encodeKeelValidatorInstallData({
    enableData: encodeKeelEnableData(p.policy),
    hook,
    hookData: encodeKeelHookData(p.policy, p.hookFlag),
  })
  return encodeExecute(
    p.accountAddress,
    0n,
    encodeFunctionData({
      abi: KeelModuleManagerAbi,
      functionName: 'installModule',
      args: [MODULE_TYPE_VALIDATOR, validator, initData],
    })
  )
}

export interface EncodeKeelUninstallCallParams {
  accountAddress: Address
  chainConfig: ChainAAConfig
  slot: number
  /** 该 slot 的 sessionId（hook 段 onUninstall 必需） */
  sessionId: string
}

/**
 * owner 侧「撤销」callData（validator + hook 两段批量；无 hook 时单段）。
 * 走 root nonce，owner 裸签 getUserOpHash；**不需要** invalidateNonce。
 */
export function encodeKeelUninstallCall(p: EncodeKeelUninstallCallParams): Hex {
  const validator = resolveKeelValidator(p.chainConfig, p.slot)
  const hook = resolveKeelHook(p.chainConfig, p.slot)
  const uninstallValidator = encodeFunctionData({
    abi: KeelModuleManagerAbi,
    functionName: 'uninstallModule',
    args: [MODULE_TYPE_VALIDATOR, validator, '0x'],
  })
  if (hook === HOOK_NONE) {
    return encodeExecute(p.accountAddress, 0n, uninstallValidator)
  }
  const uninstallHook = encodeFunctionData({
    abi: KeelModuleManagerAbi,
    functionName: 'uninstallModule',
    args: [MODULE_TYPE_HOOK, hook, encodeAbiParameters([{ type: 'bytes32' }], [toBytes32(p.sessionId)])],
  })
  return encodeExecuteBatch([
    { target: p.accountAddress, data: uninstallValidator },
    { target: p.accountAddress, data: uninstallHook },
  ])
}

/** 解析 slot 对应的 validator 副本地址（缺配置直接抛错，不回退旧模块）。 */
export function resolveKeelValidator(chainConfig: ChainAAConfig, slot: number): Address {
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error(`[keel-sdk] invalid slot: ${slot}`)
  }
  const copy = chainConfig.sessionValidatorCopies?.[slot]
  if (copy) return copy
  throw new Error(`[keel-sdk] no keel session validator for slot ${slot}`)
}

/** agent 侧签名对象：digest = keccak256(userOpHash ‖ keccak256(policyData)) */
export function keelSessionDigest(userOpHash: Hex, policyData: Hex): Hex {
  return keccak256(concatHex([userOpHash, keccak256(policyData)]))
}

/** agent 侧 userOp.signature 组装：sessionId(32B) ‖ policyData ‖ sessionKeySig(65B)。 */
export function encodeKeelSessionSignature(p: { sessionId: string; policyData: Hex; sig: Hex }): Hex {
  return concatHex([toBytes32(p.sessionId), p.policyData, p.sig])
}

/** EntryPoint v0.7 getNonce(address,uint192) */
const ENTRYPOINT_GETNONCE_ABI = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256)',
])

export interface BuildKeelSessionUserOpParams {
  /** 未传 nonce 时用于读链上 getNonce；传 nonce（relay 预分配）时可不给 */
  client?: PublicClient
  chainConfig: ChainAAConfig
  account: Address
  /** session 策略（复算 policyData = 链上 commitment，须与 enable 时逐字节一致） */
  policy: SessionPolicy
  /** slot 序号（= validator 副本下标；一 key 一副本） */
  slot: number
  /** 该 key 的 agent 通道号（nonceKey 隔离多 agent 并发）；缺省 0 */
  agentIndex?: number | bigint
  /**
   * nonce 整值（= `nonceKey<<64 | sequence`），由 relay `POST /v1/wallet/session/nonce/allocate`
   * 预分配后回传。缺省则读链上当前 getNonce（单 agent 串行场景）。
   */
  nonce?: bigint
  call: { target: Address; value?: bigint; data: Hex }
  /** agent（session key）签名者 */
  agentSigner: Signer
  gas?: Partial<
    Pick<
      UserOperationV7,
      'callGasLimit' | 'verificationGasLimit' | 'preVerificationGas' | 'maxFeePerGas' | 'maxPriorityFeePerGas'
    >
  >
}

/**
 * v1（Keel）agent 侧调用 UserOp 构造（已签名）：
 *   nonce    = 预分配整值，或 `EntryPoint.getNonce(account, validatorNonceKey(validator, agentIndex))`
 *   callData = `executeUserOp( execute(target,value,data) )` —— 挂真 hook 时必需
 *   signature= sessionId ‖ policyData ‖ agentSig(keccak256(userOpHash ‖ keccak256(policyData)))
 *
 * 与 aa-sdk 的 `buildKeelSessionUserOp` 逐字节一致（同输入同输出）。
 */
export async function buildKeelSessionUserOp(p: BuildKeelSessionUserOpParams): Promise<UserOperationV7> {
  const validator = resolveKeelValidator(p.chainConfig, p.slot)
  // agentIndex（通道号）落在 nonceKey 低 16 位（uint16）⇒ 合法 0..65535；
  // 超界会被 ValidatorLib 静默截断到别的通道，故在 SDK 边界显式拒绝。
  const agentIndex = p.agentIndex ?? 0
  if (BigInt(agentIndex) < 0n || BigInt(agentIndex) > 65535n) {
    throw new Error(
      `[keel-sdk] buildKeelSessionUserOp: agentIndex 必须在 0..65535（uint16 通道号），got ${agentIndex}`
    )
  }
  let nonce = p.nonce
  if (nonce === undefined) {
    if (!p.client) {
      throw new Error('[keel-sdk] buildKeelSessionUserOp: 未传 nonce 时必须提供 client（用于读链上 getNonce）')
    }
    nonce = (await p.client.readContract({
      address: p.chainConfig.entryPoint,
      abi: ENTRYPOINT_GETNONCE_ABI,
      functionName: 'getNonce',
      args: [p.account, validatorNonceKey(validator, agentIndex)],
    })) as bigint
  }
  const callData = encodeExecuteUserOp(encodeExecute(p.call.target, p.call.value ?? 0n, p.call.data))
  const op = buildUserOpWithCallData({ sender: p.account, nonce, callData, gas: p.gas })
  const userOpHash = getUserOpHash(op, p.chainConfig.entryPoint, p.chainConfig.chainId)
  const policyData = encodeKeelPolicyData(p.policy)
  const sig = await p.agentSigner.signUserOp(keelSessionDigest(userOpHash, policyData))
  return { ...op, signature: encodeKeelSessionSignature({ sessionId: p.policy.sessionId, policyData, sig }) }
}

// ---------------------------------------------------------------------------
// owner 侧 UserOp 构造（未签名）：op + owner 需裸签的 32 字节摘要
//
// owner 走 root 通道：nonce = EntryPoint.getNonce(account, 0)（nonceKey=0 ⇒ vType=ROOT），
// digest = EntryPoint.getUserOpHash(op, entryPoint, chainId)。
// owner 用 `account.sign({ hash: digest })`（裸 secp256k1）或 eth_sign（EIP-191）均可 ——
// Kernel ECDSAValidator 两条验签路径都接受，**不需要 EIP-712 / eth_signTypedData_v4**。
//
// ⚠️ 不要用 ENABLE 模式 + session validator 通道提交：enableCallData 是
//    `execute(installModule(...))`，验证阶段 Keel validator 尚未安装，必须由 root 验签。
// ---------------------------------------------------------------------------

export type UserOpGasOverrides = Partial<
  Pick<
    UserOperationV7,
    'callGasLimit' | 'verificationGasLimit' | 'preVerificationGas' | 'maxFeePerGas' | 'maxPriorityFeePerGas'
  >
>

/** owner 侧草稿：op 未签名；owner 对 `userOpHash` 签名后填入 `op.signature`。 */
export interface OwnerUserOpDraft {
  account: Address
  op: UserOperationV7
  /** owner 需签名的摘要（= EntryPoint.getUserOpHash） */
  userOpHash: Hex
}

/** root 通道 nonce：key=0 ⇒ mode=DEFAULT / vType=ROOT。 */
async function readRootNonce(
  client: PublicClient,
  entryPoint: Address,
  account: Address
): Promise<bigint> {
  return (await client.readContract({
    address: entryPoint,
    abi: ENTRYPOINT_GETNONCE_ABI,
    functionName: 'getNonce',
    args: [account, 0n],
  })) as bigint
}

export interface BuildOwnerEnableUserOpParams {
  /** 未传 nonce（且 deploy 需派生地址）时必须提供 */
  client?: PublicClient
  chainConfig: ChainAAConfig
  /** owner EOA（root validator 的 owner） */
  owner: Address
  /** 账户地址；`deploy` 时可省略（用 factory.getAddress 反事实派生） */
  account?: Address
  /** relay `POST /v1/wallet/session` 返回的 enableCallData（优先） */
  enableCallData?: Hex
  /** 或本地由 policy 编码（与 enableCallData 二选一） */
  policy?: SessionPolicy
  /** validator 副本下标 */
  slot: number
  /** 同账户换 key / 轮换传 {@link KEEL_HOOK_FLAG_FORCE} */
  hookFlag?: Hex
  /** 账户未部署时传 true（salt=0）或 `{ salt }`：自动带 factory + factoryData */
  deploy?: boolean | { salt?: bigint }
  nonce?: bigint
  gas?: UserOpGasOverrides
}

/**
 * 首笔 / 后续 owner 授权（enable session）UserOp 构造（未签名）：
 *   callData = enableCallData ?? execute(installModule(KeelSessionValidator, ...))
 *   factory  = 仅在 `deploy` 时携带（relay **不会**代部署）
 *   nonce    = root `getNonce(account, 0)`
 *   digest   = getUserOpHash(op) → owner 裸签
 */
export async function buildOwnerEnableUserOp(
  p: BuildOwnerEnableUserOpParams
): Promise<OwnerUserOpDraft> {
  if (!p.enableCallData && !p.policy) {
    throw new Error('[keel-sdk] buildOwnerEnableUserOp: enableCallData 与 policy 至少提供一个')
  }
  const deploy = p.deploy === true ? {} : p.deploy
  let factory: Address | undefined
  let factoryData: Hex | undefined
  let account = p.account
  if (deploy) {
    const built = encodeKernelFactoryData(p.chainConfig, p.owner, deploy.salt ?? 0n)
    factory = built.factory
    factoryData = built.factoryData
    if (!account) {
      if (!p.client) {
        throw new Error(
          '[keel-sdk] buildOwnerEnableUserOp: deploy 且未传 account 时必须提供 client（用于反事实地址预测）'
        )
      }
      account = await predictAccountAddress({
        client: p.client,
        chainConfig: p.chainConfig,
        owner: p.owner,
        salt: deploy.salt ?? 0n,
      })
    }
  }
  if (!account) {
    throw new Error('[keel-sdk] buildOwnerEnableUserOp: account 必填（首笔部署请传 deploy: true）')
  }
  const callData =
    p.enableCallData ??
    encodeKeelEnableSessionCall({
      accountAddress: account,
      policy: p.policy!,
      chainConfig: p.chainConfig,
      slot: p.slot,
      hookFlag: p.hookFlag,
    })
  let nonce = p.nonce
  if (nonce === undefined) {
    if (!p.client) {
      throw new Error('[keel-sdk] buildOwnerEnableUserOp: 未传 nonce 时必须提供 client')
    }
    nonce = await readRootNonce(p.client, p.chainConfig.entryPoint, account)
  }
  const op = buildUserOpWithCallData({
    sender: account,
    nonce,
    callData,
    factory,
    factoryData,
    gas: p.gas,
  })
  return {
    account,
    op,
    userOpHash: getUserOpHash(op, p.chainConfig.entryPoint, p.chainConfig.chainId),
  }
}

export interface BuildOwnerRevokeUserOpParams {
  /** 未传 nonce 时必须提供 */
  client?: PublicClient
  chainConfig: ChainAAConfig
  account: Address
  slot: number
  sessionId: string
  nonce?: bigint
  gas?: UserOpGasOverrides
}

/**
 * owner 撤销（revoke）UserOp 构造（未签名）：
 *   callData = executeBatch[uninstallModule(VALIDATOR), uninstallModule(HOOK, sessionId)]
 *   nonce    = root `getNonce(account, 0)`
 *   digest   = getUserOpHash(op) → owner 裸签
 * 上链成功后 policy 随 hook.onUninstall 一并清除，**不需要** invalidateNonce。
 */
export async function buildOwnerRevokeUserOp(
  p: BuildOwnerRevokeUserOpParams
): Promise<OwnerUserOpDraft> {
  const callData = encodeKeelUninstallCall({
    accountAddress: p.account,
    chainConfig: p.chainConfig,
    slot: p.slot,
    sessionId: p.sessionId,
  })
  let nonce = p.nonce
  if (nonce === undefined) {
    if (!p.client) {
      throw new Error('[keel-sdk] buildOwnerRevokeUserOp: 未传 nonce 时必须提供 client')
    }
    nonce = await readRootNonce(p.client, p.chainConfig.entryPoint, p.account)
  }
  const op = buildUserOpWithCallData({ sender: p.account, nonce, callData, gas: p.gas })
  return {
    account: p.account,
    op,
    userOpHash: getUserOpHash(op, p.chainConfig.entryPoint, p.chainConfig.chainId),
  }
}
