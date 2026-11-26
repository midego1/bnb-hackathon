"use client";

import { Providers } from "@/app/(app)/providers";
import type { Listing } from "@/lib/listings";
import { JudgeFlow } from "./JudgeFlow";

/** The phone flow inside the app's wallet providers (RainbowKit for "Connect MetaMask"); no Ask AI in /duo's phone. */
export default function JudgeTree(p: { listing: Listing; chainId: number; duo?: boolean }) {
  return (
    <Providers assistant={!p.duo}>
      <JudgeFlow {...p} />
    </Providers>
  );
}
