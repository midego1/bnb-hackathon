import type { Server } from "node:http";
import type { Express } from "express";

/**
 * Listen on the first free port in `from`-3199 (3170-3199 is the range this repo's workers use for throwaway
 * servers). Test files that run in parallel start at different ports so they do not race for the same one.
 */
export async function listen(app: Express, from = 3170): Promise<{ url: string; close: () => Promise<void> }> {
  for (let port = from; port <= 3199; port++) {
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
