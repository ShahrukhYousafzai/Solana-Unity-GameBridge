
"use client";

import type { FC, ReactNode } from "react";
import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { useNetwork } from "./NetworkContext"; // Import useNetwork
import { ALLOWED_WALLET_NAMES } from "@/config"; // Import the new config

export const WalletContextProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { currentNetwork, rpcUrl } = useNetwork(); // Use network and rpcUrl from context

  const wallets = useMemo(() => {
    const allSupportedWallets = [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: currentNetwork }),
      new BackpackWalletAdapter(),
    ];

    if (ALLOWED_WALLET_NAMES && ALLOWED_WALLET_NAMES.length > 0) {
      console.log("[WalletContextProvider] Allowed wallet names:", ALLOWED_WALLET_NAMES);
      const filteredWallets = allSupportedWallets.filter(walletAdapter =>
        ALLOWED_WALLET_NAMES.includes(walletAdapter.name)
      );
      console.log("[WalletContextProvider] Filtered wallets being initialized:", filteredWallets.map(w => w.name));
      return filteredWallets;
    }
    console.log("[WalletContextProvider] No specific wallets filtered. Initializing all supported wallets:", allSupportedWallets.map(w => w.name));
    return allSupportedWallets;
  }, [currentNetwork]); // Re-initialize wallets if network changes. ALLOWED_WALLET_NAMES is effectively static post-build.

  // Key the providers by rpcUrl and currentNetwork to force re-render when they change
  // This ensures ConnectionProvider and WalletProvider re-initialize with new settings.
  const providerKey = `${rpcUrl}-${currentNetwork}-${ALLOWED_WALLET_NAMES.join('-')}`; // Add ALLOWED_WALLET_NAMES to key for robustness

  return (
    <ConnectionProvider endpoint={rpcUrl} key={`${providerKey}-conn`}>
      <WalletProvider wallets={wallets} autoConnect key={`${providerKey}-wallet`}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
