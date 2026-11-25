## What and why

<!-- One or two sentences: what changes, and the problem it solves. Link the issue if there is one. -->

## How it was tested

<!-- The commands you ran and their result, e.g. "forge test: 119 passed". Screenshots for UI changes (light and dark). -->

- [ ] `cd contracts && forge build && forge test`
- [ ] `pnpm -C web lint && pnpm -C web test && pnpm -C web build`
- [ ] `pnpm agent:test`
- [ ] `cd web && npx playwright test` (UI or chain changes)

## Checklist

- [ ] No keys, `.env` content or personal data in the diff (the repo is public)
- [ ] BSC testnet / local anvil only; amounts shown in baht first
- [ ] Contract changes: small and readable, a test for each new path; ABIs synced (`pnpm -C web sync:contracts`)
- [ ] Docs updated if behaviour, env vars or routes changed
