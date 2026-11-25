import type { Metadata } from "next";
import { Pitch } from "@/components/pitch/Pitch";
import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();
  return { title: t("pitch.pageTitle"), description: t("pitch.description"), robots: { index: false, follow: false } };
}

/**
 * Unlisted (not in the sidebar; linked from docs/DEMO.md): our pitch as an animated storyboard, for rehearsal and as
 * the backup slide if the live demo fails. One screen like /how-it-works (`data-demo-stage`, app/globals.css).
 */
export default function PitchPage() {
  return (
    <section data-demo-stage className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-4 py-4 lg:py-3 stage:min-h-0">
      <Pitch />
    </section>
  );
}
