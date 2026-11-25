import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ListingView } from "@/components/stage/ListingView";
import { getDictionary } from "@/lib/i18n/server";
import { getListing } from "@/lib/listings";
import { stageConfig } from "@/lib/server/stage/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();
  return { title: t("listing.metaTitle") };
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  await connection(); // STAGE_DEMO is read at request time
  const listing = getListing((await params).slug);
  if (!listing) notFound();
  return <ListingView listing={listing} enabled={!!stageConfig(process.env)} />;
}

/** A physical item anyone can rent (the live judge demo's listing), in the app's sidebar shell. */
export default function ListingPage(props: PageProps<"/app/listings/[slug]">) {
  return (
    <Suspense>
      <Inner params={props.params} />
    </Suspense>
  );
}
