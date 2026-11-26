import type { DeepPartial } from "@/lib/i18n/locales";
import type { SponsorsCopy } from "./copy";

/** Simplified Chinese for components/sponsors/copy.ts. Terms: docs/i18n-glossary.md. */
export const zh: DeepPartial<SponsorsCopy> = {
  metaTitle: "赞助赛道 · KeyScrow",
  title: "赞助赛道",
  lead: "KeyScrow 在 BNB Bangkok 2026 参加的赛道、每个赛道用到了什么，以及它在本服务器上的当前状态。状态标签读取的数据与 /api/integrations 相同。",
  see: "查看",
  proof: "证明",
  media: "媒体资料：可下载全部视频、幻灯片、截图和文档",
  state: { live: "已上线", built: "已完成", waiting: "等待密钥" },
  tracks: {
    bnb: {
      name: "Developer Track（BNB Chain）",
      body: "每笔租赁在 BSC 测试网上都有自己的托管合约（另有限额的主网试点，每笔租赁最多 1 美元）；AI 验车员是 ERC-8004 智能体 #2921，每个操作都提供 REST、MCP 和 A2A，并有评委演示和 iOS 应用。",
    },
    cmcAtlas: {
      name: "CoinMarketCap x Atlas",
      body: "BSC 上的 Atlas 推送式喂价（BNB/USD、USDT/USD）是首选价格来源，并做过期检查；CoinMarketCap 作为备用来源，用泰铢为每个金额定价，其波动率决定押金缓冲。下一步：用我们的密钥接入 Atlas Pull API 签名报告。",
      cmc: "CoinMarketCap Pro API：备用价格、USD/THB 与押金波动缓冲",
      atlas: "BSC 测试网和主网上的 Atlas 推送式喂价：首选价格来源",
    },
    livingBrain: {
      name: "ChatAndBuild / Living Brain",
      body: "AI 验车员记住每辆摩托车的损伤历史和每个钱包的争议历史，旧划痕绝不会被重复收费，争议处理台也知道对方是谁；演示世界中的租车行和租客都带有历史记录。",
    },
    cournot: {
      name: "Cournot",
      body: "已完成：预测市场给出 BNB 在还车日前跌破某个阈值的概率，用来提高押金缓冲，并显示具体的命题和证据；在发起实时调用前，它在等待合作方密钥。",
    },
    aws: {
      name: "AWS 创业路演",
      body: "从第一天起就有收入（一个月租金的 10%，每笔租赁只收一次，从不从押金中扣），路线图从与泰国租车行的测试网试点走向主网、资产池、opBNB 和原生应用。",
    },
  },
  links: {
    duo: "分屏：租客手机 + 租车公司",
    stage: "大屏评委演示",
    phone: "在你的手机上体验评委演示",
    demo: "一键实时演示",
    app: "应用",
    developers: "REST、MCP 与 OpenAPI",
    agentCard: "智能体卡片（ERC-8004 #2921）",
    factory: "BscScan 上的托管工厂合约（测试网）",
    registration: "ERC-8004 注册交易",
    mainnet: "主网试点网站",
    mainnetFactory: "BscScan 上的主网工厂合约",
    ios: "iOS 应用源码",
    integrations: "集成与调用日志",
    integrationsApi: "/api/integrations（原始状态）",
    price: "/api/price（当前汇率来源）",
    writeup: "CoinMarketCap x Atlas 说明",
    atlasBnbTestnet: "Atlas BNB/USD 喂价（测试网）",
    atlasUsdtTestnet: "Atlas USDT/USD 喂价（测试网）",
    atlasBnbMainnet: "Atlas BNB/USD 喂价（主网）",
    atlasUsdtMainnet: "Atlas USDT/USD 喂价（主网）",
    sponsorsDoc: "赞助方要求",
    arbiter: "带历史卡片的争议处理台",
    backoffice: "后台：演示租车行",
    memoryDoc: "争议记忆如何运作",
    cournotDoc: "Cournot 集成（README）",
    pitch: "3 分钟路演",
    business: "商业模式",
    roadmap: "路线图",
  },
  notEntered: {
    title: "未参加",
    body: "Four.meme / OpenFour：没有测试网，KeyScrow 也没有自己的代币。Flap：未参加。",
  },
};
