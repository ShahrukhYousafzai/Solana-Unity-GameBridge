"use client";

import type { FC, ReactNode } from "react";
import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { SOLANA_CLUSTER, HELIUS_RPC_URL } from "@/config";

// The styles.css import was removed from here

export const WalletContextProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const network = SOLANA_CLUSTER as WalletAdapterNetwork; // mainnet-beta, testnet, devnet
  const endpoint = useMemo(() => HELIUS_RPC_URL, []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network }),
      new BackpackWalletAdapter(),
    ],
    [network]
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
