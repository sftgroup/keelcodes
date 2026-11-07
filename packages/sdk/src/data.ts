// ---------------------------------------------------------------------------
// @keelcodes/sdk — data 模块（7 动作）
// ---------------------------------------------------------------------------

import { HttpClient } from './http'

export interface BarsParams {
  symbol: string
  timeframe?: string
  marketType?: 'spot' | 'swap'
  start?: number
  end?: number
  limit?: number
}

export interface BarsResult {
  symbol: string
  bars: Record<string, unknown>[]
}

export interface TickersParams {
  symbols: string | string[]
  marketType?: 'spot' | 'swap'
}

export interface TickersResult {
  items: Record<string, unknown>[]
  missing: string[]
}

export interface FactorsParams {
  symbols?: string
  category?: string
}

export interface FactorsResult {
  factors: Record<string, unknown>
  values: Record<string, Record<string, number>>
}

export interface GraphParams {
  symbol?: string
  entity?: string
}

export interface GraphResult {
  entities: unknown[]
  edges: unknown[]
}

export interface PredictParams {
  model: 'bolt' | 'moirai' | 'timesfm'
  symbol: string
  start?: number
  end?: number
  limit?: number
}

export interface PredictResult {
  predictions: unknown[]
}

export interface EventsParams {
  chain?: string
  address?: string
  contract?: string
  eventType?: string
  category?: string
  fromBlock?: string
  toBlock?: string
  limit?: number
}

export interface EventsResult {
  events: unknown[]
}

export interface RagParams {
  query: string
  topK?: number
}

export interface RagResult {
  results: unknown[]
}

export class DataAPI {
  constructor(private http: HttpClient) {}

  bars(params: BarsParams): Promise<BarsResult> {
    const q = new URLSearchParams({ symbol: params.symbol })
    if (params.timeframe) q.set('timeframe', params.timeframe)
    if (params.marketType) q.set('market_type', params.marketType)
    if (params.start) q.set('start', String(params.start))
    if (params.end) q.set('end', String(params.end))
    if (params.limit) q.set('limit', String(params.limit))
    return this.http.get<BarsResult>('/v1/data/bars?' + q.toString())
  }

  tickers(params: TickersParams): Promise<TickersResult> {
    const symbols = Array.isArray(params.symbols) ? params.symbols.join(',') : params.symbols
    const q = new URLSearchParams({ symbols })
    if (params.marketType) q.set('market_type', params.marketType)
    return this.http.get<TickersResult>('/v1/data/tickers?' + q.toString())
  }

  factors(params: FactorsParams = {}): Promise<FactorsResult> {
    const q = new URLSearchParams()
    if (params.symbols) q.set('symbols', params.symbols)
    if (params.category) q.set('category', params.category)
    return this.http.get<FactorsResult>('/v1/data/factors?' + q.toString())
  }

  graph(params: GraphParams = {}): Promise<GraphResult> {
    const q = new URLSearchParams()
    if (params.symbol) q.set('symbol', params.symbol)
    if (params.entity) q.set('entity', params.entity)
    return this.http.get<GraphResult>('/v1/data/graph?' + q.toString())
  }

  predictions(params: PredictParams): Promise<PredictResult> {
    const q = new URLSearchParams({ model: params.model, symbol: params.symbol })
    if (params.start) q.set('start', String(params.start))
    if (params.end) q.set('end', String(params.end))
    if (params.limit) q.set('limit', String(params.limit))
    return this.http.get<PredictResult>('/v1/data/predictions?' + q.toString())
  }

  events(params: EventsParams = {}): Promise<EventsResult> {
    const q = new URLSearchParams()
    if (params.chain) q.set('chain', params.chain)
    if (params.address) q.set('address', params.address)
    if (params.contract) q.set('contract', params.contract)
    if (params.eventType) q.set('event_type', params.eventType)
    if (params.category) q.set('category', params.category)
    if (params.fromBlock) q.set('from_block', params.fromBlock)
    if (params.toBlock) q.set('to_block', params.toBlock)
    if (params.limit) q.set('limit', String(params.limit))
    return this.http.get<EventsResult>('/v1/data/events?' + q.toString())
  }

  rag(params: RagParams): Promise<RagResult> {
    return this.http.post<RagResult>('/v1/data/rag', params)
  }

  /**
   * SSE 实时流（ticker / factors）。返回原始 `Response`，由调用方消费 `res.body`。
   * 该请求不设超时，需自行处理断线与重连。
   */
  stream(params: { channels?: string | string[]; symbols?: string | string[] } = {}): Promise<Response> {
    const channels = Array.isArray(params.channels) ? params.channels.join(',') : (params.channels ?? 'ticker')
    const q = new URLSearchParams({ channels })
    if (params.symbols) {
      q.set('symbols', Array.isArray(params.symbols) ? params.symbols.join(',') : params.symbols)
    }
    return this.http.stream('/v1/data/stream?' + q.toString())
  }

  /** 用户级数据 Key 自助管理（钱包签名；网关另需 `sk_data_*`）。 */
  myKeys = {
    /** 列出当前钱包持有的 key（不含明文）。 */
    list: () => this.http.get<Record<string, unknown>>('/v1/data/my-keys'),
    /** 创建 key：`{label, scope?, rate_limit?}`；明文仅本次返回。 */
    create: (p: { label: string; scope?: string; rate_limit?: number }) =>
      this.http.post<Record<string, unknown>>('/v1/data/my-keys', p),
    /** 用一次性认领码换取 key 明文（仅一次可见）。 */
    claim: (claimCode: string) =>
      this.http.post<Record<string, unknown>>('/v1/data/my-keys/claim', { claim_code: claimCode }),
    /** 轮换 key，返回新的明文。 */
    rotate: (keyId: number | string) =>
      this.http.post<Record<string, unknown>>('/v1/data/my-keys/' + encodeURIComponent(String(keyId)) + '/rotate'),
    /** 删除 key。 */
    remove: (keyId: number | string) =>
      this.http.delete<Record<string, unknown>>('/v1/data/my-keys/' + encodeURIComponent(String(keyId))),
  }

  // ── 行情 / 符号 / 快照（旧 hub MCP 能力）──

  /** 取单符号最新行情（ticker）。 */
  ticker(symbol: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/data/ticker?symbol=' + encodeURIComponent(symbol))
  }

  /** 列出受支持交易符号（可按市场 / 关键词过滤）。 */
  symbols(params: { market?: string; limit?: number } = {}): Promise<Record<string, unknown>> {
    const q = new URLSearchParams()
    if (params.market) q.set('market', params.market)
    if (params.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return this.http.get<Record<string, unknown>>('/v1/data/symbols' + (qs ? '?' + qs : ''))
  }

  /** 模糊搜索符号（跨市场）。 */
  symbolSearch(p: { keyword: string; market?: string; limit?: number }): Promise<Record<string, unknown>> {
    const q = new URLSearchParams({ keyword: p.keyword })
    if (p.market) q.set('market', p.market)
    if (p.limit) q.set('limit', String(p.limit))
    return this.http.get<Record<string, unknown>>('/v1/data/symbols/search?' + q.toString())
  }

  /** 解析原始符号关键词为规范交易符号。 */
  symbolResolve(p: { symbol: string; market?: string }): Promise<Record<string, unknown>> {
    const q = new URLSearchParams({ symbol: p.symbol })
    if (p.market) q.set('market', p.market)
    return this.http.get<Record<string, unknown>>('/v1/data/symbol/resolve?' + q.toString())
  }

  /** 券商市场策略（各市场主交易场所）。 */
  brokerPolicy(): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/data/policy/broker-market')
  }

  /** 取因子历史序列（按符号 + 因子 id + 时间窗）。 */
  factorsHistory(p: { symbol: string; factor: string; start?: number; end?: number; limit?: number }): Promise<Record<string, unknown>> {
    const q = new URLSearchParams({ symbol: p.symbol, factor: p.factor })
    if (p.start) q.set('start', String(p.start))
    if (p.end) q.set('end', String(p.end))
    if (p.limit) q.set('limit', String(p.limit))
    return this.http.get<Record<string, unknown>>('/v1/data/factors/history?' + q.toString())
  }

  /** 取快照数据（macro / onchain / defi_tvl / indices…）。 */
  snapshots(p: { type?: string; date?: string; limit?: number } = {}): Promise<Record<string, unknown>> {
    const q = new URLSearchParams()
    if (p.type) q.set('type', p.type)
    if (p.date) q.set('date', p.date)
    if (p.limit) q.set('limit', String(p.limit))
    const qs = q.toString()
    return this.http.get<Record<string, unknown>>('/v1/data/snapshots' + (qs ? '?' + qs : ''))
  }

  // ── DC（数据中心）面：统计 / 链 / 代币 / 事件分类 / 订阅 ──

  /** DC 统计（事件总数 / 活跃链）。 */
  stats(): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/data/stats')
  }

  /** 各链区块索引检查点。 */
  checkpoints(chain?: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/data/checkpoints' + (chain ? '?chain=' + encodeURIComponent(chain) : ''))
  }

  /** DC 订阅套餐价目（公开）。 */
  plans(): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/data/plans')
  }

  /** 支持的代币列表（含元数据）。 */
  tokens(chain?: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/data/tokens' + (chain ? '?chain=' + encodeURIComponent(chain) : ''))
  }

  /** 支持的区块链网络列表。 */
  chains(): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/data/chains')
  }

  /** 事件业务分类目录（category_id + label_id）。 */
  eventCategories(): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/data/event-categories')
  }

  /** 按业务分类聚合的事件计数（可按链过滤）。 */
  eventStats(chain?: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/data/event-stats' + (chain ? '?chain=' + encodeURIComponent(chain) : ''))
  }

  /** 订阅 DC 套餐（x-wallet-address 鉴权；免费即时生效返 dcApiKey，付费返支付意图）。 */
  subscriptionSubscribe(p: { planId: string; rail?: string; walletAddress: string }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/data/subscribe', { planId: p.planId, rail: p.rail }, { 'x-wallet-address': p.walletAddress })
  }

  /** 轮询 DC 订阅支付状态（x-wallet-address 鉴权）。 */
  subscriptionPaymentCheck(walletAddress: string): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/data/payment-check', {}, { 'x-wallet-address': walletAddress })
  }

  /** 确认 DC 订阅的 x402 支付（提交 txHash；付款钱包须匹配）。 */
  subscriptionVerify(p: { txHash: string; walletAddress: string }): Promise<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>('/v1/data/verify', { txHash: p.txHash }, { 'x-wallet-address': p.walletAddress })
  }

  /** 读取 DC 订阅用量（套餐 / key / 月配额 / 当前用量 / 日明细）。 */
  subscriptionUsage(walletAddress: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/v1/data/usage', { 'x-wallet-address': walletAddress })
  }

  // ── Market 子域（DEX 行情 / 监控 / 订阅）：canonical `/v1/data/market*` ──
  market = {
    /** 按名称/符号搜索 DEX 代币（DexScreener）。 */
    search: (p: { keyword: string; chainIndex?: string; limit?: string }) => {
      const q = new URLSearchParams({ keyword: p.keyword })
      if (p.chainIndex) q.set('chainIndex', p.chainIndex)
      if (p.limit) q.set('limit', p.limit)
      return this.http.get('/v1/data/market/token-search?' + q.toString())
    },
    /** 热门 DEX 池（GeckoTerminal trending）。 */
    hot: (p: { chainIndex?: string; limit?: string } = {}) => {
      const q = new URLSearchParams()
      if (p.chainIndex) q.set('chainIndex', p.chainIndex)
      if (p.limit) q.set('limit', p.limit)
      return this.http.get('/v1/data/market/hot-tokens?' + q.toString())
    },
    /** K 线（OHLCV）。 */
    candles: (p: { chainIndex: string; tokenAddress: string; period?: string; limit?: string }) => {
      const q = new URLSearchParams({ chainIndex: p.chainIndex, tokenAddress: p.tokenAddress })
      if (p.period) q.set('period', p.period)
      if (p.limit) q.set('limit', p.limit)
      return this.http.get('/v1/data/market/candles?' + q.toString())
    },
    /** 实时 DEX 价。 */
    price: (p: { chainIndex: string; tokenAddress: string }) =>
      this.http.get('/v1/data/market/price?' + new URLSearchParams({ chainIndex: p.chainIndex, tokenAddress: p.tokenAddress }).toString()),
    /** 加入监控列表（自动采集 K 线 / 快照）。 */
    trackToken: (p: { chain: string; tokenAddress: string; label?: string }) =>
      this.http.post('/v1/data/market/tracked-tokens', p),
    /** 列出监控中的代币。 */
    listTracked: (chain?: string) =>
      this.http.get('/v1/data/market/tracked-tokens' + (chain ? '?chain=' + encodeURIComponent(chain) : '')),
    /** 注册自定义事件签名（topicHash + eventType，可选 ABI）。 */
    registerEvent: (p: { chain: string; topicHash: string; eventType: string; eventName?: string; abi?: unknown }) =>
      this.http.post('/v1/data/market/custom-sigs', p),
    /** Market 订阅套餐价目（公开）。 */
    subscriptionPlans: () => this.http.get('/v1/data/market-subscription/plans'),
    /** 发起 Market 订阅支付（免费即时生效；付费返支付意图）。 */
    subscriptionCheckout: (p: { plan_id: string; rail?: string; subscriber?: string }) =>
      this.http.post('/v1/data/market-subscription/checkout', p),
    /** 轮询 Market 订阅支付状态。 */
    subscriptionPaymentCheck: (p: { subscriber?: string } = {}) =>
      this.http.post('/v1/data/market-subscription/payment-check', p),
    /** 确认 Market 订阅的 x402 支付（提交 txHash）。 */
    subscriptionVerify: (p: { txHash: string }) =>
      this.http.post('/v1/data/market-subscription/verify', p),
    /** 读取 Market 订阅用量。 */
    subscriptionUsage: () => this.http.get('/v1/data/market-subscription/usage'),
  }

  // ── Factor 工厂（因子挖掘）：canonical `/v1/data/factor-factory/*`（由 ml-service 承载）──
  factorFactory = {
    /** 创建因子挖掘任务（结构化 preferences/constraints/formulas；intent 走 LLM 解析）。返回 job_id。 */
    start: (p: { preferences?: Record<string, unknown>; constraints?: Record<string, unknown>; formulas?: string[]; intent?: string } = {}) => {
      const body: Record<string, unknown> = { preferences: p.preferences ?? {}, constraints: p.constraints ?? {} }
      if (p.formulas?.length) body.formulas = p.formulas
      return p.intent
        ? this.http.post('/v1/data/factor-factory/mine', { ...body, intent: p.intent })
        : this.http.post('/v1/data/factor-factory/start', body)
    },
    /** 查询挖掘任务状态（含 stage 细分：pool/eval/select/persist）。 */
    status: (jobId: string) =>
      this.http.get('/v1/data/factor-factory/status?job_id=' + encodeURIComponent(jobId)),
    /** 查询挖掘任务结果（合格因子列表 + 统计）。 */
    result: (jobId: string) =>
      this.http.get('/v1/data/factor-factory/result?job_id=' + encodeURIComponent(jobId)),
    /** 最近挖掘任务列表。 */
    list: (limit?: number) =>
      this.http.get('/v1/data/factor-factory/list' + (limit ? '?limit=' + limit : '')),
    /** 取消挖掘任务（排队/运行中可取消）。 */
    cancel: (jobId: string) =>
      this.http.post('/v1/data/factor-factory/cancel?job_id=' + encodeURIComponent(jobId)),
  }
}
