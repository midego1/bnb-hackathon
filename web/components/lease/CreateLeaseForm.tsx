"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getAddress, isAddress, parseEventLogs, zeroAddress, type Address, type Hex } from "viem";
import { useAccount } from "wagmi";
import { FilePicker } from "@/components/FilePicker";
import { DepositRiskForUsdt } from "@/components/risk/DepositRiskPanel";
import { ActionButton, Card, Field, inputClass, Notice, PriceSourceBadge, useMoney } from "@/components/ui";
import { escrowFactoryAbi, EvidenceKind, rentalEscrowAbi } from "@/lib/contracts";
import { devAccounts } from "@/lib/devAccounts";
import { uploadEvidence } from "@/lib/evidence";
import { parseUsdt, shortAddress } from "@/lib/format";
import { ZERO_HASH } from "@/lib/hash";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useFactorySettings } from "@/lib/hooks/useFactory";
import { useTx } from "@/lib/hooks/useTx";

export function CreateLeaseForm() {
  const router = useRouter();
  const { address: me } = useAccount();
  const { chainId, deployment } = useDeployment();
  const { send, pending } = useTx();

  const [tenant, setTenant] = useState("");
  const [rent, setRent] = useState("500");
  const [deposit, setDeposit] = useState("1000");
  const [term, setTerm] = useState("12");
  const [windowDays, setWindowDays] = useState("7");
  const [arbiterDays, setArbiterDays] = useState("14");
  const [useDesk, setUseDesk] = useState(true);
  const [arbiter, setArbiter] = useState("");
  const [leaseDoc, setLeaseDoc] = useState<File[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const { data: settings } = useFactorySettings();
  const money = useMoney();
  const feeBps = settings?.feeBps;
  // The factory's defaultArbiter is the KeyEscrow dispute desk; passing address(0) selects it on-chain.
  const desk = settings ? settings.defaultArbiter : deployment?.disputeDesk;
  const rentAmount = parseUsdt(rent);
  const depositAmount = parseUsdt(deposit);
  const termMonths = Number(term);
  const days = Number(windowDays);
  const arbDays = Number(arbiterDays);
  const arbiterAddr = useDesk ? desk : isAddress(arbiter) ? getAddress(arbiter) : undefined;

  const errors = {
    tenant: !tenant ? undefined : !isAddress(tenant) ? "Not a valid address." : me && tenant.toLowerCase() === me.toLowerCase() ? "You can't rent to yourself." : undefined,
    rent: rentAmount === undefined || rentAmount === BigInt(0) ? "Enter the monthly rent." : undefined,
    deposit: depositAmount === undefined || depositAmount === BigInt(0) ? "Enter the deposit." : undefined,
    term: !Number.isInteger(termMonths) || termMonths < 1 || termMonths > 60 ? "1 to 60 months." : undefined,
    window: !Number.isInteger(days) || days < 1 || days > 60 ? "1 to 60 days." : undefined,
    arbiterWindow: !Number.isInteger(arbDays) || arbDays < 1 || arbDays > 90 ? "1 to 90 days." : undefined,
    arbiter: useDesk
      ? !desk
        ? "No KeyEscrow dispute desk on this network; enter your own reviewer's wallet."
        : undefined
      : !arbiter
        ? undefined
        : !isAddress(arbiter)
          ? "Not a valid address."
          : undefined,
  };
  const distinct =
    !arbiterAddr || !me || !isAddress(tenant)
      ? true
      : new Set([arbiterAddr.toLowerCase(), me.toLowerCase(), tenant.toLowerCase()]).size === 3;

  const blocker =
    !deployment ? "KeyEscrow is not deployed on this network. Switch your wallet's network." :
    !tenant ? "Enter the renter's wallet address." :
    errors.tenant || errors.rent || errors.deposit || errors.term || errors.window || errors.arbiterWindow || errors.arbiter ||
    (!arbiterAddr ? "Enter the dispute desk's wallet address." : undefined) ||
    (!distinct ? "Owner, renter and dispute desk must be three different wallets." : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (blocker || !deployment || !arbiterAddr) return;
    setWarning(null);

    let leaseHash: Hex = ZERO_HASH;
    let photoHashes: Hex[] = [];
    if (leaseDoc.length || photos.length) {
      setStatus("Uploading documents…");
      const docs = await uploadEvidence([...leaseDoc, ...photos]);
      if (docs.warning) setWarning(docs.warning);
      if (leaseDoc.length) leaseHash = docs.items[0].hash;
      photoHashes = docs.items.slice(leaseDoc.length).map((i) => i.hash);
    }

    setStatus("Creating rental…");
    const receipt = await send("Create rental", {
      address: deployment.escrowFactory,
      abi: escrowFactoryAbi,
      functionName: "createLease",
      args: [
        {
          tenant: getAddress(tenant),
          arbiter: useDesk ? zeroAddress : arbiterAddr,
          rentAmount: rentAmount!,
          depositAmount: depositAmount!,
          termMonths,
          responseWindow: days * 86400,
          arbiterWindow: arbDays * 86400,
          leaseHash,
        },
      ],
    });
    if (!receipt) return setStatus(null);
    const [created] = parseEventLogs({ abi: escrowFactoryAbi, eventName: "LeaseCreated", logs: receipt.logs });
    const escrow = created?.args.escrow as Address | undefined;
    if (!escrow) return setStatus(null);

    for (const [i, hash] of photoHashes.entries()) {
      setStatus(`Anchoring pickup photo ${i + 1} of ${photoHashes.length}…`);
      await send(`Anchor pickup photo ${i + 1}/${photoHashes.length}`, {
        address: escrow,
        abi: rentalEscrowAbi,
        functionName: "addEvidence",
        args: [EvidenceKind.CheckIn, hash],
      });
    }
    setStatus(null);
    router.push(`/lease/${escrow}`);
  }

  const showDevTenant = process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" && chainId === 31337;

  return (
    <Card title="New rental" aside={<PriceSourceBadge />}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" data-testid="create-lease-form">
        <div className="sm:col-span-2">
          <Field
            label="Renter wallet"
            error={errors.tenant}
            hint={
              showDevTenant ? (
                <button type="button" className="underline" onClick={() => setTenant(devAccounts.tenant)}>
                  Use anvil renter {shortAddress(devAccounts.tenant)}
                </button>
              ) : (
                "The renter funds the escrow from this address."
              )
            }
          >
            <input name="tenant" className={inputClass} placeholder="0x…" value={tenant} onChange={(e) => setTenant(e.target.value.trim())} />
          </Field>
        </div>
        <Field label="Monthly rent (USDT)" error={errors.rent} hint={rentAmount ? <>≈ {money(rentAmount)}</> : "Paid in USDT; shown in baht and dollars."}>
          <input name="rent" inputMode="decimal" className={inputClass} value={rent} onChange={(e) => setRent(e.target.value)} />
        </Field>
        <Field
          label="Deposit (USDT)"
          error={errors.deposit}
          hint={depositAmount ? <>≈ {money(depositAmount)}{rentAmount ? ` · ${(Number(depositAmount) / Number(rentAmount)).toFixed(1).replace(/\.0$/, "")} months of rent` : ""}</> : undefined}
        >
          <input name="deposit" inputMode="decimal" className={inputClass} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </Field>
        <Field label="Rental period (months)" error={errors.term}>
          <input name="term" type="number" min={1} max={60} className={inputClass} value={term} onChange={(e) => setTerm(e.target.value)} />
        </Field>
        <div className="sm:col-span-2"><DepositRiskForUsdt deposit={depositAmount} rentalDays={termMonths * 30} /></div>
        <Field label="Your reply window (days)" error={errors.window} hint="How long you have to answer the renter's return proposal. If you stay silent, the full deposit goes back to the renter.">
          <input name="window" type="number" min={1} max={60} className={inputClass} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className="text-sm font-medium">Dispute desk</span>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={useDesk} onChange={(e) => setUseDesk(e.target.checked)} />
            <span>
              Use the KeyEscrow dispute desk {desk && <span className="font-mono text-xs text-subtle">({shortAddress(desk)})</span>}
              <span className="block text-xs text-subtle">
                A neutral reviewer that only steps in if you and the renter disagree on the deposit. Untick to name your own; the renter sees
                it before funding.
              </span>
            </span>
          </label>
          <Field label="Dispute desk deadline (days)" error={errors.arbiterWindow} hint="If the dispute desk has not ruled within this time, the full deposit can go back to the renter.">
            <input name="arbiterWindow" type="number" min={1} max={90} className={inputClass} value={arbiterDays} onChange={(e) => setArbiterDays(e.target.value)} />
          </Field>
          {!useDesk && <input name="arbiter" className={inputClass} placeholder="Your reviewer's wallet 0x…" aria-label="Dispute desk wallet" value={arbiter} onChange={(e) => setArbiter(e.target.value.trim())} />}
          {errors.arbiter && <span className="text-xs text-danger">{errors.arbiter}</span>}
        </div>
        <FilePicker label="Rental agreement (PDF)" accept="application/pdf" files={leaseDoc} onChange={setLeaseDoc} hint="Optional: scooter model, plate and included helmets. The file is stored off-chain; its fingerprint (SHA-256) goes on-chain." testId="lease-pdf" />
        <FilePicker label="Pickup photos" accept="image/jpeg,image/png,image/webp" multiple files={photos} onChange={setPhotos} hint="Front, back, left, right and a plate close-up. Optional, can be added later. The AI return inspection compares against these." testId="checkin-photos" />
        <div className="flex flex-col gap-3 sm:col-span-2">
          {feeBps !== undefined && (
            <p className="text-xs text-subtle" data-testid="fee-note">
              KeyEscrow fee: one-time {(Number(feeBps) / 100).toFixed(0)}% of one month&apos;s rent
              {rentAmount ? ` (${money((rentAmount * BigInt(feeBps)) / BigInt(10_000))})` : ""}, taken from your first rent payout.
              The renter never pays it and the deposit is never charged.
            </p>
          )}
          {warning && <Notice kind="warn">{warning}</Notice>}
          <ActionButton type="submit" busy={!!pending || !!status} disabledReason={blocker}>
            {status ?? "Create rental"}
          </ActionButton>
        </div>
      </form>
    </Card>
  );
}
