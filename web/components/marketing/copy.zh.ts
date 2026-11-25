import type { DeepPartial } from "@/lib/i18n/locales";
import { ARBITER_DAYS, baht, EXAMPLE, FEE_PERCENT, FLEET_OPERATOR_FEE_PERCENT, INSPECTOR_AGENT, OWNER_RESPONSE_DAYS } from "@/lib/marketing";
import type { LandingCopy } from "./copy";

/** Simplified Chinese for the marketing page (components/marketing/copy.ts). Terms: docs/i18n-glossary.md. */
export const zh: DeepPartial<LandingCopy> = {
  meta: {
    title: "KeyEscrow：在泰国租摩托车，不用押护照",
    description:
      "摩托车租赁的押金存放在 BNB Chain 上的智能合约里，而不是把护照押在柜台。还车时由 AI 验车给出分配建议，双方同意或由争议处理台裁决，期限规则保护租客。已在 BSC 测试网上线。",
    cardAlt: "KeyEscrow：租走摩托车，护照留在身上。泰国夜晚街头一家摩托车租车行的 LED 画面。",
  },
  header: {
    nav: [
      ["#how", "运作方式"],
      ["#inspection", "AI 验车"],
      ["#fleet", "车队金库"],
      ["#agents", "面向智能体"],
      ["#fee", "手续费"],
    ],
    home: "KeyEscrow 首页",
    openApp: "打开应用",
  },
  hero: {
    label: "一屏看懂 KeyEscrow",
    artAlt: "泰国夜晚街道的 LED 点阵画：一辆红色摩托车停在灯火通明的租车行门前，旁边有棕榈树、电线和寺庙尖顶。",
    h1: ["摩托车租走，", "护照留下。"],
    body: "在泰国租摩托车，押金通常是你的护照或一叠现金，交给一个陌生人。KeyEscrow 改为把押金放进 BNB Chain 上的智能合约，任何一方都无法单独动用。",
    playDemo: "播放实时演示",
    openApp: "打开应用",
    how: "运作方式",
    testnet: "运行在 BSC 测试网上，使用测试资金",
    testnetMore: "。开源，不发币",
    facts: [
      ["押金", `${baht(EXAMPLE.deposit)}，由这笔租赁专属的合约保管`],
      ["你的护照", "留在你自己口袋里"],
      ["谁能动用这笔钱", "车主和租客一起同意，或由争议处理台裁决"],
    ],
    example: `示例：一辆 ${EXAMPLE.scooter}，月租 ${baht(EXAMPLE.rent)}，押金为两个月租金，按 1 USDT = 34 THB 的示意汇率计算。应用中显示实时汇率。`,
  },
  counter: {
    title: "同样的柜台，没人扣你的护照。",
    lead: "租客担心被讹损坏赔偿，车主面对真实的损坏却拿不出证据。双方都找不到中立的第三方，也没人会为几千泰铢去打官司。",
    today: "现在",
    ours: "用 KeyEscrow",
    rows: [
      ["押金", "你的护照或现金，放在车行的抽屉里", "存在为这一笔租赁专门创建的合约里的代币"],
      ["车况证明", "聊天里的几张照片，或者什么都没有", "引导拍摄的取车和还车照片，指纹存证上链"],
      ["还车时", "谁拿着护照谁说了算", "AI 验车给出分配建议；双方接受，或由争议处理台裁决"],
      ["如果对方不回应", "干等，或者押金不要了直接飞回家", `对方沉默 ${OWNER_RESPONSE_DAYS} 天后，押金全额退还租客`],
    ],
  },
  how: {
    title: "四步看懂运作方式。",
    cartoon: "看一分钟动画版",
    steps: [
      {
        title: "车行发布摩托车",
        body: "租金、押金和租期都以泰铢计价。租赁协议和引导拍摄的取车照片留在链下，只有它们的 SHA-256 指纹上链。",
        money: [
          ["托管中", baht(0)],
          ["护照", "在租客身上"],
        ],
      },
      {
        title: "租客向托管付款",
        body: "押金和第一个月的租金存入这笔租赁专属的合约，而不是把护照押在柜台。",
        money: [
          ["托管中", baht(EXAMPLE.funded)],
          ["其中押金", baht(EXAMPLE.deposit)],
        ],
      },
      {
        title: "骑车出发，租金按月发放",
        body: "租金按固定的 30 天周期发放给车主。KeyEscrow 的手续费只从第一笔租金中扣除，绝不动押金。",
        money: [
          ["车主第 1 个月", baht(EXAMPLE.firstPayout)],
          ["仍在托管中", baht(EXAMPLE.deposit)],
        ],
      },
      {
        title: "还车，几分钟内结算",
        body: "AI 验车对比取车和还车照片，给出押金分配建议。一方提出，另一方接受，资金立刻到账。",
        money: [
          ["退还租客", baht(EXAMPLE.deposit)],
          ["托管中", baht(0)],
        ],
      },
    ],
    note: `金额一栏以示例租赁为准：一辆 ${EXAMPLE.scooter}，月租 ${baht(EXAMPLE.rent)}，押金 ${baht(EXAMPLE.deposit)}，一次性手续费 ${baht(EXAMPLE.fee)}，按 1 USDT = 34 THB 的示意汇率计算，还车时没有新损伤。测试网上使用的代币是测试稳定币 mUSDT。`,
  },
  inspection: {
    title: "AI 提建议，人来做决定。",
    lead: "还车时，视觉模型对比取车照片和还车照片，给出押金的分配建议并附上理由。它动不了一分钱。",
    points: [
      ["有上限。", "退款和索赔加起来始终等于押金，绝不会更多。"],
      ["双方签名。", "一方在链上提交提议，另一方接受。任何一方也可以改为提出争议。"],
      ["有签名。", `报告由 KeyEscrow 验车员签名，它是 BSC 测试网上的 ERC-8004 智能体 #${INSPECTOR_AGENT.id}，任何人都能核实报告出自谁手。`],
      ["有记忆。", "验车员会先查这辆车以前的验车记录，旧划痕不会被重复收费。"],
    ],
    photos: [
      ["pickup-left", "取车", "取车时从左侧看到的示意摩托车，没有损伤。"],
      ["return-left", "还车", "同一辆摩托车还车时的样子，左侧面板上的新划痕被圈了出来。"],
    ],
    codeLabel: "验车提议示例",
    code: `{
  // 退还租客的 mUSDT
  "tenantRefund": "170.00",
  // 给车主的 mUSDT
  "landlordClaim": "30.00",
  "reasons": [
    "New scratches on the left side panel",
    "Left mirror cracked; intact at pickup"
  ]
}`,
    caption: "演示用的示意照片和一份针对 200 mUSDT 押金的提议示例。合约里用 tenant 和 landlord，本页称为租客和车主。",
  },
  deadlines: {
    title: "每个争议都有期限。",
    lead: "KeyEscrow 争议处理台是默认的仲裁方；车主也可以指定另一位中立仲裁方，租客付款前就能看到是谁。无论是谁，时钟都在保护租客。",
    day: (n) => `第 ${n} 天`,
    lanes: [
      { title: "双方同意", end: "立即结算", body: "一方提出分配方案，另一方接受。押金在同一笔交易中转出。" },
      {
        title: "车主不回应",
        end: `第 ${OWNER_RESPONSE_DAYS} 天：押金全额退还租客`,
        body: `如果车主 ${OWNER_RESPONSE_DAYS} 天不理会租客的提议，租客可以领回全部押金。`,
      },
      {
        title: "双方有分歧",
        end: `第 ${ARBITER_DAYS} 天前作出裁决，否则押金全额退还租客`,
        body: `争议处理台根据照片、双方的提议和 AI 报告作出裁决，期限为 ${ARBITER_DAYS} 天。`,
      },
    ],
    note: `${OWNER_RESPONSE_DAYS} 天和 ${ARBITER_DAYS} 天是默认值；每笔租赁在创建时确定自己的期限。`,
    desk: "打开争议处理台",
  },
  fleet: {
    title: "车队金库：一个车队，众多股东。",
    lead: "车行可以把一辆摩托车的收入指向金库，而不是自己的钱包。租金和赔偿款进入金库，由所有持有份额的人分享。这是测试网原型。",
    owners: "面向车行车主",
    ownersBody: `发布摩托车时把金库设为收款方。你保留租赁中的所有角色（提议、接受、争议），只有收款进入金库。运营方从收入中保留 ${FLEET_OPERATOR_FEE_PERCENT}% 用于维护。`,
    ownersLink: "打开车队主视图",
    holders: "面向股东",
    holdersBody: "存入 mUSDT，按一比一获得 BKK-FLEET-1 份额。随时领取你在车队收入中的份额，或赎回份额取回存款。",
    holdersLink: "打开股东视图",
    splitLabel: (rest) => `金库每一泰铢收入中，${FLEET_OPERATOR_FEE_PERCENT}% 归运营方，${rest}% 归股东。`,
    operator: `运营方 ${FLEET_OPERATOR_FEE_PERCENT}%`,
    toHolders: (rest) => `${rest}% 按比例分给股东`,
    caption: `金库收入的去向：${FLEET_OPERATOR_FEE_PERCENT}% 给运营方用于维护，其余给股东。收益分成代币可能属于证券；合规发行和份额转售是后续步骤，本原型两者都不做。`,
  },
  agents: {
    title: "为智能体而建，不只为浏览器。",
    lead: ["每个租赁操作只定义一次，以三种方式提供：REST 接口、MCP 工具和 A2A 技能。", " 操作返回已在链上模拟过的未签名交易，由你自己的钱包签名。KeyEscrow 从不持有密钥。"],
    inspector: [`验车员本身也是智能体：BSC 测试网身份注册表中的 ERC-8004 智能体 #${INSPECTOR_AGENT.id}（`, "注册交易", "）。其他智能体可以找到它、调用它，并核实它签过的内容。"],
    developers: "开发者参考",
    docs: "智能体文档",
    codeLabel: "把 Claude Code 连接到本地 KeyEscrow MCP 服务器",
    code: `# 启动智能体（在仓库的检出目录中）
pnpm agent:dev

# 然后在 Claude Code 中
claude mcp add --transport http keyescrow \\
  http://127.0.0.1:8790/mcp`,
    tools: (rental, inspector) => `${rental} 个租赁工具和 ${inspector} 个验车工具`,
  },
  live: {
    title: "已上线 BSC 测试网，欢迎亲自核查。",
    lead: "合约部署在 BSC 测试网（chain 97）上，源码已验证（在 Sourcify 上完全匹配），运行的就是仓库里的代码。合约小巧、不可升级。没有人持有能动用租赁资金的管理员密钥：钱只能流向创建时写明的双方，争议处理台也只能对处于争议中的租赁作出裁决。目前只有测试资金，尚未部署主网。",
    caption: "BSC 测试网上的 KeyEscrow 合约",
    cols: ["合约", "作用", "地址（BscScan 测试网）"],
    roles: {
      EscrowFactory: "为每笔租赁创建托管合约，并保存手续费设置",
      RentalEscrow: "每笔租赁的托管合约都是它的最小克隆",
      FleetVault: "BKK-FLEET-1 份额：车队收入按比例分享",
      MockUSDT: "代替 USDT 的测试稳定币（mUSDT，6 位小数）",
    },
    prices: "以泰铢计价，数据来源一目了然",
    pricesBody:
      "柜台前的每个人都用泰铢思考，所以每个金额都先显示 THB，再显示 USD 和精确的代币数量。汇率来自 Atlas 链上喂价或 CoinMarketCap Pro API，在服务器端读取，并始终用标签注明来源：Atlas 喂价、CoinMarketCap 实时或演示汇率。",
    risk: "押金始终足够支付维修费",
    riskBody: ["风险引擎把 CoinMarketCap 的波动率换算成押金缓冲：稳定币不加，BNB 多加一些，波动过大的代币直接拒绝。", "查看每项集成及其最近的调用", "，包括本服务器上哪些是实时运行的。"],
  },
  fee: {
    title: `一个月租金的 ${FEE_PERCENT}%，只收一次。`,
    body: "由车主从第一笔租金中支付，不管租多久。绝不从押金里扣：在租赁结算前，押金都是租客的钱。租客不用多付一分钱，也没有代币。",
    caption: `一辆按月租用的 ${EXAMPLE.scooter}，以泰铢计`,
    rows: ["月租", "押金（两个月租金），代替护照", "租客取车时付入：押金和第 1 个月租金", "KeyEscrow 手续费（一次性）", "车主第 1 个月收到", "车主之后每月收到"],
    note: "示意汇率 1 USDT = 34 THB。三个月的租期下，手续费约为租金的 3%。费率在工厂合约中设有上限，每笔租赁沿用创建时的费率。",
  },
  roadmap: {
    title: "下一步去哪里。",
    lead: "今天的 KeyEscrow 是一个能运行的测试网版本，还不是有客户的生意。下面是接下来的计划。",
    phases: [
      ["现在", "黑客松版本", "BSC 测试网上的托管、金库和验车智能体。车主、租客和争议处理台的流程。AI 验车提议。泰铢优先的价格显示。"],
      ["2027 年第一季度", "测试网试点", "在清迈和普吉与友好车行合作 10 到 20 笔真实的摩托车租赁，使用测试网资金。对合约进行独立的安全审计。"],
      ["2027 年第二至第三季度", "主网与 opBNB", "使用真实、广泛持有的稳定币。为加密新手提供钱包引导。依据泰国法律对托管和争议处理台角色进行法律审查。"],
      ["之后", "合作伙伴", "租车行、车队运营商和旅游平台。由租车行业协会担任指定仲裁方。拓展到有同样护照问题的其他地方。"],
    ],
    more: "完整计划、风险以及我们的应对方式：",
    business: "商业模式",
  },
  closing: {
    title: "看押金自己回来。",
    demo: "演示完整跑一笔租赁：付款、发放租金、AI 验车、结算，每笔链上交易都能追踪。",
    app: "打开应用，以车主、租客或争议处理台的身份走一遍租赁流程。",
    playDemo: "播放实时演示",
    openApp: "打开应用",
    github: "在 GitHub 上阅读代码",
  },
  footer: {
    label: "页脚",
    about: "摩托车租赁的押金和租金，托管在 BNB Chain 上。为 BNB Bangkok 2026 打造。开源（MIT），仅限测试网，不发币。",
    tryIt: "试用",
    build: "开发",
    read: "阅读",
    links: {
      demo: "播放实时演示",
      cartoon: "运作方式（动画版）",
      app: "打开应用",
      tenant: "租客",
      landlord: "车队主",
      shareholders: "股东",
      arbiter: "争议处理台",
      developers: "开发者参考",
      integrations: "集成",
      agent: "验车智能体",
      api: "API",
      architecture: "架构",
      github: "GitHub",
      business: "商业模式",
      writeup: "CoinMarketCap x Atlas 技术说明",
      deploy: "测试网部署",
    },
  },
};
