import { localized } from "@/lib/i18n/locales";
import { zh } from "./copy.zh";

/** Every word of /media (app/(app)/media/page.tsx); file names, sizes and addresses live in the page. */
const en = {
  metaTitle: "Media kit · KeyScrow",
  title: "Media kit",
  lead: "Every video, the pitch deck, the screenshots, the logo and the documents of KeyScrow: each file on its own, or all of them in one .zip.",
  zip: "Download everything (.zip, {size})",
  zipNote: "{n} files in folders: videos/, deck/, screenshots/web/, screenshots/ios/, brand/, docs/. The .webm and .gif videos and the iOS .jpg copies repeat other files, so they are separate downloads only.",
  download: "Download",
  github: "On GitHub",
  sections: {
    videos: "Videos",
    deck: "Pitch deck",
    web: "Screenshots: website",
    ios: "Screenshots: iOS app",
    brand: "Brand",
    docs: "Documents",
    links: "Links",
  },
  videos: {
    duo: { title: "Renter and rental company, side by side", body: "The hero video. The renter's phone on the left, the rental company on the right: rent, pickup photo, return photo, the AI's split, the owner accepts, settled." },
    "demo-guided": { title: "The guided demo", body: "/demo on the happy path, one click from start to the final summary with every balance." },
    eli5: { title: "How it works, as a cartoon", body: "/how-it-works: the whole idea in plain words, with the ending where both sides agree." },
    tour: { title: "App tour", body: "The landing page, search, a listing, a rental in dispute, the back office, the dispute desk with history cards and Ask AI." },
  },
  gif: "The hero video as a GIF (no sound, for chats and slides)",
  deckBody: "11 slides at 1920×1080: the problem, how KeyScrow works, the iOS app, the sponsor tracks and the business.",
  deckPdf: "Download the PDF",
  brand: {
    name: "Product name",
    nameNote: "One word, capital K and S. Chinese text keeps the Latin name.",
    colours: "Colours",
    colour: { night: "Night (landing background)", amber: "Amber (LED and highlights)", pink: "Pink (LED glow)", teal: "Teal (LED glow)", ink: "Ink (app text and buttons)", paper: "Paper (app background)" },
    files: "Logo and icons",
    file: {
      "icon-1024.png": "App icon, 1024 px (iOS)",
      "icon-512.png": "Web app icon, 512 px",
      "apple-icon.png": "Apple touch icon, 180 px",
      "icon.png": "Logo mark, 64 px",
      "favicon.ico": "Favicon",
      "mark-96.webp": "Logo mark, 96 px (WebP)",
    },
  },
  docs: {
    "WRITEUP.md": "Write-up: CoinMarketCap x Atlas",
    "WRITEUP.zh-CN.md": "Write-up in Chinese",
    "ARCHITECTURE.md": "Architecture",
    "BUSINESS.md": "Business model",
    "DEMO.md": "Demo script",
    "HACKQUEST.md": "HackQuest submission fields",
    "SUBMISSION.md": "Submission kit: what each video and screenshot shows",
  },
  links: {
    app: "Live app (BSC testnet)",
    mainnet: "Mainnet pilot (BSC, max 1 USD a rental)",
    agent: "AI inspector agent (ERC-8004 #2921)",
    repo: "Source code (MIT)",
    testnet: "Contracts on BSC testnet",
    mainnetContracts: "Contracts on BSC mainnet",
  },
};

export type MediaCopy = typeof en;
export const mediaCopy = localized(en, zh);
