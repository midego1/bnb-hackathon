import { Suspense } from "react";
import { ComingSoon } from "@/components/ComingSoon";

async function LeaseDetail({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <ComingSoon title="Lease">
      Timeline, balances and BscScan links for escrow <code className="font-mono">{address}</code>.
    </ComingSoon>
  );
}

export default function LeasePage(props: PageProps<"/lease/[address]">) {
  return (
    <Suspense>
      <LeaseDetail params={props.params} />
    </Suspense>
  );
}
