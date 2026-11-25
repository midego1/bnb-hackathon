import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { bscTestnet, foundry, opBNBTestnet } from "viem/chains";
import { supportedChains } from "./chains";

const appName = "KeyEscrow";

// A WalletConnect project id is a public identifier (not a secret), so NEXT_PUBLIC_ is fine here.
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const transports = {
  [foundry.id]: http(process.env.NEXT_PUBLIC_ANVIL_RPC_URL ?? "http://127.0.0.1:8545"),
  [bscTestnet.id]: http(process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL),
  [opBNBTestnet.id]: http(process.env.NEXT_PUBLIC_OPBNB_TESTNET_RPC_URL),
};

/**
 * With a WalletConnect project id we get RainbowKit's full wallet list; without one we fall back
 * to injected browser wallets (MetaMask, Rabby, Binance Web3 Wallet extension, ...).
 */
export const wagmiConfig = walletConnectProjectId
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
      connectors: connectorsForWallets([{ groupName: "Browser wallet", wallets: [injectedWallet] }], {
        appName,
        projectId: "local-only",
      }),
    });
