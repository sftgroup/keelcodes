// ---------------------------------------------------------------------------
// @keelcodes/sdk — 类型化错误（对齐契约 §3）
// ---------------------------------------------------------------------------

import type { KeelErrorBody } from './types'

/** 引擎返回非 2xx 时抛出。`status` 为 HTTP 状态码，`code` 为契约错误码。 */
export class KeelApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(`[keel-sdk] ${path} ${status} (${code}): ${(body as KeelErrorBody)?.message ?? 'request failed'}`)
    this.name = 'KeelApiError'
  }
}

export function isKeelApiError(err: unknown): err is KeelApiError {
  return err instanceof KeelApiError
}
