# @keelcodes/mcp-market

Keel Market MCP server — 让 AI agent 直接查询 DEX 行情：实时价格、K 线（OHLCV）、热门池与代币搜索。

- 4 个只读工具，全部走 [Keel](https://keel.codes) 行情 API（DexScreener / GeckoTerminal 数据源）
- 使用**你自己的** `KEEL_API_KEY`；包内不含任何平台凭据
- 免费额度按模块、按 owner 计，每月自动重置（详见 [keel.codes/pricing](https://keel.codes/pricing)）

## 安装与运行

```bash
# 先到 https://keel.codes 领取免费 key（sk_market_*）
KEEL_API_KEY=sk_market_xxx npx -y @keelcodes/mcp-market
```

在 Claude Desktop / Cursor / Cline 等 MCP 客户端中配置：

```json
{
  "mcpServers": {
    "keel-market": {
      "command": "npx",
      "args": ["-y", "@keelcodes/mcp-market"],
      "env": {
        "KEEL_API_KEY": "sk_market_xxx"
      }
    }
  }
}
```

可选环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `KEEL_API_KEY` | — | **必填**，Keel API key（`sk_market_*`） |
| `KEEL_API_BASE` | `https://keel.codes` | 自建 / 测试网关地址 |

未配置 `KEEL_API_KEY` 时，进程会向 stderr 打印领取链接与配置示例并以非 0 退出，不会回退到任何平台凭据。

## 工具

| 工具 | 说明 | 主要参数 |
|---|---|---|
| `market_price` | DEX 代币实时价 | `chainIndex`、`tokenAddress` |
| `market_candles` | DEX 代币 K 线（OHLCV） | `chainIndex`、`tokenAddress`、`period`、`limit` |
| `market_hot_tokens` | 热门 DEX 池（GeckoTerminal trending） | `chainIndex`、`limit` |
| `market_token_search` | 按名称/符号搜索 DEX 代币（DexScreener） | `keyword`、`chainIndex`、`limit` |

`chainIndex` 为链 ID（如 `1` = Ethereum、`56` = BNB Chain、`8453` = Base）。

## 示例 prompt

1. `What is the current DEX price of token 0x6982508145454Ce325dDbE47a25d4ec3d2311933 on Ethereum (chainIndex 1)?`
2. `Show me the last 100 15m candles for token 0x6982508145454Ce325dDbE47a25d4ec3d2311933 on Ethereum and summarize the trend.`
3. `Find the hottest DEX pools on Base (chainIndex 8453) right now and compare the top 3 by volume.`

## 额度与错误

- 免费额度按模块、按 owner 计，不按机器；用尽后返回 `429`。
- 额度不足时，工具返回的错误文本会附带购买链接：
  `https://keel.codes/pricing?module=market&src=mcp-market`，购买后即时生效。
- 所有工具错误以 `isError: true` 返回，不会让 MCP 连接崩溃。

## Agent 钱包（自动付 402）

额度用尽或需要链上操作时，可给 agent 开一个本地钱包（私钥只写本机 `~/.keel`，不上传）：

```bash
npx @keelcodes/agent-wallet init      # L1 本地 EOA，免费
npx @keelcodes/agent-wallet upgrade   # L2 session key：$1/月，单次 $1 / 日 $20 / 7 天到期
```

- L1 直付**无链上限额**；L2 限额由链上 validator 强制，超限直接报错，**不会静默回退 EOA**
- Base 上 x402 标准轨只需 USDC（只签名，不需要 ETH gas）；BSC / ETH 走 Permit2，同样免原生 gas
- 额度或限额不足时，工具错误会提示「升级到 L2 可提高限额」

## 隐私

不收集对话内容，只记录调用计数与错误码；不落库请求参数。详见 [PRIVACY.md](./PRIVACY.md)。

## 支持

- 邮箱：support@keel.codes
- 文档与领取 key：https://keel.codes
