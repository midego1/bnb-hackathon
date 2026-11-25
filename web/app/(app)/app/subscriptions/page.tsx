"use client";

import { copy } from "@/components/subscriptions/copy";
import { SubscriptionsView } from "@/components/subscriptions/Subscriptions";
import { PageTitle } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";

export default function SubscriptionsPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={copy.pageTitle}>{copy.pageIntro}</PageTitle>
      <WalletGate what={copy.gate}>
        <SubscriptionsView />
      </WalletGate>
    </section>
  );
}
