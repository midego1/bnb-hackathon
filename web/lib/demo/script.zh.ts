import type { DeepPartial } from "../i18n/locales";
import { zhPropertyName } from "./places.zh";
import { deskRuling, type DemoCtx, type DemoPath, type DemoStep } from "./script";

/** Simplified Chinese for the /demo story in lib/demo/script.ts (paths, step titles, captions, transaction labels). */

type StepText = Pick<DemoStep, "title" | "caption" | "demoOnly">;

const REPLY_DAYS = 7;
const DESK_DAYS = 14;
const need = (c: DemoCtx) => c.deposit + c.rent;

export const zhPaths: DeepPartial<Record<DemoPath, { label: string; blurb: string }>> = {
  happy: { label: "顺利结算", blurb: "租客提出 AI 给出的分配方案，车主接受，资金立刻到账。" },
  dispute: { label: "争议流程", blurb: "车主对提议提出争议，由 KeyEscrow 争议处理台裁决分配。" },
  timeout: { label: "车主不回应", blurb: "车主 7 天不回应，押金全额退还租客。" },
  fleet: { label: "车队金库", blurb: "一辆车队摩托车：租金和赔偿款流入车队金库，股东获得收益。" },
};

export const zhSteps: Record<string, Partial<StepText>> = {
  create: {
    title: "车主发布租赁",
    caption: (c, m) =>
      `${zhPropertyName(c.property.name)}：每月 ${m(c.rent)}，押金 ${m(c.deposit)} 存入托管，而不是扣下租客的护照，租期 ${c.termPeriods} 个月。` +
      `租赁协议 PDF 和取车照片存放在链下，只有它们的 SHA-256 指纹上链。默认由 KeyEscrow 争议处理台担任仲裁方。`,
  },
  checkin: {
    title: "取车照片存证",
    caption: () => "车主把每张取车照片的指纹写入租赁合约。还车时，AI 验车只和这些文件对比，事后谁也换不了。",
  },
  faucet: {
    title: "租客领取演示 mUSDT",
    caption: (c, m) =>
      c.faucet === BigInt(0)
        ? `租客已持有足够的 MockUSDT（测试网上代替 USDT 的代币）支付 ${m(need(c))}，无需水龙头。`
        : `MockUSDT 是测试网上代替 USDT 的代币。租客从水龙头领取所需的 ${m(need(c))}。在主网上这会是真正的 USDT。`,
  },
  fund: {
    title: "租客支付押金和首月租金",
    caption: (c, m) => `钱包里两步操作：先授权，再付款。${m(need(c))} 进入这笔租赁专属的托管合约，而不是车主手里。从现在起，任何一方都无法单独动用押金。`,
  },
  rent: {
    title: "发放第 1 个月租金",
    caption: (c, m) => {
      const fee = c.fee ?? (c.rent * BigInt(c.feeBps ?? 1000)) / BigInt(10_000);
      return (
        `第 1 个月租金在第一天到期。租客放款：${m(c.rentToLandlord ?? c.rent - fee)} 给车主，一次性 KeyEscrow 手续费 ${m(fee)}` +
        `（一个月租金的 ${((c.feeBps ?? 1000) / 100).toFixed(0)}%）进入 KeyEscrow 金库。押金继续锁定。`
      );
    },
  },
  checkout: {
    title: "还车：拍摄车辆照片",
    caption: () =>
      "还车日。现实中后面两个月的租金按同样方式发放，演示直接跳过。时间没有造假：押金结算不依赖时间。" +
      "租客还车，从相同角度拍两张还车照片。左侧面板有划痕，一个后视镜裂了。",
  },
  inspect: {
    title: "AI 验车起草分配方案",
    caption: (c, m) =>
      c.inspection
        ? `KeyEscrow 验车员智能体对比了取车和还车照片：${m(BigInt(c.inspection.tenantRefund))} 退还租客，` +
          `${m(BigInt(c.inspection.landlordClaim))} 给车主作维修费。它只起草，从不做决定。报告的哈希会随提议一起上链。`
        : "KeyEscrow 验车员智能体对比取车和还车照片，起草一份附理由的押金分配方案。它只起草，从不做决定。",
  },
  propose: {
    title: "租客在链上提出分配方案",
    caption: (c, m) =>
      c.inspection
        ? `租客同意 AI 的方案并在链上提出：退还 ${m(BigInt(c.inspection.tenantRefund))}，${m(BigInt(c.inspection.landlordClaim))} 给车主。` +
          `现在车主有 ${REPLY_DAYS} 天时间接受、还价或提出争议。`
        : "租客在链上提出 AI 的分配方案。",
  },
  accept: {
    title: "车主接受：即时结算",
    caption: () => "车主查看照片和 AI 给出的理由后接受。一笔交易就把钱付给所有人：不用在柜台讨价还价，不扣护照，不上法庭。",
  },
  dispute: {
    title: "车主提出争议",
    caption: () =>
      `车主认为维修费比 AI 估的高，于是提出争议。现在只有 KeyEscrow 争议处理台可以在 ${DESK_DAYS} 天内分配押金；` +
      `如果错过期限，押金全额退还租客。`,
  },
  resolve: {
    title: "争议处理台裁决分配",
    caption: (c, m) => {
      const r = c.ruling ?? deskRuling(c);
      return `争议处理台查看同样的照片和 AI 报告后裁决：车主保留 ${m(r.landlordClaim)} 用于侧板喷漆和更换后视镜，${m(r.tenantRefund)} 退还租客。裁决的指纹随付款一起存证上链。`;
    },
  },
  wait: {
    title: "车主 7 天不回应",
    demoOnly: `快进 ${REPLY_DAYS} 天（仅限演示）`,
    caption: () =>
      `车主没有回应。在真实链上我们要等 ${REPLY_DAYS} 天；在这条本地演示链上，我们把区块时钟拨快` +
      "（anvil 的 evm_increaseTime）。这是演示中唯一改动时间的地方，在真实网络上不可能做到。",
  },
  timeout: {
    title: "押金全额退还租客",
    caption: (c, m) => `车主的回复期限已过，任何人都可以关闭这笔租赁。车主从未提出索赔，所以 ${m(c.deposit)} 押金全额退还租客，而不只是 AI 方案的部分。沉默永远不会让租客吃亏。`,
  },
  final: {
    title: "最终余额",
    caption: () => "托管合约已清空，每一泰铢都有去处：租客付入的钱要么给了车主和 KeyEscrow 金库，要么退回了租客。",
  },
  vault: {
    title: "车队金库余额增加",
    caption: (c, m) => {
      const v = c.vaultIncome;
      return v
        ? `这辆摩托车属于车队金库。它的租金和从押金中扣下的 ${m(c.settled?.landlordClaim ?? BigInt(0))} 赔偿款直接进入金库：` +
            `待分配收入从 ${m(v.before)} 增加到 ${m(v.after)}。扣除运营方的维护费后，由 ${v.symbol} 股东分享；演示股东现在可以领取 ${m(v.claimable)}。`
        : "这辆摩托车属于车队金库：租金和赔偿款进入金库，股东领取各自的份额。";
    },
  },
};

const TX: Record<string, string> = {
  "Create rental": "创建租赁",
  "Create fleet rental": "创建车队租赁",
  "Get test USDT": "领取测试 USDT",
  "Approve USDT": "授权 USDT",
  "Fund escrow": "向托管付款",
  "Release rent": "发放租金",
  "Submit AI proposal": "提交 AI 提议",
  "Accept proposal": "接受提议",
  "Open dispute": "提出争议",
  "Resolve dispute": "裁决争议",
  "Claim owner timeout": "因车主超时领回押金",
};

/** A transaction label from the steps (`api.tx(label, ...)`) in Chinese; unknown labels stay as they are. */
export function zhTxLabel(label: string): string {
  const photo = /^Record (pickup|return) photo (\d+)\/(\d+)$/.exec(label);
  if (photo) return `存证${photo[1] === "pickup" ? "取车" : "还车"}照片 ${photo[2]}/${photo[3]}`;
  return TX[label] ?? label;
}
