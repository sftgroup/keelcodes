# @keelcodes/mcp-chain-data

Keel Chain Data MCP server — 让 AI agent 查询链上事件、事件统计与代币 / 链元数据。

- 5 个只读工具，数据来自 [Keel](https://keel.codes) Data Center（已索引的链上事件与 DEX 代币目录）
- 使用**你自己的** `KEEL_API_KEY`；包内不含任何平台凭据
- 免费额度按模块、按 owner 计，每月自动重置（详见 [keel.codes/pricing](https://keel.codes/pricing)）

## 安装与运行

```bash
# 先到 https://keel.codes 领取免费 key（sk_dc_*）
KEEL_API_KEY=sk_dc_xxx npx -y @keelcodes/mcp-chain-data
```

在 Claude Desktop / Cursor / Cline 等 MCP 客户端中配置：

```json
{
  "mcpServers": {
    "keel-chain-data": {
      "command": "npx",
      "args": ["-y", "@keelcodes/mcp-chain-data"],
      "env": {
        "KEEL_API_KEY": "sk_dc_xxx"
      }
    }
  }
}
```

可选环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `KEEL_API_KEY` | — | **必填**，Keel API key（`sk_dc_*`） |
| `KEEL_API_BASE` | `https://keel.codes` | 自建 / 测试网关地址 |

未配置 `KEEL_API_KEY` 时，进程会向 stderr 打印领取链接与配置示例并以非 0 退出，不会回退到任何平台凭据。

## 工具

| 工具 | 说明 | 主要参数 |
|---|---|---|
| `events` | 取链上事件流 | `chain`、`address`、`contract`、`eventType`、`category`、`fromBlock`、`toBlock`、`limit` |
| `event_stats` | 按业务分类聚合的事件计数 | `chain` |
| `tokens` | 支持的代币列表（含元数据） | `chain` |
| `chains` | 支持的区块链网络列表 | — |
| `token_info` | 查询代币元数据（按符号 / 链过滤 DC 代币目录） | `symbol`、`chain`、`limit` |

`chain` 使用链名（如 `ethereum`、`bsc`、`base`）。

## 示例 prompt

1. `List the latest 20 Transfer events for contract 0xdAC17F958D2ee523a2206206994597C13D831ec7 on ethereum.`
2. `Summarize event counts by business category on bsc and tell me which category dominates.`
3. `Which chains does Keel Data support? Then look up metadata for the token symbol PEPE.`

## 额度与错误

- 免费额度按模块、按 owner 计，不按机器；用尽后返回 `429`。
- 额度不足时，工具返回的错误文本会附带购买链接：
  `https://keel.codes/pricing?module=dc&src=mcp-chain-data`，购买后即时生效。
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
