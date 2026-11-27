// Records the Living Brain memory video docs/submission/livingbrain.mp4 against the LIVE site (read-only: no wallet,
// no transactions; three Ask AI questions). The open demo-world dispute (Kenji vs Phuket Island Rides) with both
// history cards, Ask AI retrieving and connecting the memory, /sponsors and /integrations, and how a memory is written.
//
//   node web/scripts/record-livingbrain.mjs <outDir> <durations.json>
//     durations.json: { lineId: seconds } of the Piper lines in docs/submission/livingbrain-voiceover.md; each segment
//     holds at least as long as its line. Prints marks.json (line id -> start second) for the audio mix.
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.REC_BASE ?? "https://keyscrow.app";
const W = 1470, H = 830;
const out = process.argv[2] ?? "/tmp/rec/lb";
const DUR = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const DISPUTE = "0xb08291588FB1c1C6B06D577F949299bdc098E8c1"; // Kenji vs Phuket Island Rides, open (docs/DEMO.md)
const SETTLED = "0xB6658669EcAdeBd0F4F4c8F6c59481a429e2f7B5"; // Kenji's earlier clean return
// The agent's history tool reads one wallet (or one rental) at a time, so the "retrieve" and "connect" questions are
// about this rental's shop: its remembered disputes, then this claim next to them.
const QUESTIONS = ["What is this renter's history?", "Has this shop disputed deposits before?", "How does this 45% claim compare with the shop's past claims?"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR = `(() => { if (window.top !== window) return; addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div'); c.id = '__rec_cursor';
  c.style.cssText = 'position:fixed;left:735px;top:415px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(240,185,11,.55);border:2px solid rgba(20,20,20,.75);z-index:2147483647;pointer-events:none;transition:left .6s ease,top .6s ease,transform .15s';
  document.documentElement.appendChild(c); }); })();`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "light", recordVideo: { dir: out, size: { width: W, height: H } } });
await ctx.addCookies([{ name: "ke_lang", value: "en", url: BASE }]);
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const marks = {};
let segEnd = 0;
/** Starts a voice line: marks it, captions it, and remembers when it ends so `done()` can wait for it. */
async function line(id, text, extra = 0) {
  await done();
  marks[id] = now();
  segEnd = Date.now() + (DUR[id] + 0.6 + extra) * 1000;
  if (text !== undefined) await caption(text);
}
async function done(min = 0) { await sleep(Math.max(min, segEnd - Date.now())); }
async function caption(text) {
  await page.evaluate((text) => {
    let c = document.getElementById("__rec_caption");
    if (!c) { c = document.createElement("div"); c.id = "__rec_caption"; document.documentElement.appendChild(c); }
    c.style.cssText = "position:fixed;right:32px;bottom:28px;max-width:560px;padding:10px 16px;border-radius:14px;background:rgba(17,17,17,.88);color:#fff;font:600 17px/1.35 system-ui,sans-serif;z-index:2147483646;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.25);transition:opacity .3s";
    c.style.opacity = text ? "1" : "0";
    if (text) c.textContent = text;
  }, text);
}
async function show(loc, pause = 700) {
  const b = await loc.boundingBox().catch(() => null);
  if (!b) return;
  await page.evaluate(([x, y]) => { const c = document.getElementById("__rec_cursor"); if (c) { c.style.left = x + "px"; c.style.top = y + "px"; } }, [b.x + Math.min(b.width / 2, 260), b.y + Math.min(b.height / 2, 40)]);
  await sleep(pause);
}
async function click(loc) {
  await show(loc);
  await page.evaluate(() => { const c = document.getElementById("__rec_cursor"); if (c) { c.style.transform = "scale(.7)"; setTimeout(() => (c.style.transform = ""), 160); } });
  await loc.click();
}
/** Eased scroll of the window (or a scroll container) so the element's top sits `offset` px below the top. */
async function scrollTo(loc, offset = 90, ms = 1400) {
  await loc.evaluate(async (el, [offset, ms]) => {
    let box = el.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    const win = !box || box === document.body || box === document.documentElement;
    const from = win ? scrollY : box.scrollTop;
    const top = el.getBoundingClientRect().top - (win ? 0 : box.getBoundingClientRect().top);
    const to = Math.max(0, from + top - offset);
    const s = performance.now();
    await new Promise((res) => { const step = (n) => { const k = Math.min(1, (n - s) / ms); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; const y = from + (to - from) * e; win ? scrollTo(0, y) : (box.scrollTop = y); k < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); });
  }, [offset, ms]);
  await sleep(300);
}
async function scrollBy(dy, ms = 1400) {
  await page.evaluate(async ([dy, ms]) => { const from = scrollY, s = performance.now();
    await new Promise((res) => { const step = (n) => { const k = Math.min(1, (n - s) / ms); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, from + dy * e); k < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); }); }, [dy, ms]);
}
async function goto(path, ready) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (ready) await ready.waitFor({ timeout: 60_000 });
  await sleep(800);
}
/** Ask AI: type the question, send, wait until the answer stops growing. */
async function ask(q) {
  const input = page.getByTestId("assistant-input");
  await click(input);
  await input.pressSequentially(q, { delay: 45 });
  await sleep(500);
  const logEl = page.getByTestId("assistant-log");
  const before = (await logEl.innerText().catch(() => "")).length;
  await click(page.getByTestId("assistant-send"));
  const stop = page.getByTestId("assistant-stop");
  await stop.waitFor({ timeout: 15_000 }).catch(() => {});
  const until = Date.now() + 150_000;
  while (Date.now() < until && (await stop.isVisible().catch(() => false))) {
    await sleep(400);
    await logEl.evaluate((el) => { for (const b of [el, ...el.querySelectorAll("*")]) if (b.scrollHeight > b.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(b).overflowY)) b.scrollTop = b.scrollHeight; }).catch(() => {});
  }
  await sleep(1200);
  const last = await logEl.innerText().catch(() => "");
  fs.appendFileSync(`${out}/answers.txt`, `\n### ${q}\n${last.slice(before)}\n`);
}

try {
 if (process.env.SEG === "int") {
  // The /integrations take alone (its Living Brain section), spliced in place of the main take's.
  await goto("/integrations", page.getByRole("heading", { name: /Living Brain/ }));
  marks.cut = now();
  const lb = page.getByRole("heading", { name: /Living Brain/ });
  await scrollTo(lb, 90, 1800);
  await line("i1", "/integrations · Living Brain: live on this server, with a daily call budget");
  await show(lb, 1500);
  await done(1500);
 } else if (process.env.SEG === "ask") {
  await goto(`/lease/${DISPUTE}`, page.getByTestId("history-entry").first());
  await scrollTo(page.getByTestId("party-histories"), 70, 10);
  await click(page.getByTestId("assistant-bubble"));
  await page.getByTestId("assistant-input").waitFor();
  await sleep(1500);
  marks.cut = now();
  await line("q2", "Retrieve: the shop's remembered disputes and how the desk ruled");
  await ask(QUESTIONS[1]);
  await done(3500);
  await line("q3", "Connect: this claim next to the shop's remembered claims");
  await ask(QUESTIONS[2]);
  await line("q3b", "The AI summarises; the dispute desk decides");
  await done(3000);
  await page.screenshot({ path: `${out}/ask.png` });
 } else {
  // 1. The problem, on the dispute desk.
  await goto("/arbiter", page.getByRole("heading", { name: "Dispute desk" }));
  await sleep(600);
  await line("p1", "The problem: a dispute desk sees one rental at a time. Who is this renter? Has this scooter had this scratch before?");
  await show(page.getByRole("heading", { name: "Dispute desk" }));
  await line("p2", "KeyScrow · the dispute desk on BNB Chain testnet: it decides the deposit split when owner and renter disagree");
  await show(page.getByTestId("view-arbiter"));
  await done();

  // 2. The open dispute and both history cards.
  await goto(`/lease/${DISPUTE}`, page.getByTestId("history-entry").first());
  await line("a1", "A live dispute: Kenji (demo renter) vs Phuket Island Rides. The shop claims 45 %, the AI inspection proposed 0 %");
  await show(page.getByTestId("rental-banner"), 1500);
  await done(2500);
  await scrollTo(page.getByTestId("party-histories"), 70, 1800);
  await caption("");
  await sleep(400);
  await page.screenshot({ path: `${out}/poster.png` });
  const renter = page.getByTestId("history-card").first(), owner = page.getByTestId("history-card").nth(1);
  await line("a2", "Renter's history card: facts folded from the chain (rentals, settled, disputes, rent on time)");
  await show(renter.getByTestId("history-facts"), 900);
  await show(renter.getByTestId("history-events"), 900);
  await done(1000);
  await scrollTo(renter.getByTestId("history-memory"), 220, 1200);
  await line("a3", "Remembered by Living Brain, per wallet: Kenji's earlier rental, settled by agreement, full deposit back, with its transaction");
  await show(renter.getByTestId("history-entry").first(), 1200);
  await done(1000);
  await scrollTo(owner, 70, 1600);
  await line("a4", "Owner's card: 5 rentals, 3 disputes; each time the shop claimed far more than the AI proposed");
  await show(owner.getByTestId("history-facts"), 1000);
  await show(owner.getByTestId("history-events"), 1000);
  await done(1000);
  await scrollTo(owner.getByTestId("history-memory"), 90, 1600);
  await line("a5", "Living Brain recalls every past outcome of this shop's wallet: two desk rulings, two clean settlements");
  for (const i of [0, 1, 2, 3]) await show(owner.getByTestId("history-entry").nth(i), 1100);
  await done(800);

  // 3. Ask AI: retrieve and connect.
  await scrollTo(page.getByTestId("party-histories"), 70, 1400);
  await line("q1", "Ask AI: the agent retrieves the same per-wallet memory (Living Brain) and answers from it");
  await click(page.getByTestId("assistant-bubble"));
  await page.getByTestId("assistant-input").waitFor();
  await sleep(700);
  await ask(QUESTIONS[0]);
  await line("q1b", "The answer cites the remembered rental and the on-chain facts, so every claim can be checked");
  await sleep(1500);
  await done(1500);
  await line("q2", "Retrieve: the shop's remembered disputes and how the desk ruled");
  await ask(QUESTIONS[1]);
  await done(2500);
  await line("q3", "Connect: this claim next to the shop's remembered claims");
  await ask(QUESTIONS[2]);
  await line("q3b", "The AI summarises; the dispute desk decides");
  await done(2500);
  await page.screenshot({ path: `${out}/ask.png` });

  // 4. /sponsors and /integrations.
  await goto("/sponsors", page.locator("[data-testid=sponsor-track][data-track=livingBrain]"));
  const card = page.locator("[data-testid=sponsor-track][data-track=livingBrain]");
  await scrollTo(card, 40, 1800);
  await line("s1", "/sponsors · the Living Brain track: a working agent with Living Brain as its persistent memory");
  await show(card.locator("[data-row=lbWallet]"), 1200);
  await show(card.locator("[data-row=lbMemory]"), 1200);
  await done(1000);
  const remember = page.locator("[data-testid=recipe-step][data-step=remember]");
  await scrollTo(remember, 260, 1600);
  await line("s2", "The recipe · Remember: Living Brain → history cards at the dispute desk");
  await show(remember, 1000);
  await done(1500);
  await goto("/integrations", page.getByRole("heading", { name: /Living Brain/ }));
  const lb = page.getByRole("heading", { name: /Living Brain/ });
  await scrollTo(lb, 140, 1600);
  await line("i1", "/integrations · Living Brain: live on this server, with a daily call budget");
  await show(lb, 1500);
  await done(1500);

  // 5. How it remembers: the settled rental the memory entry points to.
  await goto(`/lease/${SETTLED}`, page.getByTestId("timeline"));
  await line("h1", "How it remembers: after every settled rental the server reads the settlement from the chain and writes one factual entry per party, keyed by wallet + transaction");
  await show(page.getByTestId("rental-banner"), 1500);
  await done(1500);
  const tl = page.getByTestId("timeline");
  await scrollTo(tl, 70, 1800);
  const settled = tl.getByText(/settled|deposit split|accepted/i).last();
  await scrollTo(settled, 300, 1400).catch(() => {});
  await line("h2", "The settled step in the timeline is the transaction behind Kenji's memory entry");
  await show(settled, 1500);
  await done(1500);
  await line("h3", "Only wallet addresses and facts from on-chain events: no names, no free text, no opinions. Deletable on request");
  await done(1000);

  // 6. Close on the dispute's history cards.
  await goto(`/lease/${DISPUTE}`, page.getByTestId("history-entry").first());
  await scrollTo(page.getByTestId("party-histories"), 70, 1800);
  await line("c1", "KeyScrow remembers, so the dispute desk doesn't have to guess.");
  await done(2500);
 }
} finally {
  marks.end = now();
  fs.writeFileSync(`${out}/marks.json`, JSON.stringify(marks, null, 1));
  console.log(JSON.stringify(marks));
  await ctx.close();
  await browser.close();
}
