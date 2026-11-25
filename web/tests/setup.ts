// Force mock mode regardless of the developer's shell: no real LLM, price or storage calls in tests.
for (const k of [
  "ANTHROPIC_API_KEY",
  "VISION_LLM_PROVIDER",
  "VISION_LLM_MODEL",
  "CMC_API_KEY",
  "CMC_PRO_API_KEY",
  "ATLAS_RPC_URL",
  "ATLAS_FEED_USDT_USD",
  "ATLAS_FEED_BNB_USD",
  "ATLAS_FEED_USD_THB",
  "GREENFIELD_RPC_URL",
  "GREENFIELD_CHAIN_ID",
  "GREENFIELD_BUCKET",
  "GREENFIELD_PRIVATE_KEY",
]) {
  delete process.env[k];
}

// Fail loudly if anything tries the network.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`network access attempted in tests: ${String(input)}`);
}) as typeof fetch;
