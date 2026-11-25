import { connection } from "next/server";
import { handle } from "@/lib/server/demoTestnet/http";

/** GET /api/demo-testnet: is the live BSC testnet demo on, who are its actors, is it free. 404 when switched off. */
export async function GET() {
  await connection(); // request time only, never prerendered
  return handle(undefined, (runner) => runner.status());
}
