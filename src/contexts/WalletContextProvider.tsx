
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
import { ALLOWED_WALLET_NAMES } from "@/config";

console.log("[WalletContextProvider] Top Level: ALLOWED_WALLET_NAMES from config:", ALLOWED_WALLET_NAMES);

export const WalletContextProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { currentNetwork, rpcUrl } = useNetwork();

  const walletsToInitialize = useMemo(() => {
    console.log("[WalletContextProvider useMemo] Re-evaluating wallets. currentNetwork:", currentNetwork, "ALLOWED_WALLET_NAMES:", ALLOWED_WALLET_NAMES);

    const baseAdapters: Adapter[] = [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: currentNetwork }), // currentNetwork is string, compatible with WalletAdapterNetwork
      new BackpackWalletAdapter(),
    ];
    console.log("[WalletContextProvider useMemo] Base adapters instantiated:", baseAdapters.map(a => a.name));

    if (ALLOWED_WALLET_NAMES && ALLOWED_WALLET_NAMES.length > 0) {
      console.log("[WalletContextProvider useMemo] Filtering based on ALLOWED_WALLET_NAMES:", ALLOWED_WALLET_NAMES);
      const filtered = baseAdapters.filter(adapter => {
        const isAllowed = ALLOWED_WALLET_NAMES.includes(adapter.name);
        console.log(`[WalletContextProvider useMemo] Checking adapter: ${adapter.name}. Is allowed: ${isAllowed}`);
        return isAllowed;
      });
      console.log("[WalletContextProvider useMemo] Final filtered adapters to initialize:", filtered.map(w => w.name));
      return filtered;
    }

    console.log("[WalletContextProvider useMemo] No specific wallets filtered by ALLOWED_WALLET_NAMES. Initializing all base adapters.");
    return baseAdapters;
  }, [currentNetwork]); // ALLOWED_WALLET_NAMES is from config, effectively static post-build, but currentNetwork can change.

  const standardWalletsToPass = useMemo(() => {
    // If ALLOWED_WALLET_NAMES is active, we pass an empty array to `standardWallets`
    // to signal to WalletProvider that it should *not* use its default behavior of
    // discovering standard wallets. The `wallets` prop will be our exclusively filtered list.
    if (ALLOWED_WALLET_NAMES && ALLOWED_WALLET_NAMES.length > 0) {
      console.log("[WalletContextProvider useMemo] ALLOWED_WALLET_NAMES is active. Passing empty array to standardWallets prop.");
      return [];
    }
    // If no filtering, let WalletProvider use its default standard wallet discovery.
    // Passing `undefined` achieves this.
    console.log("[WalletContextProvider useMemo] ALLOWED_WALLET_NAMES is not active. Letting WalletProvider use default standard wallet discovery.");
    return undefined;
  }, []); // ALLOWED_WALLET_NAMES is effectively static

  const providerKey = `${rpcUrl}-${currentNetwork}-${ALLOWED_WALLET_NAMES.join('-')}`;

  return (
    <ConnectionProvider endpoint={rpcUrl} key={`${providerKey}-conn`}>
      <WalletProvider
        wallets={walletsToInitialize}
        standardWallets={standardWalletsToPass}
        autoConnect
        key={`${providerKey}-wallet`}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
