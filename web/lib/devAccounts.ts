import { createConnector } from "wagmi";
import { custom, getAddress, numberToHex, type Address, type EIP1193RequestFn } from "viem";
import { anvil, anvilRpcUrl } from "./chains";

/**
 * Dev-only "anvil account switcher".
 *
 * Enabled only when the app is built with NEXT_PUBLIC_DEV_ACCOUNTS=1, and only ever talks to the local anvil
 * chain (31337). It never holds a private key: anvil unlocks its well-known default accounts, so the
 * connector forwards `eth_sendTransaction` to the node, which signs with its own dev keys. On BSC testnet
 * (97) the connector does not exist; users connect a real wallet.
 */
// Call sites check process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" inline so production builds constant-fold
// the check and strip this module entirely.

export type DevRole = "landlord" | "tenant" | "arbiter";

/** Anvil default accounts #1-#3 (mnemonic "test test ... junk"). Public dev addresses, not secrets. */
export const devAccounts: Record<DevRole, Address> = {
  landlord: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  tenant: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  arbiter: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
};

const STORAGE_KEY = "keyescrow.devRole";
export const DEV_CONNECTOR_ID = "anvilDevAccounts";

function storedRole(): DevRole {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (v === "landlord" || v === "tenant" || v === "arbiter") return v;
  } catch {}
  return "landlord";
}

type Listener = (role: DevRole) => void;
const listeners = new Set<Listener>();

/** Switch the connected dev account. Emits an accounts change so wagmi updates everywhere. */
export function setDevRole(role: DevRole) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, role);
  } catch {}
  for (const l of listeners) l(role);
}

export function getDevRole(): DevRole {
  return storedRole();
}

export function devAccountsConnector() {
  let connected = false;
  return createConnector((config) => {
    const onRole: Listener = (role) => {
      if (connected) config.emitter.emit("change", { accounts: [devAccounts[role]] });
    };
    const request: EIP1193RequestFn = async ({ method, params }) => {
      if (method === "eth_chainId") return numberToHex(anvil.id);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [devAccounts[storedRole()]];
      if (method === "wallet_switchEthereumChain") return null;
      const res = await fetch(anvilRpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      });
      const json = await res.json();
      if (json.error) {
        const err = new Error(json.error.message) as Error & { code?: number; data?: unknown };
        err.code = json.error.code;
        err.data = json.error.data;
        throw err;
      }
      return json.result;
    };
    const provider = custom({ request })({ retryCount: 0 });

    return {
      id: DEV_CONNECTOR_ID,
      name: "Anvil dev accounts",
      type: "anvilDevAccounts",
      async setup() {
        listeners.add(onRole);
      },
      async connect() {
        connected = true;
        return { accounts: [getAddress(devAccounts[storedRole()])], chainId: anvil.id } as never;
      },
      async disconnect() {
        connected = false;
      },
      async getAccounts() {
        return [getAddress(devAccounts[storedRole()])];
      },
      async getChainId() {
        return anvil.id;
      },
      async getProvider() {
        return provider;
      },
      async isAuthorized() {
        return true;
      },
      async switchChain({ chainId }) {
        if (chainId !== anvil.id) throw new Error("Dev accounts only work on the local anvil chain.");
        return anvil;
      },
      onAccountsChanged(accounts) {
        config.emitter.emit("change", { accounts: accounts.map((a) => getAddress(a)) });
      },
      onChainChanged() {},
      onDisconnect() {
        connected = false;
        config.emitter.emit("disconnect");
      },
    };
  });
}
