import { z } from 'zod'
import { str, optStr, optJson } from './types.js'
import type { ToolDef } from './types.js'

export const paymentTools: ToolDef[] = [
  // ── payment ──
  { name: 'payment_charge', description: '发起收费（内部路由 x402/a2a/batch/invite）', module: 'payment', action: 'charge', schema: { payer: str, amountWei: str, method: z.enum(['x402', 'a2a', 'batch', 'invite']), asset: optStr, chain: optStr, reference: str, metadata: optJson } },
  { name: 'payment_pay', description: '主动付费（账本内转账）', module: 'payment', action: 'pay', schema: { payee: str, amountWei: str, asset: optStr, reference: str, metadata: optJson } },
  { name: 'payment_verify', description: '校验 x402 v2 支付凭证（base64 PAYMENT-SIGNATURE），返回 isValid/payer', module: 'payment', action: 'verify', schema: { paymentSignature: str } },
  { name: 'payment_balance', description: '查余额', module: 'payment', action: 'balance', schema: { address: str, asset: optStr } },
  { name: 'payment_orders', description: '查交易记录', module: 'payment', action: 'orders', schema: { limit: z.number().optional(), offset: z.number().optional(), status: optStr, subscriber: optStr } },
  { name: 'payment_settlement', description: '核验单笔结算（按 reference）', module: 'payment', action: 'settlement', schema: { reference: str } },
  { name: 'payment_access', description: '访问判定/按次扣费', module: 'payment', action: 'access', schema: { subscriber: str, resource: z.unknown() } },
  { name: 'payment_plans', description: '按量套餐价目（公开）：pay-per-use 模式、平台钱包、按次费率表', module: 'payment', action: 'plans', schema: {} },
  { name: 'payment_ledger_balance', description: '预付费账本余额（引擎统一账本，区别于链上余额）', module: 'payment', action: 'ledger_balance', schema: { token: str } },
  // ── payment 旧 index 面：通道发现 / 订阅详情 / 定价 ──
  { name: 'payment_info', description: '支付通道发现：启用的 rail、各链收款钱包 / 价格 / 托管、各链可接受的稳定币', module: 'payment', action: 'info', schema: { chain: optStr } },
  { name: 'payment_subscription_detail', description: '读取链上订阅详情（active / payToken / amountPaid / 周期 / 试用）', module: 'payment', action: 'subscription_detail', schema: { chain: str, subscriber: str, resourceId: z.number() } },
  { name: 'payment_price', description: '读取链上套餐定价（price / period / active）', module: 'payment', action: 'price', schema: { planId: z.number(), chain: optStr } },
  // ── payment 旧 index 面：a2a 链上意图（两阶段）──
  { name: 'payment_a2a_create', description: '创建 a2a 链上支付意图（phase 1）：settlementMode=collector 由 payer 向平台 collector 付款并入账；settlementMode=direct 由 payer 直接付给 payee（payee 必填），平台仅链上核验', module: 'payment', action: 'a2a_create', schema: { subscriber: str, valueWei: str, asset: optStr, chain: optStr, payee: optStr, settlementMode: z.enum(['collector', 'direct']).optional(), expiresIn: z.number().optional(), metadata: optJson } },
  { name: 'payment_a2a_settle', description: '确认 a2a 支付意图（phase 2）：mode=tx 校验链上交易；mode=balance 走账本扣减', module: 'payment', action: 'a2a_settle', schema: { paymentId: str, mode: z.enum(['tx', 'balance']).optional(), txHash: optStr, chain: optStr, subscriber: optStr, amountWei: optStr, asset: optStr, ref: optStr } },
  { name: 'payment_a2a_direct_settle', description: '结算 direct 意图（phase 2）：按 intent 绑定的 payer/payee/asset/精确金额核验链上交易，按链确认数判定终局；202 表示待确认，409 表示已结算/冲突/过期', module: 'payment', action: 'a2a_direct_settle', schema: { paymentId: str, txHash: str } },
  { name: 'payment_a2a_cancel', description: '取消未结算的 direct 意图（幂等）', module: 'payment', action: 'a2a_cancel', schema: { paymentId: str } },
  // ── payment 旧 index 面：批量收款（一付款人对多收款人）──
  { name: 'payment_batch_create', description: '创建批量收款意图（一付款人对多收款人）', module: 'payment', action: 'batch_create', schema: { subscriber: str, items: z.array(z.record(z.unknown())), chain: optStr, metadata: optJson } },
  { name: 'payment_batch_settle', description: '结算批量收款中的一项（提交链上 txHash）', module: 'payment', action: 'batch_settle', schema: { batchId: str, itemId: str, txHash: str, chain: optStr } },
  { name: 'payment_batch_get', description: '读取批量收款状态', module: 'payment', action: 'batch_get', schema: { batchId: str } },
  { name: 'payment_batch_cancel', description: '取消批量收款（未付款项）', module: 'payment', action: 'batch_cancel', schema: { batchId: str } },
  // ── payment 旧 index 面：账单邀请 ──
  { name: 'payment_invite_create', description: '创建账单邀请（payer → payee）', module: 'payment', action: 'invite_create', schema: { payer: str, payee: str, valueWei: str, asset: optStr, chain: optStr, dueAt: optStr, memo: optStr, metadata: optJson } },
  { name: 'payment_invite_list', description: '按地址 + 角色（payer|payee）列出邀请', module: 'payment', action: 'invite_list', schema: { address: str, role: z.enum(['payer', 'payee']), status: optStr } },
  { name: 'payment_invite_get', description: '读取单个邀请详情', module: 'payment', action: 'invite_get', schema: { inviteId: str } },
  { name: 'payment_invite_cancel', description: '取消未结算的邀请', module: 'payment', action: 'invite_cancel', schema: { inviteId: str } },
  { name: 'payment_invite_settle', description: '链上结算邀请（提交 payer txHash）', module: 'payment', action: 'invite_settle', schema: { inviteId: str, txHash: str, chain: optStr } },
  { name: 'payment_invite_pay', description: '用 payer 账本余额支付邀请（无链上交易）', module: 'payment', action: 'invite_pay', schema: { inviteId: str } },
  // ── payment 旧 index 面：账本内转账 ──
  { name: 'payment_transfer_create', description: '请求一笔账本内转账（from → to），确认时原子执行', module: 'payment', action: 'transfer_create', schema: { from: str, to: str, valueWei: str, asset: optStr, reference: optStr, metadata: optJson } },
  { name: 'payment_transfer_list', description: '按地址 + 角色（from|to）列出转账', module: 'payment', action: 'transfer_list', schema: { address: str, role: z.enum(['from', 'to']) } },
  { name: 'payment_transfer_get', description: '读取单笔转账详情', module: 'payment', action: 'transfer_get', schema: { transferId: str } },
  { name: 'payment_transfer_confirm', description: '确认并原子执行转账', module: 'payment', action: 'transfer_confirm', schema: { transferId: str } },
  { name: 'payment_transfer_cancel', description: '取消未执行的转账', module: 'payment', action: 'transfer_cancel', schema: { transferId: str } },
  // ── B19.4 代播费自助面（公开端点：免平台 key，靠 payTo 的 EIP-191 签名）──
  { name: 'payment_settle_fee_balance', description: '查询 B 端代播费预付余额（6 位微单位）。免平台 key，需 payTo 对 `keel-settle-balance:<payTo>` 的 EIP-191 签名', module: 'payment', action: 'settle_fee_balance', schema: { payTo: str, signature: str } },
  { name: 'payment_settle_fee_topup', description: '凭已上链的充值交易自助入账（幂等，同一 tx 只能被一个 payTo 认领）。免平台 key，需 payTo 对 `keel-settle-topup:<chain>:<txHash>:<payTo>` 的 EIP-191 签名', module: 'payment', action: 'settle_fee_topup', schema: { payTo: str, chain: str, txHash: str, signature: str } },
]
