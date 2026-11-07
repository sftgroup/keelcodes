// ---------------------------------------------------------------------------
// 版本号（单一来源）
// ---------------------------------------------------------------------------
// 直接读 package.json，避免与发布版本漂移（此前 server.ts / telemetry.ts 各写死
// 0.1.0，包发到 0.1.1 后 `serverInfo.version` 与上报的版本仍是 0.1.0）。
// dist/version.js 的上一级即包根，发布包始终带 package.json。
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module'

const pkg = createRequire(import.meta.url)('../package.json') as { version: string }

export const VERSION: string = pkg.version
