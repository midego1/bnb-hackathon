import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LiveScreen } from "@/components/stage/Live";
import { getDictionary } from "@/lib/i18n/server";
import { getListing } from "@/lib/listings";
import { stageConfig } from "@/lib/server/stage/config";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary())("stage.metaTitle") };
}
// viewportFit cover: the stage's sticky presenter bar pads itself by env(safe-area-inset-bottom) (home indicator).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  await connection(); // STAGE_DEMO is read at request time
  const listing = getListing((await params).slug);
  const cfg = stageConfig(process.env);
  if (!listing) notFound();
  return <LiveScreen listing={listing} chainId={cfg?.chainId ?? 31337} enabled={!!cfg} />;
}

/** The live judge demo: the big screen, and (rewritten here, next.config.ts) the judge's phone /r/<slug>. */
export default function StagePage(props: PageProps<"/stage/[slug]">) {
  return (
    <Suspense>
      <Inner params={props.params} />
    </Suspense>
  );
}
