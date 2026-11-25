import type { Metadata } from "next";
import { SubscriptionsView } from "@/components/subscriptions/Subscriptions";
import { PageTitle } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();
  return { title: t("subs.pageTitle") };
}

export default async function SubscriptionsPage() {
  const t = await getDictionary();
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={t.h("subs.title")}>{t("subs.pageIntro")}</PageTitle>
      <WalletGate what={t("subs.gate")}>
        <SubscriptionsView />
      </WalletGate>
    </section>
  );
}
