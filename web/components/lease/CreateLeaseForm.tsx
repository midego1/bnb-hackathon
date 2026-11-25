"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getAddress, isAddress, parseEventLogs, zeroAddress, type Address, type Hex } from "viem";
import { useAccount } from "wagmi";
import { FilePicker } from "@/components/FilePicker";
import { DepositRiskForUsdt } from "@/components/risk/DepositRiskPanel";
import { ActionButton, Card, Field, inputClass, Notice, PriceSourceBadge, useMoney } from "@/components/ui";
import { prepareCreateLease } from "@/lib/actions/definitions";
import { fieldError } from "@/lib/actions/fields";
import { escrowFactoryAbi, EvidenceKind, rentalEscrowAbi } from "@/lib/contracts";
import { devAccounts } from "@/lib/devAccounts";
import { uploadEvidence } from "@/lib/evidence";
import { parseUsdt, shortAddress } from "@/lib/format";
import { ZERO_HASH } from "@/lib/hash";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useFactorySettings } from "@/lib/hooks/useFactory";
import { useTx } from "@/lib/hooks/useTx";
import { useT } from "@/lib/i18n/client";

export function CreateLeaseForm() {
  const t = useT();
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

  // Same field schemas as the prepare_create_lease API / MCP tool (lib/actions), so the rules and messages match.
  const S = prepareCreateLease.input;
  const decimals = (units: bigint | undefined) => (units === undefined ? t("createLease.decimals") : undefined);
  const errors = {
    tenant: !tenant
      ? undefined
      : fieldError(S, "renter", tenant) ?? (me && tenant.toLowerCase() === me.toLowerCase() ? t("createLease.self") : undefined),
    rent: fieldError(S, "rent", rent) ?? decimals(rentAmount),
    deposit: fieldError(S, "deposit", deposit) ?? decimals(depositAmount),
    term: fieldError(S, "termMonths", term),
    window: fieldError(S, "responseWindowDays", windowDays),
    arbiterWindow: fieldError(S, "arbiterWindowDays", arbiterDays),
    arbiter: useDesk
      ? !desk
        ? t("createLease.noDesk")
        : undefined
      : !arbiter
        ? undefined
        : fieldError(S, "arbiter", arbiter),
  };
  const distinct =
    !arbiterAddr || !me || !isAddress(tenant)
      ? true
      : new Set([arbiterAddr.toLowerCase(), me.toLowerCase(), tenant.toLowerCase()]).size === 3;

  const blocker =
    !deployment ? t("createLease.notDeployed") :
    !tenant ? t("createLease.enterRenter") :
    errors.tenant || errors.rent || errors.deposit || errors.term || errors.window || errors.arbiterWindow || errors.arbiter ||
    (!arbiterAddr ? t("createLease.enterDesk") : undefined) ||
    (!distinct ? t("createLease.distinct") : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (blocker || !deployment || !arbiterAddr) return;
    setWarning(null);

    let leaseHash: Hex = ZERO_HASH;
    let photoHashes: Hex[] = [];
    if (leaseDoc.length || photos.length) {
      setStatus(t("createLease.uploading"));
      const docs = await uploadEvidence([...leaseDoc, ...photos]);
      if (docs.warning) setWarning(docs.warning);
      if (leaseDoc.length) leaseHash = docs.items[0].hash;
      photoHashes = docs.items.slice(leaseDoc.length).map((i) => i.hash);
    }

    setStatus(t("createLease.creating"));
    const receipt = await send(t("createLease.create"), {
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
      setStatus(t("createLease.anchoring", { i: i + 1, n: photoHashes.length }));
      await send(t("createLease.anchorTx", { i: i + 1, n: photoHashes.length }), {
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
    <Card title={t.h("createLease.title")} aside={<PriceSourceBadge />}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" data-testid="create-lease-form">
        <div className="sm:col-span-2">
          <Field
            label={t("createLease.renterWallet")}
            error={errors.tenant}
            hint={
              showDevTenant ? (
                <button type="button" className="underline" onClick={() => setTenant(devAccounts.tenant)}>
                  {t("createLease.useAnvil", { address: shortAddress(devAccounts.tenant) })}
                </button>
              ) : (
                t("createLease.renterHint")
              )
            }
          >
            <input name="tenant" className={inputClass} placeholder="0x…" value={tenant} onChange={(e) => setTenant(e.target.value.trim())} />
          </Field>
        </div>
        <Field label={t("createLease.rent")} error={errors.rent} hint={rentAmount ? <>≈ {money(rentAmount)}</> : t("createLease.rentHint")}>
          <input name="rent" inputMode="decimal" className={inputClass} value={rent} onChange={(e) => setRent(e.target.value)} />
        </Field>
        <Field
          label={t("createLease.deposit")}
          error={errors.deposit}
          hint={depositAmount ? <>≈ {money(depositAmount)}{rentAmount ? t("createLease.monthsOfRent", { n: (Number(depositAmount) / Number(rentAmount)).toFixed(1).replace(/\.0$/, "") }) : ""}</> : undefined}
        >
          <input name="deposit" inputMode="decimal" className={inputClass} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </Field>
        <Field label={t("createLease.term")} error={errors.term}>
          <input name="term" type="number" min={1} max={60} className={inputClass} value={term} onChange={(e) => setTerm(e.target.value)} />
        </Field>
        <div className="sm:col-span-2"><DepositRiskForUsdt deposit={depositAmount} rentalDays={termMonths * 30} /></div>
        <Field label={t("createLease.window")} error={errors.window} hint={t("createLease.windowHint")}>
          <input name="window" type="number" min={1} max={60} className={inputClass} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className="text-sm font-medium">{t("createLease.desk")}</span>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={useDesk} onChange={(e) => setUseDesk(e.target.checked)} />
            <span>
              {t("createLease.useDesk")}
              {desk && <span className="font-mono text-xs text-subtle">({shortAddress(desk)})</span>}
              <span className="block text-xs text-subtle">
                {t("createLease.deskHelp")}
              </span>
            </span>
          </label>
          <Field label={t("createLease.deskDeadline")} error={errors.arbiterWindow} hint={t("createLease.deskDeadlineHint")}>
            <input name="arbiterWindow" type="number" min={1} max={90} className={inputClass} value={arbiterDays} onChange={(e) => setArbiterDays(e.target.value)} />
          </Field>
          {!useDesk && <input name="arbiter" className={inputClass} placeholder={t("createLease.reviewerPlaceholder")} aria-label={t("createLease.deskWallet")} value={arbiter} onChange={(e) => setArbiter(e.target.value.trim())} />}
          {errors.arbiter && <span className="text-xs text-danger">{errors.arbiter}</span>}
        </div>
        <FilePicker label={t("createLease.agreement")} accept="application/pdf" files={leaseDoc} onChange={setLeaseDoc} hint={t("createLease.agreementHint")} testId="lease-pdf" />
        <FilePicker label={t("createLease.photos")} accept="image/jpeg,image/png,image/webp" multiple files={photos} onChange={setPhotos} hint={t("createLease.photosHint")} testId="checkin-photos" />
        <div className="flex flex-col gap-3 sm:col-span-2">
          {feeBps !== undefined && (
            <p className="text-xs text-subtle" data-testid="fee-note">
              {t("createLease.fee", {
                pct: (Number(feeBps) / 100).toFixed(0),
                amount: rentAmount ? ` (${money((rentAmount * BigInt(feeBps)) / BigInt(10_000))})` : "",
              })}
            </p>
          )}
          {warning && <Notice kind="warn">{warning}</Notice>}
          <ActionButton type="submit" busy={!!pending || !!status} disabledReason={blocker}>
            {status ?? t("createLease.create")}
          </ActionButton>
        </div>
      </form>
    </Card>
  );
}
