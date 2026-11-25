/** Sample MCP client: list the tools and run inspect_move_out on the demo request. `pnpm agent:call:mcp` */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AGENT_URL, SAMPLE_REQUEST } from "./sample.ts";

const client = new Client({ name: "keyescrow-sample-client", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${AGENT_URL}/mcp`)));
const { tools } = await client.listTools();
console.log(`MCP ${AGENT_URL}/mcp tools: ${tools.map((t) => t.name).join(", ")}`);
const res = await client.callTool({ name: "inspect_move_out", arguments: SAMPLE_REQUEST });
const report = res.structuredContent as Record<string, unknown>;
console.log(JSON.stringify(report, null, 2));
const verify = await client.callTool({ name: "verify_report", arguments: { report } });
console.log("verify_report:", JSON.stringify(verify.structuredContent));
await client.close();
if (res.isError) process.exit(1);
