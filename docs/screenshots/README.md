# Screenshots

All shots are 1470×830 (a 13–15" laptop screen), light theme, taken from the local e2e setup: a throwaway anvil
(127.0.0.1:28546) deployed and seeded with `Deploy.s.sol` + `Seed.s.sol`, the app built with
`NEXT_PUBLIC_DEV_ACCOUNTS=1` and served by `next start`, no API keys. So prices show **Demo rates**
(1 USDT = 33 THB) and the AI proposal comes from the deterministic demo inspector. The live testnet site looks the
same, minus the yellow *Demo accounts* bar.

Regenerate them with [capture.spec.ts](capture.spec.ts) (it lives here, outside `web/e2e/`, so CI never runs it):

```bash
cp docs/screenshots/capture.spec.ts web/e2e/docs-screenshots.spec.ts
cd web && npx playwright test docs-screenshots --workers=1   # needs anvil on PATH (~/.foundry/bin)
rm e2e/docs-screenshots.spec.ts
```

| File | Route | What |
| --- | --- | --- |
| `home.png` | `/` | Landing: the pitch, *Play the demo*, how it works, the left sidebar (roles, demo, build) |
| `demo-start.png` | `/demo` | Guided demo before starting: story, speed and mode controls |
| `demo-mid-run.png` | `/demo` | Guided demo, step 7 of 10: the AI inspection's split, the actors' balances in THB, the live rental page, every tx hash |
| `demo-summary.png` | `/demo` | End screen: settled, final balances for renter, owner and treasury; the escrow holds ฿0 |
| `how-it-works.png` | `/how-it-works` | The ELI5 cartoon, scene 6: the robot inspector suggests a split, people decide |
| `fleet-owner.png` | `/landlord` | Fleet owner: KPIs, the fleet with live on-chain status, income (one scooter pays the Fleet Vault) |
| `shareholders.png` | `/shareholders` | Fleet Vault (`BKK-FLEET-1`): TVL, income after the 10 % operator fee, yield, your position, claim |
| `renter.png` | `/tenant` | Renter: four steps, bookable scooters with the up-front amount in THB, "no passport" |
| `lease-detail.png` | `/lease/<address>` | One rental, as the renter: rent schedule, what is in escrow, pickup photos, terms and the one-time fee |
| `dispute-desk.png` | `/arbiter` | Dispute desk: the rental that needs a ruling first, then the others |
| `developers.png` | `/developers` | The `/api/v1` actions (REST + MCP), generated from the same definitions as the API |
| `settings-secrets-*.png` | `/settings/secrets` | The local-only, write-only secrets page (see [SETUP.md](../SETUP.md)); taken separately |
