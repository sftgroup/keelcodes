// A7.4：per-user 身份与出站 key 选择。
// 跑法：npm test（先 tsc 到 dist，再用 node:test 跑 dist）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { moduleOfUserKey, requestContext } from '../dist/request-context.js'
import { clientFor } from '../dist/client.js'
import { startHttpServer } from '../dist/server.js'

const inContext = (userKey, fn) => requestContext.run({ userKey }, fn)

test('moduleOfUserKey 只接受 sk_<module>_* 形状', () => {
  assert.equal(moduleOfUserKey('sk_data_abc'), 'data')
  assert.equal(moduleOfUserKey('sk_wallet_abc'), 'wallet')
  assert.equal(moduleOfUserKey('sk_payment_abc'), 'payment')
  assert.equal(moduleOfUserKey('sk_account_abc'), 'account')
  // 未知模块 / 其他前缀 / 空值都不算 per-user key（仍可能命中运维白名单）
  assert.equal(moduleOfUserKey('sk_unknown_abc'), null)
  assert.equal(moduleOfUserKey('px_data_abc'), null)
  assert.equal(moduleOfUserKey('data_abc'), null)
  assert.equal(moduleOfUserKey(''), null)
})

test('clientFor：同一用户 key 复用实例，不同用户 key 互不串用', async () => {
  const u1 = { key: 'sk_data_user1', module: 'data' }
  const u2 = { key: 'sk_data_user2', module: 'data' }
  const a = await inContext(u1, async () => clientFor('data'))
  const a2 = await inContext(u1, async () => clientFor('data'))
  const b = await inContext(u2, async () => clientFor('data'))
  assert.equal(a, a2, '同一 key 应命中缓存')
  assert.notEqual(a, b, '不同 key 必须是不同客户端（否则会串租户）')
})

test('clientFor：key 模块与工具模块不匹配时给出可操作错误（account 例外）', async () => {
  const dataKey = { key: 'sk_data_user1', module: 'data' }
  await assert.rejects(
    inContext(dataKey, async () => clientFor('wallet')),
    /sk_wallet_\* key/,
  )
  // account 面按钱包签名鉴权、不走 sk_ 闸门，因此不因 key 模块不匹配而拒绝
  assert.ok(await inContext(dataKey, async () => clientFor('account')))
})

test('clientFor：无用户 key 时回落到运维客户端', () => {
  assert.ok(clientFor('data'))
  assert.ok(clientFor('payment'))
})

test('HTTP 入站：允许 sk_<module>_*，拒绝非 keel key', async () => {
  delete process.env.MCP_API_KEY
  process.env.MCP_ALLOW_USER_KEYS = 'on'
  const port = 31000 + Math.floor(Math.random() * 1000)
  const server = await startHttpServer(port)
  try {
    const url = `http://127.0.0.1:${port}/mcp/message`
    const init = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'a7.4-test', version: '0' },
      },
    }
    const post = (key) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(init),
      })

    const ok = await post('sk_data_fake_key_for_auth_only')
    assert.equal(ok.status, 200, await ok.clone().text())

    const denied = await post('not-a-keel-key')
    assert.equal(denied.status, 401)
    const body = await denied.json()
    assert.equal(body.code, 'UNAUTHORIZED')
    assert.match(body.message, /sk_<module>_\* API key/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
