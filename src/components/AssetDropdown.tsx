"use client";

import type React from "react";
import type { Asset, Nft, CNft, SplToken } from "@/types/solana";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Box, ScanSearch, Coins } from "lucide-react"; // Icons for asset types

interface AssetDropdownProps {
  nfts: Nft[];
  cnfts: CNft[];
  tokens: SplToken[];
  selectedAssetId: string | null;
  onSelectAsset: (assetId: string | null) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export const AssetDropdown: React.FC<AssetDropdownProps> = ({
  nfts,
  cnfts,
  tokens,
  selectedAssetId,
  onSelectAsset,
  isLoading = false,
  disabled = false,
}) => {
  const allAssets = [...nfts, ...cnfts, ...tokens];

  const renderAssetOption = (asset: Asset) => (
    <SelectItem key={asset.id} value={asset.id} className="flex items-center gap-2 py-2">
      <div className="flex items-center gap-2 min-w-0">
        {asset.type === "nft" && <Box className="h-4 w-4 text-primary shrink-0" />}
        {asset.type === "cnft" && <ScanSearch className="h-4 w-4 text-purple-500 shrink-0" />}
        {asset.type === "token" && <Coins className="h-4 w-4 text-green-500 shrink-0" />}
        <span className="truncate flex-1" title={asset.name}>
          {asset.name} {asset.symbol ? `(${asset.symbol})` : ''}
        </span>
        {asset.type === "token" && <span className="text-xs text-muted-foreground ml-auto shrink-0">({(asset as SplToken).balance.toLocaleString()})</span>}
      </div>
    </SelectItem>
  );

  return (
    <Select
      value={selectedAssetId || ""}
      onValueChange={(value) => onSelectAsset(value || null)}
      disabled={isLoading || disabled || allAssets.length === 0}
    >
      <SelectTrigger className="w-full text-base py-6 rounded-lg shadow-sm">
        <SelectValue placeholder={isLoading ? "Loading assets..." : "Select an asset from your wallet"} />
      </SelectTrigger>
      <SelectContent className="max-h-96">
        {isLoading ? (
          <SelectItem value="loading" disabled>Loading...</SelectItem>
        ) : allAssets.length === 0 ? (
          <SelectItem value="no-assets" disabled>No assets found in wallet.</SelectItem>
        ) : (
          <>
            {nfts.length > 0 && (
              <SelectGroup>
                <SelectLabel className="flex items-center gap-1"><Box className="h-4 w-4" />NFTs</SelectLabel>
                {nfts.map(renderAssetOption)}
              </SelectGroup>
            )}
            {cnfts.length > 0 && (
              <SelectGroup>
                <SelectLabel className="flex items-center gap-1"><ScanSearch className="h-4 w-4" />Compressed NFTs</SelectLabel>
                {cnfts.map(renderAssetOption)}
              </SelectGroup>
            )}
            {tokens.length > 0 && (
              <SelectGroup>
                <SelectLabel className="flex items-center gap-1"><Coins className="h-4 w-4" />Tokens</SelectLabel>
                {tokens.map(renderAssetOption)}
              </SelectGroup>
            )}
          </>
        )}
      </SelectContent>
    </Select>
  );
};
