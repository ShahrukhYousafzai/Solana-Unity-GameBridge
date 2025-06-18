
"use client";

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import React, { createContext, useContext, useState, useMemo } from 'react';
// WalletAdapterNetwork enum is not directly used for values here anymore, types are string literals.
import { HELIUS_API_KEY, DEFAULT_NETWORK, getRpcUrl } from '@/config';
import type { SupportedSolanaNetwork } from '@/config';

interface NetworkContextState {
  currentNetwork: SupportedSolanaNetwork;
  setCurrentNetwork: Dispatch<SetStateAction<SupportedSolanaNetwork>>;
  rpcUrl: string;
}

const NetworkContext = createContext<NetworkContextState | undefined>(undefined);

export const NetworkProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentNetwork, setCurrentNetwork] = useState<SupportedSolanaNetwork>(DEFAULT_NETWORK);

  const rpcUrl = useMemo(() => getRpcUrl(currentNetwork, HELIUS_API_KEY), [currentNetwork]);

  return (
    <NetworkContext.Provider value={{ currentNetwork, setCurrentNetwork, rpcUrl }}>
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = (): NetworkContextState => {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};

