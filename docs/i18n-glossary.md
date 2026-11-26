# Chinese glossary (简体中文)

Fixed terms for every Chinese string in the app (`web/lib/i18n`, the `*.zh.ts` data modules). Use these exactly; if
a term reads wrong somewhere, change it here first and then everywhere.

Where the strings live: the app screens in `web/lib/i18n/dictionaries/{en,zh}/*.ts` (JSON, the client gets only the
active language), the older data copy in `*.zh.ts` next to its English. How the switch works: `web/lib/i18n/locales.ts` (modes `en`, `zh`, `both`; cookie `ke_lang`; `?bilingual=1` turns on
`both`, where only headlines get the Chinese line).

## Never translated

Product, contract, token and standard names stay as they are: KeyEscrow, BNB Chain, BSC, opBNB, BscScan, Sourcify,
EscrowFactory, RentalEscrow, FleetVault, MockUSDT, mUSDT, USDT, BNB, tBNB, BKK-FLEET-1, ERC-20, ERC-8004, MCP, A2A,
REST, SHA-256, CoinMarketCap, Atlas, Cournot, Living Brain, Greenfield, Honda / Yamaha model names, function names
(`createLease()`, `propose()` ...), addresses, hashes, and every amount (฿3,400, 200 mUSDT). "Fleet Vault" as a
product name stays English in running text only where the UI shows it as a name; elsewhere use 车队金库.

## Terms

| English | 中文 | Note |
| --- | --- | --- |
| escrow | 托管 | the arrangement |
| escrow contract | 托管合约 | |
| this rental's own escrow | 这笔租赁专属的托管合约 | |
| deposit | 押金 | |
| rent | 租金 | |
| monthly rent | 月租 | |
| rental | 租赁 / 租约 | 租赁 for the deal, 租约 for the on-chain agreement |
| rental period / term | 租期 | |
| renter | 租客 | contracts say tenant; we say renter |
| owner, shop owner | 车主 | contracts say landlord |
| fleet owner | 车队主 | |
| shop (rental shop) | 租车行 | |
| scooter | 摩托车 | Thai "motorbike" scooters |
| passport | 护照 | |
| dispute desk | 争议处理台 | KeyEscrow's default arbiter |
| arbiter / referee | 仲裁方 / 裁判 | 裁判 only in the ELI5 cartoon |
| dispute (noun / verb) | 争议 / 提出争议 | |
| ruling | 裁决 | |
| proposal / propose | 提议 / 提出 | |
| split (of the deposit) | 押金分配 | |
| accept | 接受 | |
| settle / settlement | 结算 | |
| reply window | 回复期限 | |
| deadline | 期限 | |
| timeout | 超时 | |
| shareholders | 股东 | |
| shares | 份额 | fleet share tokens |
| fleet vault | 车队金库 | |
| operator fee | 运营方费用 | |
| treasury (KeyEscrow treasury) | KeyEscrow 金库 | |
| fee, one-time fee | 手续费 / 一次性手续费 | |
| AI inspection | AI 验车 | |
| AI Inspector (the agent) | AI 验车员 | KeyEscrow Inspector stays a name |
| pickup / return (inspection) | 取车 / 还车 | |
| photos, guided photos | 照片 / 引导拍摄 | |
| fingerprint (hash) | 指纹（哈希） | |
| on-chain / off-chain | 链上 / 链下 | |
| testnet | 测试网 | |
| mainnet | 主网 | |
| wallet | 钱包 | |
| transaction | 交易 | |
| smart contract | 智能合约 | |
| stablecoin | 稳定币 | |
| faucet | 水龙头 | |
| gas | Gas 费 | |
| demo | 演示 | |
| step by step | 逐步 | |
| guided | 讲解 | the slow /demo speed |
| baht | 泰铢 | amounts keep ฿ |
| risk engine / buffer | 风险引擎 / 缓冲 | |
| agent (software) | 智能体 | |
| Ask AI (the assistant chat) | AI 助手 | |
| approve (a token allowance) | 授权 | "Approve USDT" → 授权 USDT |
| approve (a change in Ask AI) | 批准 | |
| Get test USDT | 领取测试 USDT | button and every sentence that quotes it |
| back office | 后台 | |
| on-ramp | 入金通道 | PromptPay page |
| judge | 评委 | /pitch |
| Mystery Box | 神秘盒子 | /pitch |
| subscription / subscribe | 订阅 | /app/subscriptions |
| subscriber | 订阅者 | |
| payment rhythm | 付款周期 | |
| MRR (monthly recurring revenue) | 月经常性收入；KPI 短标签用 MRR | |
| listing (an item to rent) | 租赁信息 | /app/listings |
| guest wallet (live judge demo) | 临时钱包 | /r |
| presenter | 演讲者 | /stage |
| big screen | 大屏幕 | /stage |
| test money | 测试资金 | /r: test BNB + mUSDT |
| pickup / return (the Mystery Box on /stage) | 取件 / 归还 | not a scooter, so not 取车 / 还车 |
| AI-translated; corrections welcome | 中文内容由 AI 翻译，欢迎指正。 | footer note in 中文 and EN+中文 |

## Style

- Natural Simplified Chinese, short sentences, not word-for-word. Full-width punctuation (，。：；「」 is not used,
  use “”), half-width digits, a space between Chinese and Latin words or numbers (例如 “押金 ฿6,800”).
- Headlines stay short: in EN+中文 mode they sit under the English and must not push a one-screen page into scrolling.
