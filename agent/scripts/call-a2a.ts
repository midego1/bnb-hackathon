/** Sample A2A client: resolve the agent card and send inspect_move_out as a data part. `pnpm agent:call:a2a` */
import { randomUUID } from "node:crypto";
import { A2AClient } from "@a2a-js/sdk/client";
import { AGENT_URL, SAMPLE_REQUEST } from "./sample.ts";

const client = await A2AClient.fromCardUrl(`${AGENT_URL}/.well-known/agent-card.json`);
const res = await client.sendMessage({
  message: {
    kind: "message",
    role: "user",
    messageId: randomUUID(),
    parts: [{ kind: "data", data: { skill: "inspect_move_out", ...SAMPLE_REQUEST } }],
  },
});
if ("error" in res) {
  console.error("A2A error:", JSON.stringify(res.error));
  process.exit(1);
}
const result = res.result;
const part = result.kind === "message" ? result.parts.find((p) => p.kind === "data") : undefined;
console.log(`A2A ${AGENT_URL}/a2a message/send -> ${result.kind}`);
console.log(JSON.stringify(part && part.kind === "data" ? part.data : result, null, 2));
