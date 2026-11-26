import { EN_ERRORS, type ErrorText } from "./errors";
import { withFallback, type DeepPartial, type Lang } from "./i18n/locales";

/** Simplified Chinese for lib/errors.ts. Imported by client code only: the API routes and agent tools stay English. */
export const zhErrors: DeepPartial<ErrorText> = {
  plain: {
    Unauthorized: "这个钱包无权对这笔租赁执行该操作。请切换到正确的账户。",
    InvalidStatus: "这笔租赁当前的状态已经不能执行这个操作。请刷新页面查看状态。",
    InvalidAmount: "这个金额对这笔租赁无效。",
    InvalidNonce: "你查看期间提议已经变了。请阅读新提议后再试。",
    ProposerCannotAccept: "这个提议是你提出的，需要由另一方接受。",
    TimeoutNotReached: "还没到期限。",
    ArbiterDeadlinePassed: "仲裁方的期限已过。现在只能按兜底规则关闭争议（押金全额退还租客）。",
    InvalidArbiterWindow: "仲裁期限必须在 1 到 90 天之间。",
    ResponseWindowClosed: "车主对租客提议的回复期限已过。现在只能按超时规则关闭这笔租赁（押金全额退还租客）。",
    SharesLocked: "最近一次存入后，车队金库份额会锁定 7 天。收益仍可领取。",
    TimeoutNotApplicable: "超时规则只适用于租客提出的提议。",
    NothingToRelease: "目前没有已付款、到期待发放的租金。",
    TermFullyFunded: "整个租期的租金都已付清。",
    TransferShortfall: "代币转账金额不足。",
    ZeroAddress: "缺少一个地址。",
    RolesNotDistinct: "车主、租客和仲裁方必须是三个不同的地址，收款方也不能是租客或仲裁方。",
    InvalidTerm: "租期必须在 1 到 60 期之间。",
    InvalidRentPeriod: "租金每 7、14 或 30 天支付一次。",
    DepositAboveCap: "试点上限：这笔押金超过了 KeyScrow 每笔租赁的上限。请调低。",
    RentAboveCap: "试点上限：这笔租金超过了 KeyScrow 每期租金的上限。请调低。",
    ActiveValueAboveCap: "试点上限：KeyScrow 托管的总金额已达试点上限。请等其他租赁结算后再试。",
    InvalidResponseWindow: "回复期限必须在 1 到 60 天之间。",
    ERC20InsufficientAllowance: "请先授权 USDT 金额。",
    ERC20InsufficientBalance: "这个钱包里的 USDT 不够。在 anvil 上可以用测试水龙头领取。",
    FaucetLimitExceeded: "水龙头每次最多发放 10,000 测试 USDT。",
  },
  general: {
    cancelled: "你在钱包里取消了这次请求。",
    rejected: (what) => `合约拒绝了这次操作：${what}`,
    gas: "这个钱包没有足够的 Gas（BNB）发送交易。",
    rpc: "无法连接区块链节点。请检查 RPC 是否在运行。",
    unknown: "出了点问题。",
  },
};

const ZH = withFallback(EN_ERRORS, zhErrors);
/** friendlyError's sentences in a language: `friendlyError(err, errorsIn(lang))`. */
export const errorsIn = (lang: Lang): ErrorText => (lang === "zh" ? ZH : EN_ERRORS);
