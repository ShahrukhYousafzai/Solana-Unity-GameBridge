
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

export const WalletContextProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { currentNetwork, rpcUrl } = useNetwork(); // Use network and rpcUrl from context

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: currentNetwork }), // Use currentNetwork
      new BackpackWalletAdapter(),
    ],
    [currentNetwork] // Re-initialize wallets if network changes
  );

  // Key the providers by rpcUrl and currentNetwork to force re-render when they change
  // This ensures ConnectionProvider and WalletProvider re-initialize with new settings.
  const providerKey = `${rpcUrl}-${currentNetwork}`;

  return (
    <ConnectionProvider endpoint={rpcUrl} key={`${providerKey}-conn`}>
      <WalletProvider wallets={wallets} autoConnect key={`${providerKey}-wallet`}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
