# Test fixtures

Tests never call sponsor APIs (`tests/setup.ts` makes `fetch` throw). Responses come from here.

| File | Origin |
| --- | --- |
| `cournot/resolve.recorded-2026-11-25.json` | Recorded: one real `POST https://interface.cournot.ai/intelligence/v1/resolve` (free market lookup, no quota) on 2026-11-25 12:44 UTC. |
| `cournot/probability.shape.json` | Synthetic. Shape from the official skill's `references/response-format.md`; values are made up. Never shown in the app. |
| `cmc/quotes-usd.shape.json`, `cmc/quotes-thb.shape.json` | Synthetic. Shape of CMC `GET /v2/cryptocurrency/quotes/latest` from the CMC API docs; values are made up. |
| `atlas/pull-latest.shape.json` | Synthetic. Shape of Atlas `POST https://api.atlasoracle.io/report/v1/price/latest` (`signed: true`) from the task brief and Atlas's pull-oracle-consumer wire format; prices are BSC testnet push-feed reads of 2026-11-26. Signed by a throwaway TEST key (`_testSigner`), so the official signer check must reject it. |
