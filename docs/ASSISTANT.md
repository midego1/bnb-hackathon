# Ask AI

Ask AI is KeyScrow's in-app assistant: a floating chat (a bubble bottom right) that answers questions about rentals and makes changes for you,
as the connected wallet, through the same rental actions as the REST API and the agent's MCP / A2A tools. It never
holds a key: every change is a transaction your own wallet signs after you approve a card.

Code: `web/lib/assistant/` (engine, tools, cards, approvals, limits, demo model), `web/app/api/assistant/` (routes),
`web/components/assistant/` (bubble, chat window, cards, edge light), `web/lib/server/assistant.ts` (the web host).

**Status:** on `main` after this branch: the panel, the demo model, Claude through `@anthropic-ai/sdk`, approvals
signed by the connected wallet on anvil (31337) or BSC testnet (97), unit tests and a Playwright test with the demo
model. It opens from the **Ask AI** bubble bottom right of every app page or with Ctrl+J / Cmd+J.

## What it does

- **Open / close:** Ctrl+J (Cmd+J on a Mac), or the round **Ask AI** bubble bottom right (the only entry point). The chat
  window floats above the bubble (400 px wide, up to 640 px tall) and scales in from it; the page never reflows. On a
  phone it is a full-height sheet. On the one-screen stages (`/demo`, `/how-it-works`, `/pitch`) the bubble is small
  and tucked into the corner, clear of the stage controls; the landing page and the live judge demo (`/stage`, `/r`)
  have none. A dot on the bubble: violet while a change waits for approval, or a reply that came in while it was
  closed. Messages are chat bubbles: yours on the right, Ask AI's answers, steps, cards and approvals on the left.
- **Reads** run at once: `get_lease`, `list_leases`, `explain_status`, `quote`, `wallet_history` ("what is this
  renter's history?" on the dispute desk), and `inspect_return` (the AI return
  inspection over the photos anchored on the rental).
- **Changes** (`prepare_create_lease`, `prepare_fund`, `prepare_propose_settlement`, `prepare_accept`,
  `prepare_dispute`, `prepare_resolve`, `prepare_claim_timeout`, `prepare_release_rent`, `prepare_add_evidence`,
  `prepare_cancel`) never run on the model's say-so. The server prepares and simulates them and shows an
  **approval card**; you approve (your wallet signs) or decline.
- **open_page** moves to an allowed page: `/`, `/tenant`, `/landlord`, `/arbiter`, `/backoffice`, `/shareholders`,
  `/how-it-works`, `/developers`, `/integrations`, `/demo`, or `/lease/<address>`.
- **Cards** are built by the server from the action's own result, never from the model's text: a rental (status,
  owner / renter, deposit, rent and what is in escrow in baht, dollars and mUSDT, the next step and its deadline,
  links), a rental list with totals counted by code (the model gets a `TOTALS` line and is told to quote it), an
  approval (status and balances before → after, who signs, the steps), and a done card with the transaction links
  (BscScan on 97, the hash on a local chain) and "N changes applied".
- **Status line and edge light:** blue and travelling while it reads or thinks, amber and faster while a change is
  signed and confirmed, violet and steady while a change waits for you (the page dims a little but stays usable, and
  the tab title starts with "(Approval needed)"). With reduced motion nothing moves; the colours stay. Colours and
  timings are the `--assistant-*` tokens in `web/app/globals.css`, light and dark.
- **Follow along** (the eye button, on by default, kept in localStorage): after a change or `open_page` the page goes
  there, never while you type in a field outside the panel or a dialog is open. Off, a "go there" link appears.
- **Suggestions** per page (a rental: "Where is my deposit?", "What happens next?"; the renter page: "Find my rental";
  the owner page: "Create a rental"; the dispute desk: "What needs my decision?"; `/demo` and `/how-it-works`:
  "Explain KeyScrow simply") and **slash commands** `/status`, `/explain`, `/next`, `/new`.
- **Stop** ends the run at once (and expires a change that waits); **New chat** starts over and keeps the old chat in
  the history.
- **History** (the clock button): earlier chats, newest first, with search on their titles. A title is the first
  message (cut at 80 characters) until you rename it. Opening one shows it read-only with its steps and cards as they
  were; **Continue this chat** makes it the open chat again; **Delete** asks for a confirmation. It lives in **this
  browser only** (localStorage, every access guarded: private mode or a full quota just keep less), one list per
  connected wallet and chain, at most 50 chats, each kept 30 days after its last use; it is never sent to the server
  and never shared. A change that waited for approval in an earlier chat shows as "Expired, not done" and can never be
  applied; continuing a chat only makes fresh approvals. After 6 hours without use the panel opens with a new chat.
- **Model** (the menu next to the title, or `/model`, `/model sonnet`, `/model haiku`): Claude Sonnet 5.5 (default) or
  Claude Haiku 5.5, per chat. Nothing else: the server allows exactly these two ids, refuses any other pick (Sonnet
  answers and the panel says so), and `ASSISTANT_MODEL` can only choose between them. With the demo model the menu
  still shows, labelled "Demo model".
- Answers render as plain Markdown: no images, HTML or diagrams; an external link always shows its full URL.

## Safety model

- **Never signs.** The server has no wallet. `from` is always the connected wallet (the model cannot choose it, nor
  the chain); the browser signs with that wallet through wagmi. On chain 97 the live demo's server signer
  (`/api/demo-testnet`) is never used by Ask AI.
- **Approval of exact steps.** The server keeps the prepared, simulated steps of a change under an id (10 minutes,
  one per chat). The browser answers approve or decline for that id only; an id that does not match is refused and
  nothing runs; a new message, Stop or New chat expires it, and the model is told it was not done. After you sign,
  the server checks every reported transaction on chain (sent by the approved wallet, to the approved contract, with
  exactly the approved calldata, mined successfully) before it tells the model "APPLIED". Anything else is "NOT DONE".
- **Untrusted data.** Tool results, on-chain values and the page context reach the model inside
  `<untrusted_data>` blocks whose closing tag cannot be forged from inside, with the instruction never to follow
  instructions found there. Cards and links are built by code; links are checked against the page allowlist again in
  the browser.
- **Keys.** `ANTHROPIC_API_KEY` is server env only (never `NEXT_PUBLIC_`), set in `web/.env.local` or through
  `/settings/secrets`. No key in the browser or in git.
- **Limits.** Per message: 10 model steps, 15 tool calls. Per run: 3 minutes. Per caller (wallet, else IP): 20
  requests a minute. Per server: a daily token budget (`ASSISTANT_DAILY_TOKENS`, default 1,000,000 per UTC day; cache
  reads count a tenth), counted **before** each model request at an estimate and settled to the reported usage
  afterwards. It limits tokens, not money: set a spend limit in the Anthropic Console as well.

## Demo model vs Claude

- **Demo model** (no `ANTHROPIC_API_KEY`, or `ASSISTANT_MOCK=1`): a deterministic script (`lib/assistant/mock.ts`)
  that handles the demo prompts by calling the same tools through the same engine, approvals and cards: "Where is my
  deposit?", "What should I do next?", "Explain this rental", "Create a rental for 3,400 baht a month with a 6,800
  deposit for 0x…", "Propose the AI split", "Open a dispute", "Go to the dispute desk", "Find my rental", "What needs
  my decision?", "Explain KeyScrow simply". Offline, free; the panel shows a **Demo model** badge. All tests use it.
- **Claude** (with a key): `claude-sonnet-5-5` by default, `claude-haiku-5-5` per chat or with `ASSISTANT_MODEL`.
  Streaming, low effort, the system prompt and tool list as a cached prefix (`cache_control`). No server-side refusal
  fallback: it could answer with a model outside the two allowed ones, so a refusal just says the model declined. Needs a real key: free-form questions, other wording, and every prompt the script does not know.

## Wire format

`POST /api/assistant` `{chatId, message | resume: {approvalId, decision, txHashes?}, model?, context: {path, address, chainId}}`
answers with Server-Sent Events, one JSON event per frame: `run_started`, `status` (reading / changing / waiting /
idle), `step` (read, change, page), `card`, `approval_required` (the card and the exact unsigned steps), `text_delta`,
`navigate`, `run_finished`, `error`. `POST /api/assistant/reset` `{chatId, approvalOnly?}` expires the waiting change
(and drops the chat). `GET /api/assistant` says whether the demo model answers. Conversations and approvals live in
the shared state (`lib/server/state`: memory under Node, the Durable Object on Workers) for 6 hours.
`inspect_return` calls this app's own `POST /api/settlement`; on Workers through the `WORKER_SELF_REFERENCE` service
binding (`web/wrangler.jsonc`), since a plain fetch to the Worker's own host is not allowed there.

## Environment

| Name | Where | Default |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | server env (`web/.env.local`, `/settings/secrets`) | unset: demo model |
| `ASSISTANT_MODEL` | server env | `claude-sonnet-5-5`; only `claude-haiku-5-5` is the other choice |
| `ASSISTANT_DAILY_TOKENS` | server env | `1000000` |
| `ASSISTANT_MOCK` | server env | unset; `1` forces the demo model |

## Tests

`pnpm -C web test` (`tests/assistant.test.ts`: event encoder, approval store, card totals, limits, demo-model
scripts, untrusted marking, the path allowlist, the model allowlist, the history store, the engine offline) and `pnpm -C web test:e2e`
(`e2e/assistant.spec.ts`: Ctrl+J, a rental card, create → approve → dev wallet signs on the e2e anvil → done card and
follow along, decline, Stop, edge-light states, the sidebar row, the model picker, history open / rename / continue /
delete, light and dark screenshots; `e2e/demo-viewport.spec.ts` with the panel
open). Screenshots go to `ASSISTANT_SHOTS` (default `web/test-results/screenshots/ask-ai`).
