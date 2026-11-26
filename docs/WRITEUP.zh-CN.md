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
| Atlas 推送式预言机 | SingleFeed `decimals()` + `latestRoundData()`（兼容 AggregatorV3，18 位小数），喂价 `ATLAS_FEED_BNB_USD`、`ATLAS_FEED_USDT_USD` | 显示金额和押金估值的**首选美元价格来源**（`GET /api/price` 返回 `"source":"atlas"`），并按 Atlas 的方式做过期检查：从未更新过的喂价，或早于 `ATLAS_MAX_AGE_SECONDS`（默认 1 小时；USDT 喂价心跳为 24 小时，允许到 25 小时）的报价一律拒绝，由 CoinMarketCap 接替；BNB/USD 还为"用 BNB 支付"把关（超过心跳 60 秒的 2 倍即拒绝） | `web/lib/server/price`（`readFeed`）、`web/lib/server/price/atlas.ts` |
| Atlas Pull API | `POST https://api.atlasoracle.io/report/v1/price/latest` `{feedIds: [633, 649], signed: true}`，请求头 `X-API-KEY`（仅服务器端） | 每个喂价的共识状态：BNB/USD 不是 HEALTHY 或 DEGRADED 时拒绝"用 BNB 支付"；**签名报告**经服务器按官方签名者验证后，作为 AI 结算报告（有损坏扣款时）的价格证明 | `web/lib/server/price/atlas.ts`、`POST /api/settlement` |
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
| Atlas BNB/USD 喂价，BSC 测试网（心跳 60 秒） | [`0x3957d289ee9c38272377786787ea34f9dd29788d`](https://testnet.bscscan.com/address/0x3957d289ee9c38272377786787ea34f9dd29788d) |
| Atlas USDT/USD 喂价，BSC 测试网（心跳 24 小时） | [`0x9dfd7992952bb9e8fb4bc6065fdc3518addc4e8b`](https://testnet.bscscan.com/address/0x9dfd7992952bb9e8fb4bc6065fdc3518addc4e8b) |
| Atlas BNB/USD 喂价，BSC 主网（主网试点站点；心跳 60 秒） | [`0x9c0517f5b4c8657c7f18d68d2d79e2b3b1cd6438`](https://bscscan.com/address/0x9c0517f5b4c8657c7f18d68d2d79e2b3b1cd6438) |
| Atlas USDT/USD 喂价，BSC 主网（主网试点站点；心跳 24 小时） | [`0x9fc000fc9c17578b49853278a517e357201d01e4`](https://bscscan.com/address/0x9fc000fc9c17578b49853278a517e357201d01e4) |
| Atlas Pull API 喂价 ID · 官方签名者 | BNB/USD 633、USDT/USD 649 · `0x59eD4701224fD9e2a85Ef2946c2ab828C1dDC600` |
| `AtlasSwapGuard`（测试网"用 BNB 支付"演示兑换；读取 Atlas BNB/USD 喂价，最长 120 秒） | [`0xD26dBba1eE904c95d3467F479FC4410b0400b6bA`](https://testnet.bscscan.com/address/0xD26dBba1eE904c95d3467F479FC4410b0400b6bA) |

地址来自 [contracts/deployments/97.json](../contracts/deployments/97.json)。

**Atlas 在产品中的用法：** (1) "用 BNB 支付"：只兑换差额，`amountOutMin` = Atlas BNB/USD 价值的 99 %；喂价超过心跳 2 倍、
共识不是 HEALTHY/DEGRADED、签名报告验证失败，或池子报价与 Atlas 相差超过 2 % 时一律拒绝（"当前价格不可信"）。主网走
PancakeSwap V2，上限 1 USDT；测试网没有 MockUSDT 的池子，由标注清楚的 `AtlasSwapGuard` 合约按 Atlas 价格出售测试 mUSDT。
(2) 金额卡片上的徽章："Atlas 定价 · N 秒前更新 · 共识 0.94 HEALTHY"。(3) AI 结算有损坏扣款时，附上经服务器验证的 Atlas
签名价格报告及其哈希（"价格证明：Atlas 签名报告"），无需改动合约。

## 当前状态（如实告知评委）

**哪些是真实上线的，哪些是演示数据：**

- **已上线：** 合约和交易。托管、租金发放、AI 验车和结算都在 BSC 测试网上真实运行，每一步都可在 BscScan 查到。
- **Atlas：** 已上线。上面的 Atlas 推送式喂价是测试网站点和主网试点站点的首选美元价格来源（`GET /api/price` 返回 `"source":"atlas"`）。
- **CoinMarketCap：** 已上线，作为备用价格来源，并提供泰铢汇率和押金波动缓冲。
- **Atlas Pull API、"用 BNB 支付"和价格证明：** 已在 <https://keyscrow.app>（BSC 测试网）上线。签名报告在使用前经官方签名者验证（`GET /api/price` 返回 `atlas.ok: true`，11 月 26 日共识为 HEALTHY）；"用 BNB 支付"在 Atlas 把关下运行（测试网演示兑换合约 `AtlasSwapGuard` `0xD26dBba1eE904c95d3467F479FC4410b0400b6bA`）；有损坏扣款的 AI 结算附带签名价格证明。主网试点站点没有 Pull API 密钥，只显示推送式喂价，因此那里拒绝"用 BNB 支付"（失败即关闭）。
- **Cournot：** 实时调用默认关闭，尚未发起过概率调用；只有一次免费的 `resolve` 调用成功（2026-11-25）。

**已完成并测试：** CMC 波动率缓冲 + 泰铢换算（基于录制数据的测试）、带过期检查的 Atlas 读取路径（用 8 位和 18 位小数的模拟喂价做了单元测试）、调用日志、`/integrations` 和 `/sponsors` 证据页面。

## 下一步计划

1. 链上强制执行：托管合约在注资时读取 Atlas BNB/USD 喂价，把泰铢押金换算成 BNB，并拒绝过期价格；押金健康检查会标记
   抵押不足的租约并要求补足。
2. 用 CMC DEX 数据（`security_scan`、持币集中度）筛查任何新增的支付代币。
3. 用 CMC 恐惧与贪婪指数和 OHLCV 历史数据（付费层级）建立比滚动涨跌幅更好的波动率模型。
4. 用 Atlas 为 Fleet Vault 车队金库的收益做泰铢 / 美元估值。
