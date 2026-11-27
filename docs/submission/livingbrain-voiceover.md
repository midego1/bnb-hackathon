# Living Brain video: voice-over

`livingbrain.mp4`: 3:54, 1470x830, H.264 + AAC, voice at -16 LUFS integrated with a very quiet synthesized pad
(-32 LUFS, ducked under the voice). Recorded on 27 Nov 2026 against the live site <https://keyscrow.app> (BSC testnet,
the demo world: 3 shops, 10 renters, 15 rentals) with Playwright Chromium, light theme, English, read-only: no wallet,
no transactions, four Ask AI questions on the site's real model.

**Voice:** Piper (offline TTS, MIT) with the voice **en_GB-cori-high** (Cori, en_GB, from the rhasspy/piper-voices
model collection; see its MODEL_CARD for the dataset and licence). No human voice, no music.

**How it was made:** `node web/scripts/record-livingbrain.mjs <outDir> <durations.json>` records the main take; each
segment holds at least as long as its Piper line. The Ask AI questions 2 and 3 (`SEG=ask`) and the /integrations
section (`SEG=int`) are separate takes spliced in. The agent reads one wallet or one rental per call, so the
"retrieve" and "connect" questions are about this rental's shop (its remembered disputes, then today's claim next to
them), not per scooter or across all shops.

## Story

1. The problem: a dispute desk sees one rental at a time (`/arbiter`).
2. The open demo dispute (Kenji vs Phuket Island Rides, `/lease/0xb08291588FB1c1C6B06D577F949299bdc098E8c1`): the
   renter's and the owner's history cards, on-chain facts plus the entries remembered by Living Brain, per wallet.
3. Ask AI: "What is this renter's history?", "Has this shop disputed deposits before?", "How does this 45% claim
   compare with the shop's past claims?"
4. `/sponsors` (Living Brain track, recipe step "Remember") and `/integrations` (Living Brain: live, recent calls).
5. How it remembers: Kenji's earlier settled rental and the settlement step behind his memory entry.
6. Close: "KeyScrow remembers, so the dispute desk doesn't have to guess."

## Lines (start second in the final video, text)

```tsv
0.37	A dispute desk usually sees one rental at a time. Who is this renter? Has this scooter had this scratch before? Without memory, the desk has to guess.
11.17	This is KeyScrow's dispute desk, on BNB Chain testnet. Every rental has its own escrow contract. When the owner and the renter can't agree on the deposit, the desk decides the split.
27.34	Here is a live dispute. Kenji, a demo renter, returned a scooter to Phuket Island Rides. The shop claims forty-five percent of the deposit. The AI inspection proposed zero.
43.01	Under the case, the desk sees a history card for each party. The numbers at the top are folded from the chain: rentals, settlements, disputes, and rent paid on time.
55.30	Below them is what Living Brain remembers about this wallet: Kenji's earlier rental, settled by agreement, with the full deposit back, and its transaction.
66.61	Now the owner's card. Five rentals, three disputes. Each was opened by the renter, and each time the shop claimed far more than the AI inspection proposed.
79.33	Living Brain recalls every past outcome for this shop's wallet: two desk rulings and two clean settlements. So the desk starts this case with context, not a blank page.
91.64	Now let's ask the AI. What is this renter's history? The agent retrieves the same per-wallet memory, and answers from it.
109.22	It cites the remembered rental and the on-chain facts, so every claim can be checked.
114.53	Has this shop disputed deposits before? The agent pulls the owner's memory from Living Brain: the earlier disputes, and how the desk ruled on each one.
135.04	How does this forty-five percent claim compare with the shop's past claims? Now the agent connects today's case to the remembered ones.
148.67	The AI summarises. The dispute desk still decides.
157.21	On the sponsor tracks page, the Living Brain card: a working agent, with Living Brain as its persistent memory.
166.13	And in the recipe, the Remember step: Living Brain feeds the history cards at the dispute desk.
174.54	On Integrations, Living Brain shows as live on this server, with its daily call budget.
183.47	So how does it remember? After every settled rental, whether by agreement, by a desk ruling or by a timeout, the server reads the settlement from the chain, and writes one factual sentence per party into Living Brain, keyed by wallet and transaction.
203.36	Here is Kenji's earlier rental. The settled step in its timeline is the transaction behind the memory entry we saw on the dispute desk.
212.30	Only wallet addresses and facts from on-chain events go in. No names, no free text, and no opinions. An entry can be deleted on request.
229.02	So the next dispute starts with context. KeyScrow remembers, so the dispute desk doesn't have to guess.
```
