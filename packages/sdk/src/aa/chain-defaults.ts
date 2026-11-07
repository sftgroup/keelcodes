// ---------------------------------------------------------------------------
// @keelcodes/sdk — 内置三链 AA 栈地址（B 端零配置起步）
//
// 来源：infraX 生产部署（2026-10 三链同址核验）。
//  - EntryPoint v0.7 / Kernel 官方栈：三链同址（ZeroDev 确定性部署）
//  - KeelSessionValidator 副本 / KeelPolicyHook / KeelTokenPaymaster：三链同址
//  - USDC：三链异址，且 **BSC 为 18 位精度**（其余 6 位）
//
// ⚠️ 均为不可变部署；链上重部署须同步本表。
// ---------------------------------------------------------------------------

import { createPublicClient, http, type Address, type PublicClient } from 'viem'
import { base, bsc, mainnet } from 'viem/chains'
import type { ChainAAConfig } from './types'

export type KeelChain = 'base' | 'bsc' | 'ethereum'

/** EntryPoint v0.7（三链同址） */
export const KEEL_ENTRYPOINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address
/** KeelSessionValidator 副本（slot 0，三链同址） */
export const KEEL_SESSION_VALIDATOR = '0x8BCB3F5d855F5b2a1f1398690Daaa7866992bDE7' as Address
/** KeelPolicyHook 副本（slot 0，与 validator 成对，三链同址） */
export const KEEL_SESSION_HOOK = '0x466b5DC3796D44b0B63FdF2d3bC7a8Ea371a891F' as Address
/** KeelTokenPaymaster（三链同址；gas 垫付 + 稳定币结算 + 0.01 USD 服务费） */
export const KEEL_TOKEN_PAYMASTER = '0x7B3D6f627011dB3125f33540B9123F91b61935D8' as Address
/** Kernel v3 factory（三链同址；首笔 createAccount） */
export const KEEL_KERNEL_FACTORY = '0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419' as Address
/** Kernel v3 root validator（ECDSA，三链同址；账户 owner 验签） */
export const KEEL_ROOT_VALIDATOR = '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57' as Address

export const KEEL_CHAIN_IDS: Record<KeelChain, number> = { base: 8453, bsc: 56, ethereum: 1 }

/** 各链 USDC（BSC 为 Binance-Peg USDC，18 位） */
export const KEEL_USDC: Record<KeelChain, Address> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  bsc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
}

export const KEEL_USDC_DECIMALS: Record<KeelChain, number> = { base: 6, bsc: 18, ethereum: 6 }

/** Keel 托管 bundler（ERC-4337 JSON-RPC，路径即链别名） */
export const KEEL_BUNDLER_URL: Record<KeelChain, string> = {
  base: 'https://keel.codes/v1/bundler/base',
  bsc: 'https://keel.codes/v1/bundler/bsc',
  ethereum: 'https://keel.codes/v1/bundler/ethereum',
}

const VIEM_CHAIN = { base, bsc, ethereum: mainnet } as const

export interface KeelChainOptions {
  rpcUrl?: string
  /** 覆盖 bundler（缺省 `KEEL_BUNDLER_URL[chain]`） */
  bundlerUrl?: string
  bundlerHeaders?: Record<string, string>
  /** 覆盖 validator/hook 副本（仅重部署后需要） */
  sessionValidator?: Address
  sessionHook?: Address
}

/** 取某条链的 ChainAAConfig（内置默认 + 可选覆盖）。 */
export function keelChainConfig(chain: KeelChain, opts: KeelChainOptions = {}): ChainAAConfig {
  return {
    chainId: KEEL_CHAIN_IDS[chain],
    entryPoint: KEEL_ENTRYPOINT_V07,
    rpcUrl: opts.rpcUrl,
    kernelVersion: '0.3.1',
    kernelFactory: KEEL_KERNEL_FACTORY,
    rootValidator: KEEL_ROOT_VALIDATOR,
    sessionValidatorCopies: [opts.sessionValidator ?? KEEL_SESSION_VALIDATOR],
    sessionHookCopies: [opts.sessionHook ?? KEEL_SESSION_HOOK],
    bundlers: [
      {
        url: opts.bundlerUrl ?? KEEL_BUNDLER_URL[chain],
        priority: 0,
        ...(opts.bundlerHeaders ? { headers: opts.bundlerHeaders } : {}),
      },
    ],
  }
}

/** 便捷：创建该链的只读 PublicClient（用于读 EntryPoint nonce 等）。 */
export function keelPublicClient(chain: KeelChain, rpcUrl?: string): PublicClient {
  const transport = rpcUrl ? http(rpcUrl) : http()
  return createPublicClient({ chain: VIEM_CHAIN[chain], transport }) as PublicClient
}
