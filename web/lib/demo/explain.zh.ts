import type { DeepPartial } from "../i18n/locales";
import type { Cast, Explain } from "./explain";
import { zhPropertyName } from "./places.zh";
import type { DemoCtx } from "./script";

/**
 * Simplified Chinese for the guided /demo narration (lib/demo/explain.ts). `w` carries the actor-card names in
 * Chinese (车主 / 租客), so the sentences read for any rental.
 */

const need = (c: DemoCtx) => c.deposit + c.rent;
const days = (seconds: number) => Math.round(seconds / 86_400);
const REPLY_DAYS = 7;
const DESK_DAYS = 14;

const payee = (c: DemoCtx, w: Cast) => (c.path === "fleet" ? "车队金库" : w.landlord);
const feeOf = (c: DemoCtx) => c.fee ?? (c.rent * BigInt(c.feeBps ?? 1000)) / BigInt(10_000);
const split = (c: DemoCtx) => ({
  back: c.settled?.tenantRefund ?? (c.inspection ? BigInt(c.inspection.tenantRefund) : undefined),
  keep: c.settled?.landlordClaim ?? (c.inspection ? BigInt(c.inspection.landlordClaim) : undefined),
});

export const zhExplain: DeepPartial<Record<string, Explain>> = {
  create: {
    now: (c, m, w) =>
      `${w.landlord}发布租赁：${zhPropertyName(c.property.name)}，每月 ${m(c.rent)}，押金 ${m(c.deposit)}。` +
      `KeyScrow 在链上（公开的区块链上）为这笔租赁单独创建一份托管合约。`,
    changed: () => "这笔租赁现在有了自己的合约，写明约定的条款。签好的协议留在链下，只有它的指纹（文件的唯一编码）上链，谁也换不了。",
  },
  checkin: {
    now: (_c, _m, w) => `${w.landlord}登记租赁开始时拍的照片。每张照片的指纹写入托管合约，一张照片一笔交易。`,
    changed: () => "起始车况永久存证。租期结束时，AI 只和这些照片对比。",
  },
  faucet: {
    now: (c, m, w) => `${w.tenant}用 USDT 付款，这是一种稳定币（数字美元）。在这条演示链上，免费的测试水龙头给${w.tenant}所需的 ${m(need(c))}。`,
    changed: (c, m, w) =>
      c.faucet === BigInt(0)
        ? `${w.tenant}已经有足够的测试 USDT，所以没有增加。目前还没有锁定任何资金：钱仍在${w.tenant}自己的钱包里。`
        : `${w.tenant}的钱包现在有 ${m(need(c))} 测试 USDT。目前还没有锁定任何资金：钱仍然属于${w.tenant}。`,
  },
  fund: {
    now: (c, m, w) => `${w.tenant}支付押金和第 1 个月租金：${m(need(c))}。两次签名：先“授权”让托管合约可以收款，再“付款”把钱转入。`,
    changed: (_c, _m, w) => `押金现在锁在这笔租赁专属的托管合约里，没有交给${w.landlord}。${w.landlord}和${w.tenant}都无法单独取出。`,
  },
  rent: {
    now: (c, _m, w) =>
      `第 1 个月租金到期。${w.tenant}把它发放给${payee(c, w)}。KeyScrow 唯一的手续费从第一个月里扣：一个月租金的 ${((c.feeBps ?? 1000) / 100).toFixed(0)}%。`,
    changed: (c, m, w) => `${payee(c, w)}收到 ${m(c.rentToLandlord ?? c.rent - feeOf(c))}，KeyScrow 金库收到 ${m(feeOf(c))}。押金继续锁在托管中。`,
  },
  checkout: {
    now: (_c, _m, w) => `租期结束，演示跳过中间的几个月。${w.tenant}从相同角度拍摄还车照片，其中两张显示了新的损伤。`,
    changed: () => "取车和还车照片现在都已存证，可以并排对比。押金仍然一分没动。",
  },
  inspect: {
    now: () => "AI 验车员对比取车和还车照片：列出新的损伤，估算维修费，并起草押金分配方案。",
    changed: (c, m, w) => {
      const s = split(c);
      const draft = s.back !== undefined && s.keep !== undefined ? `AI 起草的方案：${m(s.back)} 退还${w.tenant}，${m(s.keep)} 给${w.landlord}作维修费。` : "";
      return `${draft}AI 只提建议，由人来决定：可以接受、修改或提出争议。`;
    },
  },
  propose: {
    now: (_c, _m, w) => `${w.tenant}同意并在链上提出 AI 的分配方案，附上 AI 报告的指纹，任何人都能核查它的依据。`,
    changed: (_c, _m, w) => `${w.landlord}现在有 ${REPLY_DAYS} 天时间接受、还价或提出争议。如果${w.landlord}不做任何回应，押金全额退还${w.tenant}。`,
  },
  accept: {
    now: (_c, _m, w) => `${w.landlord}查看照片和 AI 的理由后接受。一次签名即可结算：合约同时向双方付款。`,
    changed: (c, m, w) => {
      const s = split(c);
      const paid = s.back !== undefined && s.keep !== undefined ? `${m(s.back)} 退还${w.tenant}，${m(s.keep)} 给了${payee(c, w)}。` : "";
      return `${paid}没有中介，不上法庭，不用等上几周。托管合约现已清空。`;
    },
  },
  dispute: {
    now: (_c, _m, w) => `${w.landlord}认为维修费比 AI 估的高，于是提出争议。这是${w.landlord}的权利：AI 只提建议。`,
    changed: (_c, _m, w) => `押金被冻结。现在只有争议处理台可以在 ${DESK_DAYS} 天内分配它。如果争议处理台错过期限，押金全额退还${w.tenant}。`,
  },
  resolve: {
    now: () => "争议处理台作为中立的仲裁方，查看同样的照片和 AI 报告，然后裁决分配。它自己拿不到押金的一分一毫。",
    changed: (c, m, w) => {
      const back = c.settled?.tenantRefund ?? c.ruling?.tenantRefund;
      const keep = c.settled?.landlordClaim ?? c.ruling?.landlordClaim;
      const paid = back !== undefined && keep !== undefined ? `裁决已付款：${m(back)} 给${w.tenant}，${m(keep)} 给${w.landlord}。` : "";
      return `${paid}裁决的指纹随付款一起存证上链，任何人都能核查。`;
    },
  },
  wait: {
    now: (_c, _m, w) => `${w.landlord}没有回应。在真实网络上我们要等 ${REPLY_DAYS} 天。这条本地演示链可以把时钟拨快，真实的链做不到。`,
    changed: (c, _m, w) => `链上时钟已经过去 ${c.fastForwarded ? days(c.fastForwarded) : REPLY_DAYS} 天。${w.landlord}的回复期限已过。目前还没有资金流动。`,
  },
  timeout: {
    now: (_c, _m, w) => `${w.landlord}的回复期限已过，现在任何人都可以关闭这笔租赁。${w.tenant}用一笔交易完成。`,
    changed: (c, m, w) => `${m(c.deposit)} 押金全额退还${w.tenant}，而不只是 AI 方案的部分。沉默永远不会让${w.tenant}吃亏。`,
  },
  vault: {
    now: () => "这笔租赁属于车队金库：一个由股东共同拥有的资金池。我们读取金库从这笔租赁获得的新收入，以及一位演示股东现在可以领取的金额。",
    changed: (c, m) => {
      const v = c.vaultIncome;
      const got = v ? `金库的新收入从 ${m(v.before)} 增加到 ${m(v.after)}；演示股东可以领取 ${m(v.claimable)}。` : "";
      return `${got}租金和维修赔偿直接进入金库，而不是某一个人的口袋，由股东们分享。`;
    },
  },
  final: {
    now: (_c, _m, w) => `最后一步：读取所有余额并核对账目。${w.tenant}付入的每一笔钱都必须有去处。`,
    changed: (_c, _m, w) => `托管合约已清空。每一泰铢要么给了${w.landlord}和 KeyScrow 金库，要么退回了${w.tenant}。`,
  },
};
