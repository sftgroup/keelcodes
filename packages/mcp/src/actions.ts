import { clientFor, publicClient } from './client.js'
import { requireWalletHeaders } from './request-context.js'

/** 分发到 Keel SDK 对应动作（SDK 为嵌套命名空间，此处按 tool action 展平分发）。 */
export async function callAction(module: string, action: string, args: Record<string, unknown>): Promise<unknown> {
  // B19.4 代播费自助面：payments 侧是公开端点（public-paths），鉴权靠请求体的
  // payTo 签名；不走 clientFor，避免入站 key 模块不匹配时被本地校验拦掉。
  switch (`${module}.${action}`) {
    case 'payment.settle_fee_balance':
      return publicClient.payment.settleFeesBalance({
        payTo: String(args.payTo),
        signature: String(args.signature),
      })
    case 'payment.settle_fee_topup':
      return publicClient.payment.settleFeesTopup({
        payTo: String(args.payTo),
        chain: String(args.chain),
        txHash: String(args.txHash),
        signature: String(args.signature),
      })
  }

  // A7.4：有用户 key 时按该 key 建客户端（逐用户计量），否则回落到运维 env 客户端。
  const keel = clientFor(module)
  const k = keel as unknown as Record<string, any>
  switch (`${module}.${action}`) {
    // ── payment：扁平方法但签名含「非对象参数」，需显式取值 ──
    case 'payment.verify':
      return keel.payment.verifyPayment(String(args.paymentSignature))
    case 'payment.balance':
      return keel.payment.balance(String(args.address), args.asset as string | undefined)
    case 'payment.settlement':
      return keel.payment.settlement(String(args.reference))
    case 'payment.access':
      return keel.payment.access(String(args.subscriber), args.resource)
    // ── wallet 嵌套子域：safe.* / session.* ──
    case 'wallet.safe_dashboard':
      return keel.wallet.safe.dashboard()
    case 'wallet.safe_list':
      return keel.wallet.safe.list(args.userId as string | undefined)
    case 'wallet.safe_info':
      return keel.wallet.safe.info(String(args.address))
    case 'wallet.safe_create':
      return keel.wallet.safe.create(args as any)
    case 'wallet.safe_propose':
      return keel.wallet.safe.propose(args as any)
    case 'wallet.safe_confirm':
      return keel.wallet.safe.confirm(args as any)
    case 'wallet.safe_execute':
      return keel.wallet.safe.execute(args as any)
    case 'wallet.safe_update_owners':
      return keel.wallet.safe.updateOwners(String(args.address), args as any)
    case 'wallet.safe_retry':
      return keel.wallet.safe.retry(args.chainId as string | undefined)
    case 'wallet.safe_execute_ready':
      return keel.wallet.safe.executeReady(args.safeAddress as string | undefined)
    case 'wallet.safe_sync':
      return keel.wallet.safe.sync(String(args.safeAddress))
    case 'wallet.safe_status':
      return keel.wallet.safe.status(args.walletAddress as string | undefined)
    case 'wallet.safe_risk_check':
      return keel.wallet.safe.riskCheck(args as any)
    case 'wallet.session_create':
      return keel.wallet.session.create(args as any)
    case 'wallet.session_revoke':
      return keel.wallet.session.revoke(String(args.sessionId))
    case 'wallet.session_execute':
      return keel.wallet.session.execute(args as any)
    case 'wallet.aa_paymaster_info':
      return keel.wallet.session.paymaster.info()
    // ── wallet.session.solana 子域：Squads Smart Account（构建未签名 / 广播已签名）──
    case 'wallet.solana_derive_account':
      return keel.wallet.session.solana.deriveAccount(args as any)
    case 'wallet.solana_create_account':
      return keel.wallet.session.solana.createAccount(args as any)
    case 'wallet.solana_install_policy':
      return keel.wallet.session.solana.installPolicy(args as any)
    case 'wallet.solana_execute_policy':
      return keel.wallet.session.solana.executePolicy(args as any)
    case 'wallet.solana_create_policy_transaction':
      return keel.wallet.session.solana.createPolicyTransaction(args as any)
    case 'wallet.solana_execute_policy_payload':
      return keel.wallet.session.solana.executePolicyPayload(args as any)
    case 'wallet.solana_close_settings':
      return keel.wallet.session.solana.closeSettings(args as any)
    case 'wallet.solana_close_transaction':
      return keel.wallet.session.solana.closeTransaction(args as any)
    case 'wallet.solana_create_proposal':
      return keel.wallet.session.solana.createProposal(args as any)
    case 'wallet.solana_approve_proposal':
      return keel.wallet.session.solana.approveProposal(args as any)
    case 'wallet.solana_execute_policy_transaction':
      return keel.wallet.session.solana.executePolicyTransaction(args as any)
    case 'wallet.solana_remove_policy':
      return keel.wallet.session.solana.removePolicy(args as any)
    case 'wallet.solana_execute':
      return keel.wallet.session.solana.execute(args as any)
    case 'wallet.solana_remove_signer':
      return keel.wallet.session.solana.removeSigner(args as any)
    case 'wallet.solana_submit':
      return keel.wallet.session.solana.submit(args as any)
    case 'wallet.solana_dex_quote':
      return keel.wallet.session.solana.dexQuote(args as any)
    case 'wallet.solana_dex_install_policy':
      return keel.wallet.session.solana.dexInstallPolicy(args as any)
    case 'wallet.solana_dex_swap':
      return keel.wallet.session.solana.dexSwap(args as any)
    // ── wallet.mpc 子域：email 分片钱包（onboarding / 会话 / 链上 / 合约）──
    case 'wallet.mpc_send_code':
      return keel.wallet.mpc.sendCode(args as any)
    case 'wallet.mpc_register':
      return keel.wallet.mpc.register(args as any)
    case 'wallet.mpc_recover':
      return keel.wallet.mpc.recover(args as any)
    case 'wallet.mpc_status':
      return keel.wallet.mpc.status(String(args.email))
    case 'wallet.mpc_wallets':
      return keel.wallet.mpc.wallets(args.email as string | undefined)
    case 'wallet.mpc_session_unlock':
      return keel.wallet.mpc.sessionUnlock(args as any)
    case 'wallet.mpc_session_lock':
      return keel.wallet.mpc.sessionLock(args as any)
    case 'wallet.mpc_session_status':
      return keel.wallet.mpc.sessionStatus(String(args.token))
    case 'wallet.mpc_balance':
      return keel.wallet.mpc.balance(args as any)
    case 'wallet.mpc_sign_message':
      return keel.wallet.mpc.signMessage(args as any)
    case 'wallet.mpc_sign_typed_data':
      return keel.wallet.mpc.signTypedData(args as any)
    case 'wallet.mpc_send_transaction':
      return keel.wallet.mpc.sendTransaction(args as any)
    case 'wallet.mpc_contract_read':
      return keel.wallet.mpc.contractRead(args as any)
    case 'wallet.mpc_contract_write':
      return keel.wallet.mpc.contractWrite(args as any)
    case 'wallet.mpc_gas_estimate':
      return keel.wallet.mpc.gasEstimate(args as any)
    // ── wallet.chainRpc 子域：池状态 / 读套餐订阅面 ──
    case 'wallet.chain_status':
      return keel.wallet.chainRpc.status()
    case 'wallet.chain_health':
      return keel.wallet.chainRpc.health()
    case 'wallet.chain_subscription_plans':
      return keel.wallet.chainRpc.subscription.plans()
    case 'wallet.chain_subscription_checkout':
      return keel.wallet.chainRpc.subscription.checkout(args as any)
    case 'wallet.chain_subscription_payment_check':
      return keel.wallet.chainRpc.subscription.paymentCheck(args as any)
    case 'wallet.chain_subscription_verify':
      return keel.wallet.chainRpc.subscription.verify(args as any)
    case 'wallet.chain_subscription_usage':
      return keel.wallet.chainRpc.subscription.usage(String(args.rpcKey))
    // ── wallet 旧 index 面：gas 预估 / sweep / 交易状态 ──
    case 'wallet.estimate_gas':
      return keel.wallet.estimateGas(args as any)
    case 'wallet.sweep':
      return keel.wallet.sweep(args as any)
    case 'wallet.tx_status':
      return keel.wallet.txStatus(String(args.txHash))
    // ── payment 计费面（由 mpc 承载的 canonical 端点）──
    case 'payment.plans':
      return keel.payment.plans()
    case 'payment.ledger_balance':
      return keel.payment.ledgerBalance(args as any)
    // ── payment 旧 index 面：通道发现 / 订阅详情 / 定价 / a2a / 批量 / 邀请 / 转账 ──
    case 'payment.info':
      return keel.payment.info(args.chain as string | undefined)
    case 'payment.subscription_detail':
      return keel.payment.subscriptionDetail(String(args.chain), String(args.subscriber), Number(args.resourceId))
    case 'payment.price':
      return keel.payment.price(Number(args.planId), args.chain as string | undefined)
    case 'payment.a2a_create':
      return keel.payment.a2aCreate(args as any)
    case 'payment.a2a_settle':
      return keel.payment.a2aSettle(args as any)
    case 'payment.a2a_direct_settle':
      return keel.payment.a2aDirectSettle(String(args.paymentId), String(args.txHash))
    case 'payment.a2a_cancel':
      return keel.payment.a2aCancel(String(args.paymentId))
    case 'payment.batch_create':
      return keel.payment.batchCreate(args as any)
    case 'payment.batch_settle':
      return keel.payment.batchSettle(args as any)
    case 'payment.batch_get':
      return keel.payment.batchGet(String(args.batchId))
    case 'payment.batch_cancel':
      return keel.payment.batchCancel(String(args.batchId))
    case 'payment.invite_create':
      return keel.payment.inviteCreate(args as any)
    case 'payment.invite_list':
      return keel.payment.inviteList(args as any)
    case 'payment.invite_get':
      return keel.payment.inviteGet(String(args.inviteId))
    case 'payment.invite_cancel':
      return keel.payment.inviteCancel(String(args.inviteId))
    case 'payment.invite_settle':
      return keel.payment.inviteSettle(args as any)
    case 'payment.invite_pay':
      return keel.payment.invitePay(String(args.inviteId))
    case 'payment.transfer_create':
      return keel.payment.transferCreate(args as any)
    case 'payment.transfer_list':
      return keel.payment.transferList(args as any)
    case 'payment.transfer_get':
      return keel.payment.transferGet(String(args.transferId))
    case 'payment.transfer_confirm':
      return keel.payment.transferConfirm(String(args.transferId))
    case 'payment.transfer_cancel':
      return keel.payment.transferCancel(String(args.transferId))
    // ── data 嵌套子域：DC（数据中心）面 ──
    case 'data.stats':
      return keel.data.stats()
    case 'data.checkpoints':
      return keel.data.checkpoints(args.chain as string | undefined)
    case 'data.plans':
      return keel.data.plans()
    case 'data.tokens':
      return keel.data.tokens(args.chain as string | undefined)
    case 'data.chains':
      return keel.data.chains()
    case 'data.event_categories':
      return keel.data.eventCategories()
    case 'data.event_stats':
      return keel.data.eventStats(args.chain as string | undefined)
    case 'data.subscription_subscribe':
      return keel.data.subscriptionSubscribe(args as any)
    case 'data.subscription_payment_check':
      return keel.data.subscriptionPaymentCheck(String(args.walletAddress))
    case 'data.subscription_verify':
      return keel.data.subscriptionVerify(args as any)
    case 'data.subscription_usage':
      return keel.data.subscriptionUsage(String(args.walletAddress))
    case 'data.price':
      return binancePrice(String(args.symbol))
    // ── data.market 子域：DEX 行情 / 监控 / 订阅 ──
    case 'data.market_search':
      return keel.data.market.search(args as any)
    case 'data.market_hot':
      return keel.data.market.hot(args as any)
    case 'data.market_candles':
      return keel.data.market.candles(args as any)
    case 'data.market_price':
      return keel.data.market.price(args as any)
    case 'data.market_track_token':
      return keel.data.market.trackToken(args as any)
    case 'data.market_list_tracked':
      return keel.data.market.listTracked(args.chain as string | undefined)
    case 'data.market_register_event':
      return keel.data.market.registerEvent(args as any)
    case 'data.market_subscription_plans':
      return keel.data.market.subscriptionPlans()
    case 'data.market_subscription_checkout':
      return keel.data.market.subscriptionCheckout(args as any)
    case 'data.market_subscription_payment_check':
      return keel.data.market.subscriptionPaymentCheck(args as any)
    case 'data.market_subscription_verify':
      return keel.data.market.subscriptionVerify(args as any)
    case 'data.market_subscription_usage':
      return keel.data.market.subscriptionUsage()
    // ── data.factorFactory 子域：因子挖掘 ──
    case 'data.factor_start':
      return keel.data.factorFactory.start(args as any)
    case 'data.factor_status':
      return keel.data.factorFactory.status(String(args.jobId))
    case 'data.factor_result':
      return keel.data.factorFactory.result(String(args.jobId))
    case 'data.factor_list':
      return keel.data.factorFactory.list(args.limit as number | undefined)
    case 'data.factor_cancel':
      return keel.data.factorFactory.cancel(String(args.jobId))
    // ── data 旧 hub 面：行情 / 符号 / 快照 / 因子历史 / 券商策略 ──
    case 'data.ticker':
      return keel.data.ticker(String(args.symbol))
    case 'data.symbols':
      return keel.data.symbols(args as any)
    case 'data.symbol_search':
      return keel.data.symbolSearch(args as any)
    case 'data.symbol_resolve':
      return keel.data.symbolResolve(args as any)
    case 'data.broker_policy':
      return keel.data.brokerPolicy()
    case 'data.factors_history':
      return keel.data.factorsHistory(args as any)
    case 'data.snapshots':
      return keel.data.snapshots(args as any)
    // ── account：waas 自助面要求钱包签名，透传客户端签名头（MCP 不持有私钥）──
    case 'account.tenant_create':
      return keel.request('POST', '/v1/account/tenant', args, requireWalletHeaders())
    case 'account.tenant_get':
      return keel.request(
        'GET',
        '/v1/account/tenant/' + encodeURIComponent(String(args.tenantId)),
        undefined,
        requireWalletHeaders(),
      )
    case 'account.apikey_create':
      return keel.request('POST', '/v1/account/apikey', args, requireWalletHeaders())
    case 'account.apikey_revoke':
      return keel.request('POST', '/v1/account/apikey/revoke', { id: String(args.id) }, requireWalletHeaders())
    case 'account.subscription_get':
      return keel.request(
        'GET',
        '/v1/account/subscription?module=' + encodeURIComponent(String(args.module)),
        undefined,
        requireWalletHeaders(),
      )
    case 'account.subscription_subscribe':
      return keel.request('POST', '/v1/account/subscription', args, requireWalletHeaders())
    case 'account.subscription_cancel':
      return keel.request(
        'POST',
        '/v1/account/subscription/cancel',
        { module: args.module },
        requireWalletHeaders(),
      )
    // ── 其余扁平方法（payment.charge/pay/orders、wallet.create/import/sign/send/chain/balance、data.*）──
    default:
      return k[module][action](args)
  }
}

/** DC price：Binance 公共 API 实时价（外部行情源，非 Keel 端点）。 */
export async function binancePrice(symbol: string): Promise<unknown> {
  const sym = symbol.toUpperCase()
  const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`)
  if (!r.ok) throw new Error(`Binance returned ${r.status} for ${sym}`)
  const data = (await r.json()) as { price: string }
  return { symbol: sym, price_usd: data.price, source: 'Binance' }
}
