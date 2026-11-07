// ---------------------------------------------------------------------------
// 匿名使用指标（A8.8）
// ---------------------------------------------------------------------------
// 只上报「事件 + 包名 + 版本」，**不含**调用的工具、标的、prompt 或任何返回数据。
// 发送是 fire-and-forget（2s 超时、失败静默），绝不阻塞工具调用。
// `KEEL_TELEMETRY=off` 可整体关闭；未配置 `KEEL_API_KEY` 时不上报。
//
// 事件：
//   install         —— 进程启动（服务被装上并成功拉起）
//   activate        —— 本进程内首次成功工具调用（激活率分子）
//   quota_exhausted —— 遇到 429 / 额度不足（免费额度用完率）
// 服务端按（天, owner, 包, 版本, 事件）聚合，见 projects/data app/routers/mcp_telemetry.py
// ---------------------------------------------------------------------------
import { KEEL_API_BASE } from './client.js'
import { VERSION } from './version.js'

export type TelemetryEvent = 'install' | 'activate' | 'quota_exhausted'

const PACKAGE_NAME = '@keelcodes/mcp-market'
const TELEMETRY_PATH = '/v1/data/mcp/telemetry'

let activated = false

function disabled(): boolean {
  return String(process.env.KEEL_TELEMETRY ?? '').trim().toLowerCase() === 'off'
}

/** 上报一次事件（不抛错、不等待）。 */
export function trackTelemetry(event: TelemetryEvent): void {
  if (disabled()) return
  const apiKey = process.env.KEEL_API_KEY
  if (!apiKey || !apiKey.trim()) return
  if (event === 'activate') {
    if (activated) return
    activated = true
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2_000)
  timer.unref?.()
  void fetch(`${KEEL_API_BASE.replace(/\/+$/, '')}${TELEMETRY_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify({ event, package: PACKAGE_NAME, version: VERSION }),
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timer))
}

/** 测试用：重置「本次进程已上报 activate」标记。 */
export function resetTelemetryForTests(): void {
  activated = false
}
