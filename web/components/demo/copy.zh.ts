import type { DeepPartial } from "@/lib/i18n/locales";
import type { DemoCopy } from "./copy";

/** Simplified Chinese for components/demo/copy.ts. Terms: docs/i18n-glossary.md. */
export const zh: DeepPartial<DemoCopy> = {
  pageTitle: "播放演示",
  pageIntro: "一键在本地链上播放 KeyEscrow 的完整流程：真实的合约、真实的交易，下方真实的租赁页面实时更新。演示账户会自动切换。",

  actorLabel: {
    landlord: "车主",
    tenant: "租客",
    arbiter: "争议处理台",
    inspector: "KeyEscrow 验车员（AI 智能体）",
    investor: "股东",
    anyone: "任何人",
  },

  actorCards: {
    landlord: { name: "车主", note: "出租车辆，收取租金" },
    tenant: { name: "租客", note: "把押金和租金存入托管" },
    escrow: { name: "托管合约", note: "仅限这笔租赁：保管押金", empty: "在第 1 步创建" },
    treasury: { name: "KeyEscrow 金库", note: "平台手续费：一次性，从第 1 个月扣除" },
    arbiter: { name: "争议处理台", note: "裁决争议，不经手资金" },
    inspector: { name: "AI 验车员", note: "起草分配方案，不经手资金" },
    faucet: "MockUSDT 水龙头",
  },

  controls: {
    story: "情节",
    speed: "速度",
    mode: "模式",
    normal: "正常",
    fast: "快速",
    auto: "自动播放",
    step: "逐步",
    play: "播放演示",
    playAgain: "再播一次",
    next: "下一步 →",
    pause: "❚❚ 暂停",
    resume: "▶ 继续",
    restart: "重新开始",
    connecting: "正在连接本地链…",
    paused: "已暂停。按“继续”接着播放。",
    pausing: "将在下一笔交易前暂停…",
    showSummary: "查看总结",
  },

  intro: {
    title: "接下来你会看到",
    bullets: [
      "一笔全新的摩托车租赁：在这条本地 anvil 链上用真实交易完成创建、付款和结算。",
      "演示会自动在车主、租客和争议处理台的账户之间切换（留意黄色提示条）。",
      "所有金额先显示泰铢，再显示美元和链上的精确 mUSDT 数额。",
      "AI 还车验车、流向 KeyEscrow 金库的手续费，以及最终余额。",
    ],
    presenting: "现场演示？选择“逐步”：每一步都等你点击。随时可以暂停。",
  },

  panels: {
    story: "流程",
    stage: "当前步骤",
    live: "真实的租赁页面，实时更新",
    liveNote: "车主和租客使用的同一个组件，每笔交易后重新渲染。",
    liveEmpty: "车主创建租赁后，租赁页面就会出现在这里。",
    openTab: "在新标签页打开 ↗",
    moved: "资金流动",
    nothingMoved: "这一步没有资金流动。",
    working: "处理中…",
    stepOf: (n, total) => `第 ${n} 步，共 ${total} 步`,
    txTitle: (hash) => `交易 ${hash}：在租赁时间线上查看`,
  },

  errorCopy: {
    title: (n, title) => `第 ${n} 步（${title}）没有成功`,
    retry: "重试这一步",
    startOver: "用一笔新租赁重新开始",
  },

  inspectionCopy: {
    title: "AI 还车验车",
    back: "退还租客",
    keeps: "车主保留（维修）",
    signed: (name, agentId) =>
      `由 ${name}${agentId !== undefined ? `（ERC-8004 智能体 #${agentId}）` : ""}签名：它的身份登记在 BNB Chain 上，任何人都能核实这份报告出自它手。`,
    unsigned:
      "报告由 KeyEscrow 验车员智能体生成。本地演示未设置 INSPECTOR_PRIVATE_KEY，所以没有签名；设置密钥后，每份报告都由该智能体在 BNB Chain 上的 ERC-8004 身份签名。",
    meta: (confidence, mock, provider) =>
      `置信度 ${(confidence * 100).toFixed(0)}% · ${mock ? "演示验车员（未配置 AI 密钥）" : `视觉模型：${provider}`} · 报告`,
  },

  summaryCopy: {
    tryLabel: {
      happy: "试试顺利结算",
      dispute: "试试争议流程",
      timeout: "试试：车主不回应",
      fleet: "试试车队金库流程",
    },
    outcome: {
      happy: "一键结算：双方同意了分配方案",
      dispute: "由 KeyEscrow 争议处理台裁决结算",
      timeout: "车主没有回应：押金全额退还租客",
      fleet: "车辆受损归还已结算：租金和赔偿款进入车队金库",
    },
    terms: (property, rent, deposit) => `${property} · 每月 ${rent} · 押金 ${deposit}。这笔租赁的最终余额：`,
    tenant: "租客",
    tenantNote: (paidIn) => `拿回的金额（共付入 ${paidIn}）`,
    landlord: "车主",
    landlordNote: "扣除手续费后的第 1 个月租金 + 维修费",
    vault: "车队金库",
    vaultNote: (symbol) => `车主所得，由 ${symbol} 持有人分享`,
    treasury: "KeyEscrow 金库",
    treasuryNote: "一次性手续费",
    escrow: "托管合约",
    escrowNote: "托管中剩余",
    balanced: (paidIn, tenant, landlord, treasury) =>
      `账目平衡：租客付入的 ${paidIn} 分别回到租客（${tenant}）、车主（${landlord}）和金库（${treasury}）。托管合约已清空。`,
    unbalanced: "✗ 余额对不上。打开租赁页面查看时间线。",
    again: "再运行一次",
    openLease: "打开租赁页面 ↗",
    hide: "隐藏 ✕",
  },

  testnetCopy: {
    badge: "BSC 测试网实时运行",
    badgeShort: "BSC 测试网",
    badgeTitle: "每一步都是真实的 BSC 测试网（chain 97）交易，由 KeyEscrow 服务器上的演示钱包签名。点击任意哈希可在 BscScan 上打开。",
    pageIntro:
      "一键在 BSC 测试网上实时播放 KeyEscrow 的完整流程：真实的合约、可以在 BscScan 上查看的真实公开交易，下方真实的租赁页面同步更新。无需钱包：由 KeyEscrow 的演示车主、租客和争议处理台在服务器端签名。",
    bullets: [
      "一笔全新的摩托车租赁：在 BSC 测试网（chain 97）上用真实交易完成创建、付款和结算。每笔交易需要几秒钟确认。",
      "流程栏中的每笔交易都链接到 BscScan，左侧余额实时从链上读取。",
      "所有金额先显示泰铢，再显示美元和链上的精确 mUSDT 数额。",
      "AI 还车验车、流向 KeyEscrow 金库的手续费，以及最终余额。",
    ],
    timeoutNote: "“车主不回应”在公链上需要真实等待 7 天；请在本地演示中播放。",
    timeoutShort: "需要 7 天；请在本地演示中播放",
    waiting: (code, sec) => (code === "busy" ? `有人正在播放实时演示。约 ${sec} 秒后空出，你的演示会自动开始。` : `实时演示刚刚运行过。你的演示将在 ${sec} 秒后开始…`),
    presenting: "同一时间只能运行一场实时演示。选择“逐步”可以一步步点击；随时可以暂停。",
    txTitle: (hash) => `在 BscScan 上打开交易 ${hash}`,
    topUp: (role) => `为${role}补充 Gas（KeyEscrow 提供的 tBNB）`,
    reverted: (label, url) => `“${label}”在 BSC 测试网上被回滚。在 BscScan 上查看原因：${url}`,
    noRpc: "无法连接 BSC 测试网。请检查网络后点击重试。",
    escrowOnBscscan: "在 BscScan 上查看托管合约 ↗",
    unsigned:
      "报告由 KeyEscrow 验车员智能体生成。本测试网演示服务器未设置 INSPECTOR_PRIVATE_KEY，所以没有签名；设置密钥后，每份报告都由该智能体在 BNB Chain 上的 ERC-8004 身份签名。",
    off: "此服务器已关闭测试网实时演示。连接钱包即可在 BSC 测试网上使用 KeyEscrow，或在本地构建中播放演示。",
    loading: "正在加载测试网实时演示…",
    ctaTitle: "一键看完整个流程，在 BSC 测试网上实时运行",
    ctaBody: "一笔全新的摩托车租赁：付款、发放租金、AI 验车、结算，全部是可以在 BscScan 上查看的真实 BSC 测试网交易。无需钱包，大约两分钟。",
  },

  guidedCopy: {
    speed: "讲解",
    speedTitle: "慢速讲解：每一步先说明要发生什么，再执行，最后展示变化",
    normalTitle: "每步一句简短说明",
    fastTitle: "不停顿",
    beat: { intro: "开始之前", now: "现在发生什么", run: "正在上链", changed: "刚刚发生了什么变化" },
    back: "← 上一步",
    next: "下一步 →",
    pressNext: "按“下一步 →”继续。",
    paused: "已暂停。按“继续”或空格键。",
    reviewing: "回看中：这一步已经发生。按“下一步 →”回到实时演示。",
    keys: "空格暂停 · ← → 切换说明",
    why: "为什么重要",
    signing: (who) => `以${who}身份签名`,
    calling: (contract, fn, args) => `调用 ${contract}.${fn}(${args})`,
    upload: (n) => `把 ${n} 个文件存到链下；只有指纹会上链`,
    inspect: "AI 验车员正在对比取车和还车照片",
    time: (seconds) => `把演示链的时钟拨快 ${Math.round(seconds / 86_400)} 天`,
    confirmed: "已确认",
    failed: "失败",
    nothingYet: "开始中…",
    acting: "▶ 正在操作",
    receiving: "← 接收",
    intro: {
      title: "KeyEscrow 如何运作",
      body:
        "在泰国租摩托车，常常要把护照或现金押金留在车行，想拿回来并不容易。" +
        "KeyEscrow 把押金放进托管（由中立方保管）：一份部署在 BNB Chain 上、谁也改不了的智能合约。",
      cast: "角色介绍",
      see: "你会看到",
      beats: "每一步分三部分：现在发生什么、交易本身、刚刚发生了什么变化。",
    },
  },
};
