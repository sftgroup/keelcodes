import { z } from 'zod'
import { str, optStr, optJson } from './types.js'
import type { ToolDef } from './types.js'

export const accountTools: ToolDef[] = [
  // ── account ──
  { name: 'account_tenant_create', description: '创建租户', module: 'account', action: 'tenant_create', schema: { name: str, metadata: optJson } },
  { name: 'account_tenant_get', description: '查询租户', module: 'account', action: 'tenant_get', schema: { tenantId: str } },
  { name: 'account_apikey_create', description: '按模块签发 API key', module: 'account', action: 'apikey_create', schema: { tenantId: str, module: z.enum(['payment', 'wallet', 'data', 'account']), reference: optStr } },
  { name: 'account_apikey_revoke', description: '撤销 API key（按 key id）', module: 'account', action: 'apikey_revoke', schema: { id: str } },
  { name: 'account_subscription_get', description: '查询模块订阅', module: 'account', action: 'subscription_get', schema: { module: z.enum(['payment', 'wallet', 'data', 'account']) } },
  { name: 'account_subscription_subscribe', description: '订阅模块', module: 'account', action: 'subscription_subscribe', schema: { module: z.enum(['payment', 'wallet', 'data', 'account']), planId: str, reference: optStr } },
  { name: 'account_subscription_cancel', description: '取消模块订阅', module: 'account', action: 'subscription_cancel', schema: { module: z.enum(['payment', 'wallet', 'data', 'account']) } },
]
