import type { DeepPartial } from "@/lib/i18n/locales";
import type { copy, ENDINGS, Rental, RentalKind, SceneDef } from "./script";

/**
 * Simplified Chinese for the /how-it-works cartoon (components/eli5/script.ts). A builder, not constants: it needs
 * the money and the rented thing from script.ts, which imports this file.
 */

type Money = { rent: bigint; deposit: bigint; paidIn: bigint; termPeriods: number; fee: bigint; rentToLandlord: bigint; aiLandlord: bigint; aiTenant: bigint; deskLandlord: bigint; deskTenant: bigint };
type SceneText = Pick<SceneDef, "text" | "detail" | "calendar">;

export const zhRentals: Record<RentalKind, DeepPartial<Rental>> = {
  home: {
    the: "这套公寓",
    owner: "房东",
    renter: "租客",
    usually: "通常你得把一大笔押金交给陌生人，然后只能祈祷它能回来。",
    usuallyDetail: (d) => `没有 KeyEscrow 时：曼谷的押金是两个月租金（${d}），直接交给房东。`,
    damage: "墙上的一道刮痕",
  },
  scooter: {
    the: "这辆摩托车",
    owner: "车主",
    renter: "租客",
    usually: "通常你得把护照或一大笔押金留给陌生人，然后只能祈祷。",
    usuallyDetail: (d) => `没有 KeyEscrow 时：泰国的租车行扣下你的护照或现金押金（${d}），还多少由他们说了算。`,
    damage: "侧面的一道划痕",
  },
};

export function zhEli5(kind: RentalKind, M: Money, baht: (v: bigint) => string) {
  const R = zhRentals[kind];
  const owner = R.owner!;
  const renter = R.renter!;
  const months = (n: number) => (n <= 4 ? Array.from({ length: n }, (_, i) => `第 ${i + 1} 个月`) : ["第 1 个月", "第 2 个月", "第 3 个月", "…", `第 ${n} 个月`]);

  const scenes: Record<string, Partial<SceneText>> = {
    problem: { text: R.usually, detail: R.usuallyDetail!(baht(M.deposit)) },
    agree: {
      text: `有了 KeyEscrow，双方就${R.the}达成约定。一个带两把锁的保险箱出现了。`,
      detail: `EscrowFactory.createLease() 在 BNB Chain 上为这一笔租赁新建一份 RentalEscrow 合约：每月 ${baht(M.rent)}，押金 ${baht(M.deposit)}。`,
    },
    fund: {
      text: `${renter}把押金和第一个月的租金放进保险箱。`,
      detail: `RentalEscrow.fund()：${baht(M.paidIn)} 的 MockUSDT（测试网 USDT）转入合约，而不是交给${owner}。咔哒一声：现在谁也不能单独拿走。`,
    },
    rent: {
      text: `每个月，租金滚到${owner}那里。KeyEscrow 的罐子里只放进一枚小硬币，仅此一次。`,
      detail: `RentalEscrow.releaseRent()：第 1 个月付给${owner} ${baht(M.rentToLandlord)}，一次性手续费 ${baht(M.fee)}（一个月租金的 10%）进入 KeyEscrow 金库。之后的月份不收手续费。`,
      calendar: months(M.termPeriods),
    },
    moveout: {
      text: "还车的日子到了！第一天和最后一天的照片都在。",
      detail: "取车和还车照片存放在链下，只有它们的 SHA-256 指纹写入合约（addEvidence），事后谁也换不了。",
    },
    inspect: {
      text: "机器人对比照片，提出一个公平的分配方案。它只提建议，由人来决定。",
      detail: `KeyEscrow 验车员 AI 智能体（ERC-8004 身份）发现了${R.damage}：${baht(M.aiLandlord)} 作维修费，${baht(M.aiTenant)} 退还。${renter}用 propose() 提出这个方案。`,
    },
    happy: {
      text: "双方都同意！两把钥匙一起转动，保险箱打开，每个人拿到自己的硬币。",
      detail: `RentalEscrow.accept()：一笔交易就把 ${baht(M.aiTenant)} 退还${renter}，${baht(M.aiLandlord)} 付给${owner}。没有中介，不上法庭。`,
    },
    disagree: {
      text: `${owner}不同意。一位公正的裁判查看照片，决定怎么分。`,
      detail: `dispute() 把事情交给 KeyEscrow 争议处理台；resolve() 付出 ${baht(M.deskLandlord)} 维修费，退还 ${baht(M.deskTenant)}。如果争议处理台超过 14 天没有裁决，钱全部退还${renter}。`,
    },
    silent: {
      text: `${owner} 7 天都没有回应。于是保险箱把一切都还给${renter}。`,
      detail: `7 天回复期限一过，任何人都可以调用 claimTimeout()：${baht(M.deposit)} 押金全额退还${renter}。沉默永远不会让${renter}吃亏。`,
      calendar: ["第 1 天", "第 2 天", "第 3 天", "第 4 天", "第 5 天", "第 6 天", "第 7 天"],
    },
    recap: {
      text: "谁也不能单独拿走这笔钱。规则就是 BNB Chain 上的代码。",
      detail: "每笔租赁都有自己的 RentalEscrow 智能合约，部署在 BNB Chain 上。它没有管理员密钥：资金只能按规则流动。",
    },
  };

  const endings: DeepPartial<typeof ENDINGS> = [
    { id: "happy", label: "双方同意", short: "😊" },
    { id: "disagree", label: "双方有分歧", short: "⚖️" },
    { id: "silent", label: `${owner}不回应`, short: "💤" },
  ];

  const recapNotes = { tenant: [renter, "拿回"], landlord: [owner, "租金 + 维修费"], jar: ["KeyEscrow 罐子", "一次性手续费"], safe: ["保险箱", "已清空"] } as const;

  const ui: DeepPartial<typeof copy> = {
    pageTitle: "运作方式",
    heading: "KeyEscrow，简单讲给你听",
    ending: "结局",
    play: "播放",
    pause: "暂停",
    back: "上一幕",
    next: "下一幕",
    replay: "再看一遍",
    sceneOf: (n, total) => `第 ${n} 幕，共 ${total} 幕`,
    goTo: (n) => `跳到第 ${n} 幕`,
    grownUp: "给大人的细节",
    keys: "空格：播放 / 暂停 · ← →：切换场景",
    realDemo: "在真实的链上看一遍 →",
    tryIt: "亲自试试 →",
    recapTitle: "最后谁拿到了什么",
    names: { tenant: renter, landlord: owner, safe: "保险箱", jar: "KeyEscrow 罐子", robot: "AI 验车员", referee: "裁判" },
    bubbles: {
      worry: "我能拿回来吗？",
      grab: "谢啦！",
      yes: "同意！",
      no: "不行！",
      sleep: "Zzz…",
      click: "咔哒！",
      agreed: "已同意",
      suggest: "我建议：",
      rules: "我裁定：",
      toLandlord: (v) => `${owner}：${v}`,
      toTenant: (v) => `${renter}：${v}`,
      before: "第一天",
      after: "最后一天",
      fair: "公平分配",
      without: "没有 KeyEscrow",
      contract: "租约",
    },
  };

  return { scenes, endings, recapNotes, ui };
}
