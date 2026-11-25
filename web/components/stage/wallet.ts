"use client";

import { createPublicClient, createWalletClient, http, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil, bscTestnet } from "@/lib/chains";

/**
 * The judge's guest wallet: a fresh key made in this browser and kept in its localStorage. Testnet only; the key never
 * leaves the phone (the server only ever sees the address).
 */
const KEY = "keyescrow.stage.guestKey.v1";
const listeners = new Set<() => void>();
/** For useSyncExternalStore: the key changes when the judge makes or forgets a guest wallet. */
export const subscribeGuestKey = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));
/** For useSyncExternalStore subscriptions to values that never change after hydration. */
export const subscribeNothing = () => () => {};

export const stageChain = (chainId: number) => (chainId === anvil.id ? anvil : bscTestnet);

export function loadGuestKey(): Hex | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v && /^0x[0-9a-f]{64}$/i.test(v) ? (v as Hex) : undefined;
  } catch {
    return undefined;
  }
}

export function createGuestKey(): Hex {
  const k = generatePrivateKey();
  try {
    localStorage.setItem(KEY, k);
  } catch {}
  listeners.forEach((f) => f());
  return k;
}

export function forgetGuestKey() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((f) => f());
}

/** The judge picked their own wallet (MetaMask): only then is an already connected wallet used. */
const EXTERNAL = "keyescrow.stage.external";
export function loadExternal(): boolean {
  try {
    return localStorage.getItem(EXTERNAL) === "1";
  } catch {
    return false;
  }
}
export function chooseExternal(on: boolean) {
  try {
    if (on) localStorage.setItem(EXTERNAL, "1");
    else localStorage.removeItem(EXTERNAL);
  } catch {}
  listeners.forEach((f) => f());
}

export function guestWallet(key: Hex, chainId: number) {
  const chain = stageChain(chainId);
  return createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(chain.rpcUrls.default.http[0], { retryCount: 3, timeout: 20_000 }) });
}

export function stagePublicClient(chainId: number): PublicClient {
  const chain = stageChain(chainId);
  return createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0], { retryCount: 3, timeout: 20_000 }), pollingInterval: 1_000 }) as PublicClient;
}
