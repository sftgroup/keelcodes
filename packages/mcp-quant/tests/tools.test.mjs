import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TOOLS } from '../dist/tools.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED = ['bars', 'tickers', 'factors', 'ml_predictions', 'trading_calendar']
// 拆开拼接，避免本文件自身触发「发布包不得包含服务 key」的全仓 grep。
const FORBIDDEN = ['KEEL', 'SERVICE', 'KEY'].join('_')

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

test('工具数量为 5', () => {
  assert.equal(TOOLS.length, 5)
})

test('工具名集合精确匹配', () => {
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), [...EXPECTED].sort())
})

test('源码与产物中不出现平台服务 key', () => {
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'dist'))]
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    assert.equal(text.includes(FORBIDDEN), false, `${file} 含平台服务 key 标识`)
  }
})

test('stdio 入口首行是 shebang（否则 npm bin 被当 sh 执行）', () => {
  const first = readFileSync(join(root, 'dist', 'index.js'), 'utf8').split('\n')[0]
  assert.equal(first, '#!/usr/bin/env node')
})

test('serverInfo.version 等于 package.json 版本（防版本漂移）', async () => {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const child = spawn(process.execPath, [join(root, 'dist', 'index.js')], {
    env: { ...process.env, KEEL_API_KEY: 'smoke', KEEL_TELEMETRY: 'off' },
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  try {
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('initialize 超时')), 8000)
      let buf = ''
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString()
        const nl = buf.indexOf('\n')
        if (nl >= 0) {
          clearTimeout(timer)
          resolve(buf.slice(0, nl))
        }
      })
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '0.0.0' },
          },
        }) + '\n',
      )
    })
    assert.equal(JSON.parse(reply).result.serverInfo.version, version)
  } finally {
    child.kill()
  }
})
