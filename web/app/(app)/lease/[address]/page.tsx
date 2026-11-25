import { Suspense } from "react";
import { getAddress, isAddress } from "viem";
import { LeaseDetail } from "@/components/lease/LeaseDetail";
import { Notice } from "@/components/ui";
import { getDictionary } from "@/lib/i18n/server";

async function LeasePageInner({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return <Notice kind="error">{(await getDictionary())("rental.page.invalid", { address })}</Notice>;
  return <LeaseDetail address={getAddress(address)} />;
}

export default function LeasePage(props: PageProps<"/lease/[address]">) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <Suspense>
        <LeasePageInner params={props.params} />
      </Suspense>
    </section>
  );
}
