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

## What is demo or stubbed

- **Demo scooters' owner** is a second local test key ("demo shop wallet") that signs `createLease` and `accept`,
  funded with 0.0004 tBNB by the guest wallet. Clearly labelled in the listing, the flow and Settings.
- **Mystery Box**: the same code path, but the server's stage owner creates the offer and the presenter accepts on the
  big screen. I tested its drip; I did **not** run `lease`/`fund` on the stage item, because someone else had it
  rented (Active) while I worked and a test rental would block the live stage until the presenter resets it.
  Worth one rehearsal on a phone before the pitch.
- The live server runs the **demo inspector** and the **demo Ask AI model** and **mock prices** (33 THB/USDT); the
  app labels each.
- Photos carry a timestamp (Simulator sample) but **no location** stamp, and there is no guided five-angle capture or
  blurry-photo rejection (1 to 3 photos, as in the web `/r` flow).
- **WalletConnect** (stretch 8): not done. No dispute / claim-timeout buttons in the app (Ask AI can prepare them).
- Ask AI history is in memory only (one chat; *New chat* starts over).

## Tests

```
xcodebuild -scheme KeyEscrow    -destination 'platform=iOS Simulator,name=iPhone 17' test   # 27 unit tests, offline: passed
xcodebuild -scheme KeyEscrowE2E -destination 'platform=iOS Simulator,name=iPhone 17' test   # 2 live tests on BSC testnet: passed
```

- `SignerTests` (9): Keccak-256, EIP-55, RLP, BigUInt, address from key, two signed EIP-155 transactions and faucet
  calldata equal to viem 2.58.6 output byte for byte, refusal of chains 1, 56, 5611, 31337.
- `DecodingTests` (9): fixtures from the live endpoints (get_lease, list_leases, explain_status, prepare_fund,
  stage with the `{"$n"}` bigint codec, chain index + money flow balance, fleet, price, settlement, receipt).
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

## Notes for the coordinator

- **Server issue seen at about 10:07 Bangkok time on 26 Nov:** `GET /api/chain/index?chainId=97` stopped refreshing
  and answered with `stale: {error: "Invalid parameters were provided to the RPC method."}`, for every caller, so new
  events stop appearing on the web timelines and the stage feed too. Probably the RPC refusing an `eth_getLogs` range.
  The app no longer depends on it to move forward (it reads the escrow's own pickup/return hashes), but timelines in
  the app and on the web lag until it recovers. Worth checking before the pitch.

- No server code was changed. The stage API's origin check passes because a native app sends no `Origin` header.
- Docs conflict to know about (not changed): `docs/PRODUCT.md` / `ACCEPTANCE.md` still describe the agent wallet
  submitting the verdict on-chain with a 24 h dispute window; the deployed v2 contracts (and this app) follow
  `docs/ARCHITECTURE.md`: the inspector only drafts, a party proposes, the other accepts, timeouts protect the renter.
- `iPhone 16` is not installed with Xcode 27.1 here; use any listed iPhone Simulator.
- Each fresh guest wallet uses one stage drip (0.002 tBNB + mUSDT) from the team's funder; scooter deposits are
  minted from the MockUSDT faucet by the guest wallet itself.
- Nothing secret is committed: no keys, team ID or profiles; `KeyEscrow.xcodeproj`, `xcuserdata`, DerivedData ignored.
