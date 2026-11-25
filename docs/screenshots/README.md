# Screenshots

Taken from a throwaway local anvil seeded with `pnpm chain:deploy` + `pnpm chain:seed`, the app built with
`NEXT_PUBLIC_DEV_ACCOUNTS=1` and served by `next start`, no API keys (so prices show **Demo rates** and the AI
proposal comes from the deterministic demo inspector). Desktop shots are 1280 px wide, mobile shots 390 px. The `demo-*` and `landing-play-demo` shots come from
`pnpm -C web test:e2e` (`web/e2e/guided-demo.spec.ts`).

> **Wording:** `landing.png`, `landing-mobile.png`, `landlord-mobile.png`, `tenant-fund.png`, `ai-proposal.png` and
> `moveout-proposal-landlord.png` were taken before the UI switched to the scooter-rental wording (owner, renter,
> pickup, return) and still show the old landlord/tenant labels. The others were retaken from `pnpm -C web test:e2e`.

| File | What |
| --- | --- |
| `landing-play-demo.png` | Landing page of a local dev build, with the **Play the demo** button |
| `demo-start.png` | One-click demo before starting: story, speed and mode controls, the step rail |
| `demo-mid-run.png` | One-click demo in step-by-step mode after the AI inspection: narration, inspection card, the live rental page |
| `demo-summary.png` | One-click demo end screen: settled, final balances for renter, owner and treasury in THB/USD/USDT |
| `landing.png`, `landing-mobile.png` | Landing page: pitch, how it works, the fee in one line |
| `landlord-create.png`, `landlord-mobile.png` | Owner: new-rental form with THB hints, fee note, and the owner's rentals |
| `tenant-fund.png` | Renter: fund the escrow (deposit + first month), with every disabled button explaining why |
| `lease-detail.png` | Rental page: rent schedule, return, pickup / return photo thumbnails, on-chain timeline |
| `ai-proposal.png` | AI return inspection proposal with reasons, ready to propose on-chain |
| `moveout-proposal-landlord.png` | Owner's view of the renter's proposal: accept, or wait out the reply window |
| `lease-settled.png` | Settled rental with the final split |
| `lease-mobile.png` | Settled rental at 390 px |
| `dispute-desk.png` | Dispute desk queue: disputed rentals first |
| `arbiter-resolve.png` | Dispute desk ruling form on the seeded disputed rental |
