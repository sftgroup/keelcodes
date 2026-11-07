// ---------------------------------------------------------------------------
// 最小 ERC-4337 bundler 客户端（JSON-RPC over HTTP）
//
// 只覆盖 session 付款需要的三件事：
//   eth_estimateUserOperationGas / eth_sendUserOperation / eth_getUserOperationReceipt
// Keel 托管端点：`https://keel.codes/v1/bundler/{chain}`（可自定义 headers 带鉴权）。
// ---------------------------------------------------------------------------

import type { Address, Hex } from 'viem'
import type { BundlerLike, UserOpReceipt, UserOpResult, UserOperationV7 } from './types'
import { userOpToRpc } from './userop'

export interface BundlerClientOptions {
  url: string
  entryPoint: Address
  headers?: Record<string, string>
  /** 单次 HTTP 超时（ms），默认 30s */
  timeoutMs?: number
  /** 收据轮询间隔（ms），默认 1s */
  pollIntervalMs?: number
  /** 等收据总超时（ms），默认 120s */
  waitTimeoutMs?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class BundlerClient implements BundlerLike {
  private readonly url: string
  private readonly entryPoint: Address
  private readonly headers: Record<string, string>
  private readonly timeoutMs: number
  private readonly pollIntervalMs: number
  private readonly waitTimeoutMs: number
  private nextId = 1

  constructor(opts: BundlerClientOptions) {
    this.url = opts.url
    this.entryPoint = opts.entryPoint
    this.headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
    this.timeoutMs = opts.timeoutMs ?? 30_000
    this.pollIntervalMs = opts.pollIntervalMs ?? 1_000
    this.waitTimeoutMs = opts.waitTimeoutMs ?? 120_000
  }

  async estimateUserOperationGas(
    op: UserOperationV7
  ): Promise<
    Partial<Pick<UserOperationV7, 'callGasLimit' | 'verificationGasLimit' | 'preVerificationGas'>>
  > {
    const r = await this.rpc<{
      callGasLimit: Hex
      verificationGasLimit: Hex
      preVerificationGas: Hex
    }>('eth_estimateUserOperationGas', [userOpToRpc(op), this.entryPoint])
    return {
      callGasLimit: BigInt(r.callGasLimit),
      verificationGasLimit: BigInt(r.verificationGasLimit),
      preVerificationGas: BigInt(r.preVerificationGas),
    }
  }

  async sendUserOperation(op: UserOperationV7): Promise<UserOpResult> {
    const userOpHash = await this.rpc<Hex>('eth_sendUserOperation', [
      userOpToRpc(op),
      this.entryPoint,
    ])
    const receipt = await this.waitForReceipt(userOpHash)
    return { userOpHash, bundlerUrl: this.url, receipt }
  }

  /** 轮询 `eth_getUserOperationReceipt`；超时抛错（不静默返回未确认）。 */
  async waitForReceipt(userOpHash: Hex): Promise<UserOpReceipt> {
    const deadline = Date.now() + this.waitTimeoutMs
    let lastErr: unknown
    while (Date.now() < deadline) {
      try {
        const r = await this.rpc<{
          transactionHash?: Hex
          receipt?: { transactionHash?: Hex }
          success: boolean
          actualGasCost: Hex
          actualGasUsed: Hex
          logs?: unknown[]
        } | null>('eth_getUserOperationReceipt', [userOpHash])
        if (r) {
          return {
            txHash: r.transactionHash ?? r.receipt?.transactionHash,
            success: r.success,
            actualGasCost: BigInt(r.actualGasCost),
            actualGasUsed: BigInt(r.actualGasUsed),
            logs: r.logs ?? [],
          }
        }
      } catch (e) {
        // 轮询期 RPC 抖动不致命
        lastErr = e
      }
      await sleep(this.pollIntervalMs)
    }
    throw new Error(
      `[keel-sdk] userOp receipt timeout after ${this.waitTimeoutMs}ms (${userOpHash})` +
        (lastErr instanceof Error ? `: ${lastErr.message}` : '')
    )
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    const json = (await res.json().catch(() => null)) as
      | { result?: T; error?: { code?: number; message?: string; data?: unknown } }
      | null
    if (!res.ok || !json || json.error) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`
      const data = json?.error?.data ? ` ${JSON.stringify(json.error.data).slice(0, 300)}` : ''
      throw new Error(`[keel-sdk] bundler ${method} failed: ${msg}${data}`)
    }
    return json.result as T
  }
}
