import { z } from 'zod'
import { str, optStr, optJson, numOrStr } from './types.js'
import type { ToolDef } from './types.js'

export const dataTools: ToolDef[] = [
  // ── data ──
  { name: 'data_bars', description: '取 K线', module: 'data', action: 'bars', schema: { symbol: str, timeframe: optStr, marketType: optStr, start: z.number().optional(), end: z.number().optional(), limit: z.number().optional() } },
  { name: 'data_tickers', description: '取实时行情', module: 'data', action: 'tickers', schema: { symbols: z.union([z.string(), z.array(z.string())]), marketType: optStr } },
  { name: 'data_factors', description: '取因子', module: 'data', action: 'factors', schema: { symbols: optStr, category: optStr } },
  { name: 'data_graph', description: '取图谱', module: 'data', action: 'graph', schema: { symbol: optStr, entity: optStr } },
  { name: 'data_predictions', description: '取 ML 预测', module: 'data', action: 'predictions', schema: { model: z.enum(['bolt', 'moirai', 'timesfm']), symbol: str, start: z.number().optional(), end: z.number().optional(), limit: z.number().optional() } },
  { name: 'data_events', description: '取事件流', module: 'data', action: 'events', schema: { chain: optStr, address: optStr, contract: optStr, eventType: optStr, category: optStr, fromBlock: optStr, toBlock: optStr, limit: z.number().optional() } },
  { name: 'data_rag', description: '知识检索', module: 'data', action: 'rag', schema: { query: str, topK: z.number().optional() } },
  // ── data · DC（数据中心）面 ──
  { name: 'data_stats', description: 'DC 统计（事件总数 / 活跃链）', module: 'data', action: 'stats', schema: {} },
  { name: 'data_checkpoints', description: '各链区块索引检查点', module: 'data', action: 'checkpoints', schema: { chain: optStr } },
  { name: 'data_plans', description: 'DC 订阅套餐价目', module: 'data', action: 'plans', schema: {} },
  { name: 'data_tokens', description: '支持的代币列表（含元数据）', module: 'data', action: 'tokens', schema: { chain: optStr } },
  { name: 'data_chains', description: '支持的区块链网络列表', module: 'data', action: 'chains', schema: {} },
  { name: 'data_event_categories', description: '事件业务分类目录', module: 'data', action: 'event_categories', schema: {} },
  { name: 'data_event_stats', description: '按业务分类聚合的事件计数', module: 'data', action: 'event_stats', schema: { chain: optStr } },
  { name: 'data_subscription_subscribe', description: '订阅 DC 套餐（免费即时生效返 key，付费返支付意图）', module: 'data', action: 'subscription_subscribe', schema: { planId: str, rail: optStr, walletAddress: str } },
  { name: 'data_subscription_payment_check', description: '轮询 DC 订阅支付状态', module: 'data', action: 'subscription_payment_check', schema: { walletAddress: str } },
  { name: 'data_subscription_verify', description: '确认 DC 订阅的 x402 支付（提交 txHash）', module: 'data', action: 'subscription_verify', schema: { txHash: str, walletAddress: str } },
  { name: 'data_subscription_usage', description: '读取 DC 订阅用量', module: 'data', action: 'subscription_usage', schema: { walletAddress: str } },
  { name: 'data_price', description: '实时代币价格（Binance 公共 API，USDT 对）', module: 'data', action: 'price', schema: { symbol: str } },
  // ── data · Market（DEX 行情 / 监控 / 订阅）面 ──
  { name: 'data_market_search', description: '按名称/符号搜索 DEX 代币（DexScreener）', module: 'data', action: 'market_search', schema: { keyword: str, chainIndex: optStr, limit: optStr } },
  { name: 'data_market_hot', description: '热门 DEX 池（GeckoTerminal trending）', module: 'data', action: 'market_hot', schema: { chainIndex: optStr, limit: optStr } },
  { name: 'data_market_candles', description: 'DEX 代币 K 线（OHLCV）', module: 'data', action: 'market_candles', schema: { chainIndex: str, tokenAddress: str, period: optStr, limit: optStr } },
  { name: 'data_market_price', description: 'DEX 代币实时价', module: 'data', action: 'market_price', schema: { chainIndex: str, tokenAddress: str } },
  { name: 'data_market_track_token', description: '把代币加入监控列表（自动采集 K 线 / 快照）', module: 'data', action: 'market_track_token', schema: { chain: str, tokenAddress: str, label: optStr } },
  { name: 'data_market_list_tracked', description: '列出监控中的代币', module: 'data', action: 'market_list_tracked', schema: { chain: optStr } },
  { name: 'data_market_register_event', description: '注册自定义事件签名（topicHash + eventType，可选 ABI）', module: 'data', action: 'market_register_event', schema: { chain: str, topicHash: str, eventType: str, eventName: optStr, abi: z.unknown().optional() } },
  { name: 'data_market_subscription_plans', description: 'Market 订阅套餐价目', module: 'data', action: 'market_subscription_plans', schema: {} },
  { name: 'data_market_subscription_checkout', description: '发起 Market 订阅支付（免费即时生效；付费返支付意图）', module: 'data', action: 'market_subscription_checkout', schema: { plan_id: str, rail: optStr, subscriber: optStr } },
  { name: 'data_market_subscription_payment_check', description: '轮询 Market 订阅支付状态', module: 'data', action: 'market_subscription_payment_check', schema: { subscriber: optStr } },
  { name: 'data_market_subscription_verify', description: '确认 Market 订阅的 x402 支付（提交 txHash）', module: 'data', action: 'market_subscription_verify', schema: { txHash: str } },
  { name: 'data_market_subscription_usage', description: '读取 Market 订阅用量', module: 'data', action: 'market_subscription_usage', schema: {} },
  // ── data · Factor 工厂（因子挖掘）──
  { name: 'data_factor_start', description: '创建因子挖掘任务（preferences/constraints/formulas；intent 走 LLM 解析）。返回 job_id', module: 'data', action: 'factor_start', schema: { preferences: optJson, constraints: optJson, formulas: z.array(z.string()).optional(), intent: optStr } },
  { name: 'data_factor_status', description: '查询因子挖掘任务状态（含 stage 细分：pool/eval/select/persist）', module: 'data', action: 'factor_status', schema: { jobId: str } },
  { name: 'data_factor_result', description: '查询因子挖掘任务结果（合格因子列表 + 统计）', module: 'data', action: 'factor_result', schema: { jobId: str } },
  { name: 'data_factor_list', description: '最近因子挖掘任务列表', module: 'data', action: 'factor_list', schema: { limit: z.number().optional() } },
  { name: 'data_factor_cancel', description: '取消因子挖掘任务（排队/运行中可取消）', module: 'data', action: 'factor_cancel', schema: { jobId: str } },
  // ── data 旧 hub 面：行情 / 符号 / 快照 / 因子历史 / 券商策略 ──
  { name: 'data_ticker', description: '取单符号最新行情（ticker）', module: 'data', action: 'ticker', schema: { symbol: str } },
  { name: 'data_symbols', description: '列出受支持交易符号（可按市场 / 数量过滤）', module: 'data', action: 'symbols', schema: { market: optStr, limit: z.number().optional() } },
  { name: 'data_symbol_search', description: '模糊搜索符号（跨市场：crypto/usstock/forex/futures/cnstock/hkstock）', module: 'data', action: 'symbol_search', schema: { keyword: str, market: optStr, limit: z.number().optional() } },
  { name: 'data_symbol_resolve', description: '解析原始符号关键词为规范交易符号（如 BTC -> BTCUSDT）', module: 'data', action: 'symbol_resolve', schema: { symbol: str, market: optStr } },
  { name: 'data_broker_policy', description: '券商市场策略（各市场主交易场所）', module: 'data', action: 'broker_policy', schema: {} },
  { name: 'data_factors_history', description: '取因子历史序列（按符号 + 因子 id + 时间窗）', module: 'data', action: 'factors_history', schema: { symbol: str, factor: str, start: z.number().optional(), end: z.number().optional(), limit: z.number().optional() } },
  { name: 'data_snapshots', description: '取快照数据（macro / onchain / defi_tvl / indices…）', module: 'data', action: 'snapshots', schema: { type: optStr, date: optStr, limit: z.number().optional() } },
]
