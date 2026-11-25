import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { anvil, anvilRpcUrl, bscTestnet, bscTestnetRpcUrl, opBNBTestnet, opBNBTestnetRpcUrl, supportedChains } from "./chains";
import { devAccountsConnector } from "./devAccounts";

const appName = "KeyEscrow";

// A WalletConnect project id is a public identifier (not a secret), so NEXT_PUBLIC_ is fine here.
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const transports: Record<number, ReturnType<typeof http>> = {
  [anvil.id]: http(anvilRpcUrl),
  [bscTestnet.id]: http(bscTestnetRpcUrl),
  [opBNBTestnet.id]: http(opBNBTestnetRpcUrl),
};

const walletConnectors = connectorsForWallets([{ groupName: "Browser wallet", wallets: [injectedWallet] }], {
  appName,
  projectId: walletConnectProjectId ?? "local-only",
});

/**
 * With a WalletConnect project id we get RainbowKit's full wallet list; without one we fall back
 * to injected browser wallets (MetaMask, Rabby, Binance Web3 Wallet extension, ...). The anvil dev
 * account switcher is added only in builds with NEXT_PUBLIC_DEV_ACCOUNTS=1.
 */
// The env check is inlined (not imported) so production builds constant-fold it and drop the dev connector.
const devAccountsEnabled = process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1";

export const wagmiConfig =
  walletConnectProjectId && !devAccountsEnabled
    ? getDefaultConfig({
        appName,
        projectId: walletConnectProjectId,
        chains: supportedChains,
        transports,
        ssr: true,
      })
    : createConfig({
        chains: supportedChains,
        transports,
        ssr: true,
        connectors: devAccountsEnabled ? [...walletConnectors, devAccountsConnector()] : walletConnectors,
      });
