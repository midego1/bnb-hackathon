import { connection } from "next/server";
import { handleReset } from "@/lib/assistant/http";
import { assistantStore } from "@/lib/server/assistant";

/** New chat (or Stop while a change waits): expire the waiting approval and, unless approvalOnly, drop the chat. */
export async function POST(req: Request) {
  await connection();
  return handleReset(req, { store: assistantStore() });
}
