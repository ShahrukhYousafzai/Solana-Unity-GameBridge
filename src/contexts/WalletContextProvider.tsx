
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
import type { Adapter } from "@solana/wallet-adapter-base";
import { useNetwork } from "./NetworkContext";

console.log("[WalletContextProvider] Initializing base wallet adapters.");

export const WalletContextProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { currentNetwork, rpcUrl } = useNetwork();

  const walletsToInitialize = useMemo(() => {
    console.log("[WalletContextProvider useMemo] Initializing standard set of wallets for network:", currentNetwork);
    const baseAdapters: Adapter[] = [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: currentNetwork }), // Solflare specific network config
      new BackpackWalletAdapter(),
    ];
    console.log("[WalletContextProvider useMemo] Base adapters to initialize:", baseAdapters.map(a => a.name));
    return baseAdapters;
  }, [currentNetwork]);


  const standardWalletsToPass = useMemo(() => {
    console.log("[WalletContextProvider useMemo] Letting WalletProvider use default standard wallet discovery.");
    return undefined; 
  }, []);

  const providerKey = `${rpcUrl}-${currentNetwork}-allWallets`;

  return (
    <ConnectionProvider endpoint={rpcUrl} key={`${providerKey}-conn`}>
      <WalletProvider
        wallets={walletsToInitialize}
        standardWallets={standardWalletsToPass} 
        autoConnect={true} // Keep wallet connected across page reloads
        key={`${providerKey}-wallet`}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

