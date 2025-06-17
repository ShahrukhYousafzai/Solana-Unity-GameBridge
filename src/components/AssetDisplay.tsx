"use client";

import type { Asset, Nft, CNft, SplToken } from "@/types/solana";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Copy, Send, Trash2 } from "lucide-react";
import { getAddressExplorerUrl } from "@/utils/explorer";
import { useToast } from "@/hooks/use-toast";

interface AssetDisplayProps {
  asset: Asset;
  onTransferClick: () => void;
  onBurnClick: () => void;
}

export const AssetDisplay: React.FC<AssetDisplayProps> = ({ asset, onTransferClick, onBurnClick }) => {
  const { toast } = useToast();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `${label} Copied!`, description: text });
    }).catch(err => {
      toast({ title: `Failed to copy ${label}`, description: err.message, variant: "destructive" });
    });
  };
  
  const assetTypeLabel = asset.type === "nft" ? "NFT" : asset.type === "cnft" ? "Compressed NFT" : "Token";

  return (
    <Card className="w-full shadow-xl">
      <CardHeader className="p-6">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-2xl font-bold mb-1">{asset.name}</CardTitle>
            <CardDescription className="text-base text-muted-foreground">{asset.symbol || assetTypeLabel}</CardDescription>
          </div>
          <a
            href={getAddressExplorerUrl(asset.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1"
            aria-label={`View ${asset.name} on explorer`}
          >
            View on Explorer <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-0">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-full md:w-1/3 aspect-square relative rounded-lg overflow-hidden shadow-md bg-muted">
            {asset.imageUrl ? (
              <Image
                src={asset.imageUrl}
                alt={asset.name}
                layout="fill"
                objectFit="cover"
                data-ai-hint="abstract digital"
                onError={(e) => { e.currentTarget.src = 'https://placehold.co/400x400.png'; }}
              />
            ) : (
              <Image
                src="https://placehold.co/400x400.png"
                alt="Placeholder"
                layout="fill"
                objectFit="cover"
                data-ai-hint="abstract geometric"
              />
            )}
          </div>
          <div className="w-full md:w-2/3 space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground">Asset ID (Mint/cNFT ID)</h4>
              <div className="flex items-center gap-2">
                <p className="text-sm truncate font-mono" title={asset.id}>{asset.id}</p>
                <Button variant="ghost" size="icon" onClick={() => copyToClipboard(asset.id, "Asset ID")} aria-label="Copy Asset ID">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {(asset.type === "nft" || asset.type === "cnft") && (asset as Nft | CNft).collection && (
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground">Collection</h4>
                <p className="text-sm truncate" title={(asset as Nft | CNft).collection!.name}>{(asset as Nft | CNft).collection!.name}</p>
              </div>
            )}

            {asset.type === "token" && (
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground">Balance</h4>
                <p className="text-lg font-bold">{(asset as SplToken).balance.toLocaleString()} {asset.symbol}</p>
                <p className="text-xs text-muted-foreground">Decimals: {(asset as SplToken).decimals}</p>
              </div>
            )}

            {asset.rawHeliusAsset.creators && asset.rawHeliusAsset.creators.length > 0 && (
                 <div>
                    <h4 className="text-sm font-semibold text-muted-foreground">Creators</h4>
                    <ul className="text-xs space-y-0.5">
                    {asset.rawHeliusAsset.creators.slice(0,3).map(c => (
                        <li key={c.address} className="truncate font-mono" title={c.address}>
                            {c.address} ({c.share}%) {c.verified ? "✓" : ""}
                        </li>
                    ))}
                    {asset.rawHeliusAsset.creators.length > 3 && <li>...and more</li>}
                    </ul>
                </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button onClick={onTransferClick} className="bg-accent text-accent-foreground hover:bg-accent/90 flex-1">
                <Send className="mr-2 h-4 w-4" /> Transfer
              </Button>
              <Button onClick={onBurnClick} variant="destructive" className="flex-1">
                <Trash2 className="mr-2 h-4 w-4" /> Burn
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
