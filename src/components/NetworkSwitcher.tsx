
"use client";

import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNetwork } from "@/contexts/NetworkContext";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import type { SupportedSolanaNetwork } from "@/config";
import { Globe } from "lucide-react";


const networkOptions: { value: SupportedSolanaNetwork; label: string }[] = [
  { value: WalletAdapterNetwork.Mainnet, label: "Mainnet" },
  { value: WalletAdapterNetwork.Devnet, label: "Devnet" },
  // Add Testnet if supported and Helius has an endpoint for it
  // { value: WalletAdapterNetwork.Testnet, label: "Testnet" },
];

export const NetworkSwitcher: React.FC = () => {
  const { currentNetwork, setCurrentNetwork } = useNetwork();

  const handleValueChange = (value: string) => {
    setCurrentNetwork(value as SupportedSolanaNetwork);
  };

  return (
    <div className="flex items-center gap-2">
      <Globe className="h-5 w-5 text-muted-foreground" />
      <Select value={currentNetwork} onValueChange={handleValueChange}>
        <SelectTrigger className="w-[150px] h-10 text-sm bg-background border-border shadow-sm">
          <SelectValue placeholder="Select Network" />
        </SelectTrigger>
        <SelectContent>
          {networkOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
