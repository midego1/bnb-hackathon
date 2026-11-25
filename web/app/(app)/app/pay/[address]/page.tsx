import { Suspense } from "react";
import { getAddress, isAddress } from "viem";
import { PayWithPromptPay } from "@/components/promptpay/PayWithPromptPay";
import { Notice } from "@/components/ui";

async function PayPageInner({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return <Notice kind="error">&ldquo;{address}&rdquo; is not a valid rental address.</Notice>;
  return <PayWithPromptPay address={getAddress(address)} />;
}

/** "Pay with PromptPay" DEMO for one rental: no real money, see components/promptpay. */
export default function PayPage(props: PageProps<"/app/pay/[address]">) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <Suspense>
        <PayPageInner params={props.params} />
      </Suspense>
    </section>
  );
}
