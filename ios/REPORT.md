# iOS app: report (branch `kb/ios-app`)

Native SwiftUI app in `ios/` (iOS 17+, XcodeGen, one SPM dependency). How to run: [README.md](README.md).

## What works (verified in the iOS Simulator, iPhone 17, Xcode 27.1)

MVP 1-5 and stretch 6-7 are in; stretch 8 (WalletConnect) is not.

1. **App shell.** Tabs Home / My rentals / Ask AI / Settings; the web's colour tokens in light and dark; rounded
   cards, SF Symbols; EN / 中文 switch in Settings (all ~190 strings in both languages, checked by a test);
   Dynamic Type text styles; app icon.
2. **Guest wallet.** Made on first launch (`SecRandomCopyBytes`), Keychain, this device only. Labelled "Test wallet,
   BSC testnet, no real money". Address, copy, BscScan, tBNB + mUSDT balances, *Get test money* (`/api/stage` drip),
   *Make a new test wallet*.
3. **Browse.** Mystery Box from `/api/stage/mystery-box` ("Live on stage") and the scooters from `/api/fleet`
   ("Demo listing"). Bundled fallback list when offline. Detail page: price per day, deposit, "deposit protected by
   escrow" and why.
4. **Rent it, for real on BSC testnet.** Test money → offer → `prepare_fund` → photos → `prepare_add_evidence` → AI
   inspection (`/api/settlement`) → `prepare_propose_settlement` → accept → settled. Every unsigned step is signed on
   the phone and sent over RPC, the app waits for the receipt and lists the BscScan link.
   **Verified end to end by the `KeyEscrowE2E` UI test (passed, 80 s):** escrow
   [`0x758fda4c…4dEd`](https://testnet.bscscan.com/address/0x758fda4c2c5C1A121106ce91B15348E2a2b84dEd):
   LeaseCreated [`0x949d0c…ee25`](https://testnet.bscscan.com/tx/0x949d0ccfbd15614b5d39a52c725e0c10abb494bbbca043cf8a04d1f17087ee25),
   Funded [`0x4f43a2…a7a8`](https://testnet.bscscan.com/tx/0x4f43a2679272678c953eca952478b117cf95cd41e7406e045d943e98db79a7a8),
   pickup photo [`0xcf8e30…bd85`](https://testnet.bscscan.com/tx/0xcf8e30a9572e40e903f8fed3d16c732627b4079d4e9ad7aed44f3427cbb0bd85),
   return photo [`0x9549ac…ae63`](https://testnet.bscscan.com/tx/0x9549ac5567b0390428da1b189ddf90f554d7edea70a08f8cc83b8bc9ca0dae63),
   proposal [`0x16c286…5048`](https://testnet.bscscan.com/tx/0x16c2868083d7c121335be6bbd98889d66fdf362b830fac11a6b341cba4985048),
   settled [`0xb3d492…da64`](https://testnet.bscscan.com/tx/0xb3d492c143c0aa250584952b984cc2aaae1c9f3be841c6c144dac6cc70b5da64)
   (฿9,000 paid in; ฿3,360 to the owner, ฿5,340 back to the renter, ฿300 fee).
   Re-run after the review fixes, with the calldata policy enforced: a second rental
   [`0xEC84093A…CCa3`](https://testnet.bscscan.com/address/0xEC84093A157192E4A31f0fc31B5edE806a97CCa3) settled
   (this one also minted mUSDT from the faucet).
5. **My rentals.** `list_leases` for the guest wallet; rental page with status banner, money strip (renter paid / in
   escrow / owner got / back to renter, baht + mUSDT), period strip, `explain_status`, timeline from
   `/api/chain/index` with BscScan links; pull to refresh; *Continue this rental* back into the flow.
6. **Camera.** Live camera only (no photo library), JPEG → SHA-256 → `POST /api/evidence` → hash on-chain. The
   Simulator has no camera, so it offers a generated, time-stamped "sample photo" instead (that is what the E2E used).
7. **Ask AI.** Chat bubbles over `POST /api/assistant` (SSE), suggestions, steps, cards, approval cards. *Approve and
   sign* signs the server's exact steps with the guest wallet and resumes with the hashes. **Verified by
   `AskAIE2ETests` (passed):** "Create a rental …" → approval card → signed on the phone → escrow
   [`0x11125062…7171`](https://testnet.bscscan.com/address/0x111250620c0DA4b35655584f5E066e75799C7171) created.

## Design pass (26 Nov)

A visual redesign on top of the working app: the flow, the signing and the API calls are the same.

- **Home.** A full-bleed photo of a Thai street at night with a real "motorcycle for rent" sign, the promise
  written over it behind a night scrim, the wallet as a glass chip. The status bar steps aside while the photo is
  under it (the photo is night in both themes, the clock would be dark on dark) and comes back with the page. Then
  a row of destinations (a photo tile each: Bangkok, Chiang Mai, Pai, Phuket) that filters the list, and
  Airbnb-style cards: square photo, name, price per day, place, "deposit protected by escrow", the deposit, and a
  *Live on stage* (breathing dot) or *Demo listing* badge.
- **Listing.** A big photo header that stretches on pull, the photo's author and licence under the title, rent and
  deposit as two tiles, the escrow promise as a card, a sticky bar with the price and *Rent it*.
- **Rent flow.** A seven-step stepper with names (Money, Pay, Pickup, Return, AI check, Accept, Settled): done steps
  are ticked, the current one is amber. One card per step with an icon; the pay step is a small receipt with a
  total; three photo slots with the ends of each SHA-256; the AI split as a bar plus rows; the transactions on a
  paper receipt (numbered, sawtooth edge, BscScan links). Settled: a tick that draws itself, "Your ฿… are back",
  how the escrow paid out (back to you / to the owner / fee). Haptics on each step, on success and on an error.
- **My rentals and the rental page.** The listing's photo and name where this phone made the rental; status as an
  icon and a word; money tiles and a split bar; the timeline on a rail with an icon per event.
- **Ask AI, Settings, wallet.** Same surfaces and type scale; the wallet is a balance card on night indigo;
  Settings > About has **Photo credits**.
- **System.** One type scale (`Font.KE`, rounded for headings and amounts), 4-pt spacing, soft shadows in light and
  hairlines in dark, amber only for emphasis. Checked in light and dark, EN and 中文, and at the
  *accessibility-large* text size (cards, the sticky bar and the price tiles restack; the stepper names give way to
  "Step 3 of 7 · Pickup"). Reduce Motion stops the tick, the live dot and the press dip. An iPad shows the phone
  layout in a centred column.

**Photos.** Eleven real photos from Wikimedia Commons (CC0, CC BY, CC BY-SA; each licence read from the file's own
page), about 2 MB, bundled and mapped by listing id; the bundled photos are never fetched at runtime.
[CREDITS.md](CREDITS.md) and the in-app credits list title, author, licence, source and changes. Honest labels: the
Honda Click photo is an earlier Click (2007), the Scoopy is a Scoopy 110 from Bali, the Fino's page states neither
place nor model year, the box is not the stage box, the shops in the street photo are not connected to KeyEscrow
(their phone numbers and a T-shirt print are blurred).

**Two changes that are not styling** (both because KeyEscrow's chain index is behind since 10:07 and was slow at
times: one request took 16 s at about 11:15; see the notes for the coordinator):

1. `RentFlowModel.refresh()` no longer waits for the chain index. The step always came from the escrow
   (`get_lease`); now the index is read on the side, one request at a time, so a step shows as soon as the
   transaction is mined instead of one index request later. The rent-flow E2E takes 73 to 85 s.
2. When the index has no `Settled` event, the payout is read from the receipt of the settling transaction the phone
   sent (`RentalStory.settledFlow`, unit-tested), so the settled card and the rental page show the real amounts.
   Where the app cannot know (a rental settled elsewhere, index behind) it shows "–" and says the history is
   incomplete, instead of ฿0.

**Verified** with the new UI, live on BSC testnet (Simulator wallet `0xb32B…e49A`): six escrows, each taken from
the offer to settled by the E2E test:

| Scooter | Escrow | Settled by | Paid in → back to renter / owner / fee (mUSDT) |
| --- | --- | --- | --- |
| Honda Click 125i | [`0x57291B20…1C69`](https://testnet.bscscan.com/address/0x57291B20DEedeAC3d94aCc572499d45361431C69) | [`0x3ca5d5c0…dd51e`](https://testnet.bscscan.com/tx/0x3ca5d5c0c2343ab86d3bed6e5f788413a35e883838482b369ba70fa61b4dd51e) | |
| Yamaha NMAX 155 | [`0x7c023e1A…b473`](https://testnet.bscscan.com/address/0x7c023e1A0C3955F30E28C4C47e4dA45D1ec9b473) | [`0xb8d59af4…9c61`](https://testnet.bscscan.com/tx/0xb8d59af4338bf9bbe5ff0d4d4f3300ed8c8cc03defd538a26c61734f6d7e9c61) | |
| Honda PCX 160 | [`0x0d4637F1…6c6E`](https://testnet.bscscan.com/address/0x0d4637F13a3735C14F8326c479F7cd3b49696c6E) | [`0x84a426d9…a128`](https://testnet.bscscan.com/tx/0x84a426d9b6cc5a2d9d49edd19fdf8e4e05d6b0624b8fdacb5c8949c8aad6a128) | 436.36 → 258.91 / 162.905 / 14.545 |
| Yamaha Fino 125 | [`0xC16fB878…78aE`](https://testnet.bscscan.com/address/0xC16fB8789a5622eedB66238E09e8b9B0D34778aE) | [`0x9dd8deeb…abff`](https://testnet.bscscan.com/tx/0x9dd8deeb6df40615e432e4b3608d1c79356f7048e86c91ee53af612b2d4eabff) | |
| Honda Scoopy-i (in the screenshots) | [`0x0389ED3e…fe87`](https://testnet.bscscan.com/address/0x0389ED3e927165653ea482931C0eD17f3BD2fe87) | [`0xd1ea3bc4…1e3f`](https://testnet.bscscan.com/tx/0xd1ea3bc44fde40db74322c11c894d3ded3cc59222ef570341794e750e76f1e3f) | 264.73 → 161.49 / 94.416 / 8.824 |
| Honda Click 125i, rented again (last run, final code) | [`0x13431c31…1511`](https://testnet.bscscan.com/address/0x13431c31715794c7C5fd30313a446b67996C1511) | [`0xa5b9322e…f89c`](https://testnet.bscscan.com/tx/0xa5b9322e1b252d7595b5715e9aded9fa572d855584a8bedb044609b96d6cf89c) | 299.99 → 199.99 / 90.00 / 10.00 |

The amounts are read from each settling transaction's `Settled` event. The last two rows were the whole
`KeyEscrowE2E` scheme in one go, both tests green: the Scoopy-i run (Ask AI approval signed on the phone 21 s, rent
flow 81 s), and the last Click run (22 s and 85 s) on the final code, which includes the photo-compression commit
`26fac4a` that landed during this pass. That last run began on an already settled scooter: the test tapped *Rent it
again* and did a whole new rental.

Not every run was green. None of the failures was a fault of the redesign, and each made a test sturdier:

- The first Ask AI run failed: the server now answers with a real model that takes seconds, and the test tapped
  *Send* while it was still disabled. The test waits for the button now (and the app keeps what was typed while
  the assistant is busy, instead of clearing it).
- One run failed in both tests while the KeyEscrow server could not reach its chain node (HTTP 502, "Could not
  reach the blockchain node. Try again in a moment."). The Fino's offer had been created; the next run carried the
  same rental on to settled. The rent test now taps the step again on exactly that message (up to three times).
- One Ask AI run failed because the real model asked for the rental's term instead of preparing it. The request in
  the test now states everything, and the test answers once if the model still asks.

**Not done in this pass:** no parallax beyond the stretch on pull; no custom font (the web's Kanit is not bundled,
headings use SF Rounded); the Mystery Box flow was again not run end to end (it was rented by someone else and
presenter-locked all day); the step cards were checked live in light + English only (dark and 中文 were checked on
every screen that opens without sending a transaction).

## What is demo or stubbed

- **Demo scooters' owner** is a second local test key ("demo shop wallet") that signs `createLease` and `accept`,
  funded with 0.0004 tBNB by the guest wallet. Clearly labelled in the listing, the flow and Settings.
- **Mystery Box**: the same code path, but the server's stage owner creates the offer and the presenter accepts on the
  big screen. I tested its drip; I did **not** run `lease`/`fund` on the stage item, because someone else had it
  rented (Active) while I worked and a test rental would block the live stage until the presenter resets it.
  Worth one rehearsal on a phone before the pitch.
- The live server runs the **demo inspector** and **mock prices** (33 THB/USDT); the app labels each. Ask AI ran
  the server's demo model in the morning of 26 Nov and a real model later that day (`mock: false`); the app shows a
  *Demo model* pill whenever the server says it is the demo one.
- The listing photos are illustrations, not the scooters themselves (see CREDITS.md).
- Photos carry a timestamp (Simulator sample) but **no location** stamp, and there is no guided five-angle capture or
  blurry-photo rejection (1 to 3 photos, as in the web `/r` flow).
- **WalletConnect** (stretch 8): not done. No dispute / claim-timeout buttons in the app (Ask AI can prepare them).
- Ask AI history is in memory only (one chat; *New chat* starts over).

## Tests

```
xcodebuild -scheme KeyEscrow    -destination 'platform=iOS Simulator,name=iPhone 17' test   # 38 unit tests, offline: passed
xcodebuild -scheme KeyEscrowE2E -destination 'platform=iOS Simulator,name=iPhone 17' test   # 2 live tests on BSC testnet: passed
```

- `SignerTests` (9): Keccak-256, EIP-55, RLP, BigUInt, address from key, two signed EIP-155 transactions and faucet
  calldata equal to viem 2.58.6 output byte for byte, refusal of chains 1, 56, 5611, 31337.
- `DecodingTests` (10): fixtures from the live endpoints (get_lease, list_leases, explain_status, prepare_fund,
  stage with the `{"$n"}` bigint codec, chain index + money flow balance, fleet, price, settlement, receipt), and
  the settled payout decoded from a receipt.
- `PhotoTests` (6): every credited photo is in the bundle, every photo in use has a credit, licences are from the
  allowed list with Commons sources, every catalogue listing maps to a photo, destinations match the locations, and
  the asset folder, the list in code and CREDITS.md name the same photos with the same credit.
- `CapturedPhotoTests` (4): a full-size noise photo ends under the 200,000-byte upload target, resizing is in
  pixels, the Simulator sample fits, the "too large" message is not empty.
- `PolicyTests` (4): approve only to an escrow and capped, the real `prepare_fund` steps pass, `transfer` /
  `transferFrom` / foreign contracts / non-actions refused, faucet only to self, factory only `createLease`.
- `MoneyTests` (5): mUSDT 6 decimals, whole baht, THB → units same as the server's `thbToUnits`, tBNB, every string
  has Chinese.

## Review

An independent review of the signing code (before the second push) found that only the target address was checked,
and that "is this an escrow" was asked of the same API that prepared the steps. Fixed: `TxPolicy` checks the calldata
(selectors and arguments) and `EscrowFactory.isLease` on-chain; the proposal must match the inspection; lost send
answers are looked up by hash; a pending shop offer is resumed, not duplicated; a partly sent Ask AI approval reports
its hashes; only one approval signs at a time; a Keychain read error never replaces the key; number conversions from
the network are range-checked.

An independent review of the design-pass commit (26 Nov) found no blocker: signing, policy, wallet and network code
untouched, all identifiers and strings in place. It found two display bugs in the new "unknown, not zero" logic, both
fixed: after *Rent it again* a refresh still in flight could bring the previous rental's payout back (the payout is
now kept with its escrow and stale answers are dropped), and with a partly filled index the rental page could say
"Renter paid ฿0" (paid-in now comes from the escrow's own terms when the index has no `Funded` event, and the page
says the history is incomplete). The smaller findings are fixed too: a 32 pt tap target, text that clipped at the
largest sizes, the rental page waiting for the index, a status bar that could shift the page on devices without a
sensor housing, a location in a photo note that its Commons page does not state, and a credits test that now really
compares the asset folder, the list in code and CREDITS.md.

## Notes for the coordinator

- **Server issue seen at about 10:07 Bangkok time on 26 Nov:** `GET /api/chain/index?chainId=97` stopped refreshing
  and answered with `stale: {error: "Invalid parameters were provided to the RPC method."}`, for every caller, so new
  events stop appearing on the web timelines and the stage feed too. Probably the RPC refusing an `eth_getLogs` range.
  The app no longer depends on it to move forward (it reads the escrow's own pickup/return hashes), but timelines in
  the app and on the web lag until it recovers. Worth checking before the pitch.

- **Still so at 12:22 on 26 Nov:** the index's last update is 10:06:53 Bangkok time, and it holds no event of any
  rental made after that (all six in the table above). The app shows their payout from the settling receipt and says
  the timeline is incomplete; the web timelines and the stage feed will simply miss them until the index recovers.
- **Other things that changed on the live server during the day** (the app copes, the wording in this report
  follows): the price API went live at about 11:55 (CoinMarketCap, 34.00 THB/USDT instead of the 33.00 demo rate), so
  an escrow made at 33.00 now reads about 3 % higher in baht (a ฿9,600 deposit shows as ฿9,890), the same as on the
  web. Ask AI answers with a real model (`mock: false`) and may ask a question back instead of preparing a change.
  At about 12:00 the server could not reach its chain node for a minute or two (HTTP 502 from `prepare_fund`, and an
  assistant run that never finished).
- **Gas of the Simulator's test wallets** after these runs: guest `0xb32B…e49A` 0.00054 tBNB, demo shop
  `0x239D…1e34` 0.00033 tBNB. A whole E2E run costs about 0.0001 tBNB between them. Under 0.0003 tBNB the flow asks
  for test money, and the drip is once per address: then make a new test wallet in Settings, or top the address up
  from a BNB testnet faucet.
- No server code was changed. The stage API's origin check passes because a native app sends no `Origin` header.
- Docs conflict to know about (not changed): `docs/PRODUCT.md` / `ACCEPTANCE.md` still describe the agent wallet
  submitting the verdict on-chain with a 24 h dispute window; the deployed v2 contracts (and this app) follow
  `docs/ARCHITECTURE.md`: the inspector only drafts, a party proposes, the other accepts, timeouts protect the renter.
- `iPhone 16` is not installed with Xcode 27.1 here; use any listed iPhone Simulator.
- Each fresh guest wallet uses one stage drip (0.002 tBNB + mUSDT) from the team's funder; scooter deposits are
  minted from the MockUSDT faucet by the guest wallet itself.
- Nothing secret is committed: no keys, team ID or profiles; `KeyEscrow.xcodeproj`, `xcuserdata`, DerivedData ignored.
