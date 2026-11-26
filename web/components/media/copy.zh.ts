import type { DeepPartial } from "@/lib/i18n/locales";
import type { MediaCopy } from "./copy";

/** Simplified Chinese for components/media/copy.ts. Terms: docs/i18n-glossary.md. */
export const zh: DeepPartial<MediaCopy> = {
  metaTitle: "媒体资料 · KeyScrow",
  title: "媒体资料",
  lead: "KeyScrow 的全部视频、路演幻灯片、截图、标志和文档：可以单独下载每个文件，也可以打包成一个 .zip 一次下载。",
  zip: "下载全部（.zip，{size}）",
  zipNote: "共 {n} 个文件，分文件夹存放：videos/、deck/、screenshots/web/、screenshots/ios/、brand/、docs/。.webm 和 .gif 视频、iOS 的 .jpg 副本以及较早的开发截图只能单独下载。",
  download: "下载",
  github: "在 GitHub 查看",
  sections: {
    videos: "视频",
    deck: "路演幻灯片",
    web: "截图：网站",
    ios: "截图：iOS 应用",
    brand: "品牌",
    docs: "文档",
    links: "链接",
  },
  videos: {
    pitch: { title: "路演视频：5 分钟了解 KeyScrow", body: "我们的参赛视频：问题、租客一方、车主一方和赞助商，讲解时配有手绘动画说明。" },
    duo: { title: "租客与租车公司，左右并排", body: "主视频。左边是租客的手机，右边是租车公司：租车、取车照片、还车照片、AI 给出的分配、车主接受、结算完成。配有英文旁白。" },
    "demo-guided": { title: "引导式演示", body: "/demo 的顺利流程，一键从开始播放到包含每个余额的最终总结。" },
    eli5: { title: "动画讲解：它如何运作", body: "/how-it-works：用简单的话讲完整个想法，结局是双方同意。" },
    tour: { title: "应用导览", body: "首页、搜索、一个车辆页面、一笔有争议的租赁、后台、带历史卡片的争议处理台，以及 Ask AI。" },
  },
  gif: "主视频的 GIF 版本（无声音，适合聊天和幻灯片）",
  deckBody: "11 页，1920×1080：问题、KeyScrow 如何运作、iOS 应用、赞助赛道和商业模式。",
  deckPdf: "下载 PDF",
  brand: {
    name: "产品名称",
    nameNote: "一个词，K 和 S 大写。中文文本中也保留拉丁字母名称。",
    colours: "颜色",
    colour: { night: "夜色（首页背景）", amber: "琥珀色（LED 与重点）", pink: "粉色（LED 光晕）", teal: "青色（LED 光晕）", ink: "墨色（应用文字与按钮）", paper: "纸色（应用背景）" },
    files: "标志与图标",
    file: {
      "icon-1024.png": "应用图标，1024 px（iOS）",
      "icon-512.png": "网页应用图标，512 px",
      "apple-icon.png": "Apple 触控图标，180 px",
      "icon.png": "标志，64 px",
      "favicon.ico": "网站图标",
      "mark-96.webp": "标志，96 px（WebP）",
    },
  },
  docs: {
    "WRITEUP.md": "技术说明：CoinMarketCap x Atlas",
    "WRITEUP.zh-CN.md": "技术说明（中文）",
    "ARCHITECTURE.md": "架构",
    "BUSINESS.md": "商业模式",
    "DEMO.md": "演示脚本",
    "HACKQUEST.md": "HackQuest 提交字段",
    "SUBMISSION.md": "提交资料说明：每个视频和截图展示了什么",
  },
  links: {
    app: "在线应用（BSC 测试网）",
    mainnet: "主网试点（BSC，每笔租赁最多 1 美元）",
    agent: "AI 验车智能体（ERC-8004 #2921）",
    repo: "源代码（MIT）",
    testnet: "BSC 测试网上的合约",
    mainnetContracts: "BSC 主网上的合约",
  },
};
