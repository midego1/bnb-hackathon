import type { Metadata } from "next";
import { Explainer } from "@/components/eli5/Explainer";

export const metadata: Metadata = {
  title: "How it works",
  description: "KeyEscrow explained simply: an animated story of a rental deposit in a safe with two locks. No wallet needed.",
};

/**
 * The animated "explain it like I'm 5" story. Pure front-end and fully static: no wallet, no chain, works offline.
 * `data-demo-stage` pins it to one screen on desktop like /demo (app/globals.css); below lg it stacks and scrolls.
 */
export default function HowItWorksPage() {
  return (
    <section data-demo-stage className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-4 py-4 lg:min-h-0 lg:py-3">
      <Explainer realDemo={process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1"} />
    </section>
  );
}
