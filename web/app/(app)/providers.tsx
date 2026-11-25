"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { ToastProvider } from "@/components/Toasts";
import { getResolvedThemeSnapshot, subscribeTheme } from "@/lib/theme";
import { wagmiConfig } from "@/lib/wagmi";

const rkLight = lightTheme();
const rkDark = darkTheme();

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  // Server render and hydration use the light theme; the real one (set on <html> before paint) follows at once.
  const theme = useSyncExternalStore(subscribeTheme, getResolvedThemeSnapshot, () => "light" as const);
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme === "dark" ? rkDark : rkLight}>
          <ToastProvider>{children}</ToastProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
