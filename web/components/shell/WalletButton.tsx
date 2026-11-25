"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Icon } from "./icons";

/** "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" -> "0x7099…79C8": always one line. */
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const row =
  "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sidebar-ring rail:justify-center rail:px-0";

/**
 * The sidebar's network and wallet rows (RainbowKit's modals behind our own buttons, so they fit the sidebar and the
 * icon rail). Not connected: one "Connect wallet" row. Connected: the network, then the address on a single line.
 */
export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        // Server render and hydration: keep the space but show nothing (the wallet is only known in the browser).
        if (!mounted) return <div className="h-9" aria-hidden />;
        if (!account || !chain) {
          return (
            <button type="button" onClick={openConnectModal} className={`${row} bg-primary text-primary-foreground hover:bg-primary-hover`} title="Connect wallet" data-testid="wallet-connect">
              <Icon name="wallet" />
              <span className="truncate rail:sr-only">Connect wallet</span>
            </button>
          );
        }
        return (
          <div className="flex flex-col gap-0.5" data-testid="wallet">
            <button
              type="button"
              onClick={openChainModal}
              className={`${row} ${chain.unsupported ? "text-danger" : "text-muted-foreground"}`}
              title={chain.unsupported ? "Wrong network" : `Network: ${chain.name}`}
              data-testid="wallet-network"
            >
              {chain.hasIcon && chain.iconUrl && !chain.unsupported ? (
                // eslint-disable-next-line @next/next/no-img-element -- RainbowKit's chain icon (data URL)
                <img src={chain.iconUrl} alt="" className="h-[18px] w-[18px] shrink-0 rounded-full" style={{ background: chain.iconBackground }} />
              ) : (
                <span aria-hidden className={`mx-[5px] h-2 w-2 shrink-0 rounded-full ${chain.unsupported ? "bg-danger" : "bg-success"}`} />
              )}
              <span className="truncate rail:sr-only">{chain.unsupported ? "Wrong network" : chain.name}</span>
            </button>
            <button type="button" onClick={openAccountModal} className={row} title={account.address} data-testid="wallet-account">
              <Icon name="wallet" />
              <span className="truncate font-mono text-[13px] rail:sr-only" data-testid="wallet-address">
                {shortAddress(account.address)}
              </span>
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
