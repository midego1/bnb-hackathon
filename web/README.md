# KeyScrow web

Next.js (App Router) + wagmi/viem + RainbowKit frontend for the KeyScrow contracts.

| Route | What |
| --- | --- |
| `/landlord` | Create a rental (renter wallet, rent, deposit, rental period, windows, arbiter = KeyScrow dispute desk by default, rental agreement PDF + pickup photos → content hashes) and list my rentals |
| `/tenant` | My rentals with the next step for each |
| `/arbiter` | Dispute desk: rentals where this wallet is arbiter, disputed ones first |
| `/lease/<escrow>` | Terms, live state, balances, rent schedule, return (AI inspection → proposal → accept), dispute + ruling, both timeout fallbacks with countdowns, event timeline, BscScan links on chain 97 |

## UI

One UI library: [shadcn/ui](https://ui.shadcn.com) (Radix primitives + Tailwind v4, the code lives in
`components/ui/*`, set up with `shadcn@4.23.0`, see `components.json`), [lucide-react](https://lucide.dev) icons, and
[Vercel AI Elements](https://elements.ai-sdk.dev) for the Ask AI chat window (`components/ai-elements/*`, from
`ai-elements@1.9.1`, trimmed: no `ai` package, streamdown, shiki or motion).

- **Colours are tokens only** (`app/globals.css`), light and dark, switched by the theme switch (`lib/theme.ts`,
  class on `<html>`). shadcn's variables (`background`, `card`, `primary`, `muted`, `accent`, `destructive`, `border`,
  `input`, `ring`, `sidebar-*` ...) are defined on our palette, so `npx shadcn@4.23.0 add <component>` fits as is.
  Status colours: `success` / `warning` / `danger` / `info` (each with `-soft`, `-fg`, `-border`); the fixed demo
  colours (`actor-*`, `highlight-*`, ...) are named tokens too. No raw palette classes (`bg-slate-*`, `text-emerald-*`).
- `components/ui.tsx` keeps the app's own primitives (`Card`, `StatusBadge`, `ActionButton`, `Field`, `Notice`,
  `Amount`, ...) on top of the shadcn components; `components/Toasts.tsx` keeps `useToasts()` and renders with sonner.
- **Worker size:** the Cloudflare web Worker must stay under 3 MiB gzip (`pnpm cf:build && pnpm cf:size`). Keep
  heavy client-only UI out of the server render: the Ask AI chat window, sonner and the confirm dialog load with
  `next/dynamic(..., { ssr: false })`, and the tooltip provider lives in the panel.

## Contracts → frontend

ABIs and addresses are generated, never hand-written:

```bash
cd contracts && forge build && cd ..
pnpm -C web sync:contracts   # contracts/out → lib/contracts/abis.generated.ts
                             # contracts/deployments/<chainId>.json (or .example.json) → lib/contracts/deployments.generated.json
```

`lib/contracts/index.ts` is the only module that knows addresses (`getDeployment(chainId)`).

## Environment (all public, non-secret)

| Var | Default | Use |
| --- | --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` | `31337` | target chain: `31337` (anvil) or `97` (BSC testnet; anvil is then not listed). Addresses come from `contracts/deployments/<id>.json` via `sync:contracts` |
| `NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS`, `NEXT_PUBLIC_MOCK_USDT_ADDRESS` | unset | optional address override for the target chain (both required) |
| `NEXT_PUBLIC_RPC_URL` (alias `NEXT_PUBLIC_ANVIL_RPC_URL`) | `http://127.0.0.1:8545` | anvil RPC the browser talks to |
| `NEXT_PUBLIC_BSC_TESTNET_RPC_URL` | viem default | BSC testnet (97) RPC |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | unset | enables RainbowKit's full wallet list; otherwise injected wallets only |
| `NEXT_PUBLIC_DEV_ACCOUNTS` | `0` | `1` = "Demo accounts" bar (owner / renter / dispute desk = anvil accounts #1–#3). Only shown on chain 31337, signs via anvil's unlocked accounts (no keys in the browser), and is compiled out of builds without the flag |

Prices come from `GET /api/price` (`lib/usePrices.ts`), evidence from `POST /api/evidence`, the AI return proposal
from `POST /api/settlement`. See `docs/API.md`.

## Tests

```bash
pnpm -C web test       # vitest (server APIs, offline)
pnpm -C web test:e2e   # Playwright browser smoke test
```

`test:e2e` starts its own anvil on 127.0.0.1:28546, deploys and seeds it with `contracts/script/Deploy.s.sol` +
`Seed.s.sol`, builds the app into `.next-e2e` with dev accounts on, serves it with `next start` on 127.0.0.1:3150,
then drives owner create → renter fund → rent release → AI proposal → owner accept through the UI. It refuses
to start if port 28546 is taken and kills only what it started. Screenshots land in `web/test-results/screenshots/`.
The web server gets every `NEXT_PUBLIC_*` (and every server-side key, blanked) explicitly from `e2e/env.ts`, so a
`web/.env.local` for your own dev server never leaks into the e2e build; global setup fails the run if the fresh
deploy does not land on those exact addresses.
