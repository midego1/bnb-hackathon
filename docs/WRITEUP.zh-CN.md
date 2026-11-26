[English](WRITEUP.md) | 简体中文

# KeyScrow：CoinMarketCap x Atlas 赛道说明（一页纸）

**团队：** KeyScrow · 联系方式：hackathon@vanpeltventures.org（团队成员姓名：_待项目负责人填写_）· 代码：本仓库（[中文 README](../README.zh-CN.md)）· 演示：`/integrations` 页面，以及车主 / 租客的租约页面。

## 问题与目标用户

在泰国租摩托车的游客要把护照押给车行，还车时还常被虚报损坏；车行车主遇到真实的损坏，却拿不出证据。KeyScrow
把租金和押金托管在 BNB Chain 上每笔租约独立的托管合约中，并根据 AI 照片验车结果结算押金。目标用户是小型租车行（车主）、
游客和外籍长住者（租客），之后还有车队投资者。所有人都以**泰铢**思考，而押金却以代币形式存放，因此在整个租期内，
押金必须始终足以覆盖一笔以泰铢计价的维修费用。这是一个风险问题，需要市场数据来解决。

## 使用了哪些数据，为什么

| 数据源 | 接口 / 喂价 | 用途 | 代码位置 |
|---|---|---|---|
| CoinMarketCap Pro API | `GET /v2/cryptocurrency/quotes/latest?symbol=USDT,BNB&convert=USD` | 用 `percent_change_24h/7d/30d` 计算每种支付代币的日波动率 → **押金风险缓冲**（稳定币 0 %；BNB 30 天约 15–25 %；超过 60 % 拒绝该代币） | `web/lib/risk.ts`、`web/lib/server/risk`、`GET /api/risk` |
| CoinMarketCap Pro API | 同上，`convert=THB` | USDT 和 BNB 的泰铢价格：所有金额优先以泰铢显示；把以泰铢计的押金换算成代币数量 | `GET /api/price`、`GET /api/risk` |
| Atlas 推送式预言机 | SingleFeed `latestRoundData()`（兼容 AggregatorV3），喂价 `ATLAS_FEED_BNB_USD`、`ATLAS_FEED_USDT_USD`，可选 `ATLAS_FEED_USD_THB` | 显示金额和押金估值的首选价格来源，并按 Atlas 的方式做过期检查（`updatedAt` 早于 `ATLAS_MAX_AGE_SECONDS`，默认 1 小时，或从未更新过的喂价，一律拒绝） | `web/lib/server/price`（`readFeed`） |
| Cournot（加分项） | `POST /intelligence/v1/probability` | “BNB 会在还车日前跌破覆盖底价吗？” → 缓冲 × (1 + p) | `GET /api/risk`、`POST /api/cournot` |

**核心思路：** CoinMarketCap（以及 Cournot）决定一笔租约承担多大风险；Atlas 提供为押金估值的链上价格。
所有调用都在服务端进行（密钥永远不会到达浏览器），每次调用都会记录接口、时间、HTTP 状态码和 CMC 的 `credit_count`
（从不记录密钥），写入 `web/.sponsor-logs/*.jsonl`，并在 `/integrations` 页面展示。

价格来源的回退顺序：Atlas 喂价 → CoinMarketCap → 最近一次有效报价；页面上的标签始终注明当前来源（*Atlas feed*、
*Live CoinMarketCap* 或 *Demo rates*）。合约本身从不读取价格。

## BNB Chain 合约与数据（BSC 测试网，chain 97）

`EscrowFactory`、`RentalEscrow` 实现合约（每笔租约一个 EIP-1167 克隆）、`MockUSDT`（测试用稳定币）和 `FleetVault`
（BKK-FLEET-1 份额）均已在 BscScan 验证，地址见 [README 的合约表](../README.md#bsc-testnet-contracts-chain-97)。

| 其他 | 地址 |
|---|---|
| ERC-8004 Identity Registry（验车代理 #2921） | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.bscscan.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| Atlas 喂价 | _暂无：Atlas 未公布 BSC 测试网喂价地址，将在比赛现场补充_ |

地址来自 [contracts/deployments/97.json](../contracts/deployments/97.json)。

## 当前状态（如实告知评委）

**哪些是真实上线的，哪些是演示数据：**

- **已上线：** 合约和交易。托管、租金发放、AI 验车和结算都在 BSC 测试网上真实运行，每一步都可在 BscScan 查到。
- **演示汇率：** 在线站点目前还没有配置 `CMC_API_KEY`，因此所有泰铢 / 美元金额都基于标注为 *Demo rates* 的演示汇率，
  而不是 CoinMarketCap 实时报价；风险面板会显示 *CoinMarketCap is not configured*，且不显示缓冲值。
- **Atlas：** 读取逻辑已完成，但被阻塞，因为 Atlas 尚未公布 BSC 测试网喂价地址，所以目前没有使用任何 Atlas 价格。
- **Cournot：** 实时调用默认关闭，尚未发起过概率调用；只有一次免费的 `resolve` 调用成功（2026-11-25）。

**已完成并测试：** CMC 波动率缓冲 + 泰铢换算（基于录制数据的测试；设置 `CMC_API_KEY` 后即可实时调用）、带过期检查的
Atlas 读取路径（用模拟喂价做了单元测试）、调用日志、`/integrations` 证据页面。

**待项目负责人处理：** CMC 密钥（用于实时调用）、Atlas BSC 测试网喂价地址（若由合约读取，还需加入白名单）。

## 下一步计划

1. 链上强制执行：托管合约在注资时读取 Atlas BNB/USD 喂价，把泰铢押金换算成 BNB，并拒绝过期价格；押金健康检查会标记
   抵押不足的租约并要求补足。
2. 用 CMC DEX 数据（`security_scan`、持币集中度）筛查任何新增的支付代币。
3. 用 CMC 恐惧与贪婪指数和 OHLCV 历史数据（付费层级）建立比滚动涨跌幅更好的波动率模型。
4. 用 Atlas 为 Fleet Vault 车队金库的收益做泰铢 / 美元估值。
