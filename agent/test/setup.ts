for (const k of [
  "ANTHROPIC_API_KEY",
  "VISION_LLM_PROVIDER",
  "VISION_LLM_MODEL",
  "INSPECTOR_PRIVATE_KEY",
  "INSPECTOR_AGENT_ID",
  "INSPECTOR_AGENT_REGISTRY",
  "INSPECTOR_DEPLOYMENT",
  "INSPECTOR_CHAIN_ID",
  "AGENT_PUBLIC_URL",
  "GREENFIELD_RPC_URL",
  "GREENFIELD_PRIVATE_KEY",
]) {
  delete process.env[k];
}
// Point the default deployment lookup at a file that does not exist, so a real agent/deployments/97.json is ignored.
process.env.INSPECTOR_DEPLOYMENT = "/nonexistent/keyescrow-agent-test/97.json";

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== "127.0.0.1") throw new Error(`network access attempted in tests: ${url.href}`);
  return realFetch(input, init);
}) as typeof fetch;
