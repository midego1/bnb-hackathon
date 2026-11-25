import type { Server } from "node:http";
import type { Express } from "express";

/** Listen on the first free port in 3170-3199 (the range this repo's workers use for throwaway servers). */
export async function listen(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  for (let port = 3170; port <= 3199; port++) {
    const server = await new Promise<Server | null>((resolve) => {
      const s = app.listen(port, "127.0.0.1");
      s.once("listening", () => resolve(s));
      s.once("error", () => resolve(null));
    });
    if (server) {
      return {
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve) => server.close(() => resolve())),
      };
    }
  }
  throw new Error("no free port in 3170-3199");
}
