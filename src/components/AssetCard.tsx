import type { Asset, Nft, CNft, SplToken } from "@/types/solana";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, Box, ScanSearch } from "lucide-react"; // Using ScanSearch for cNFTs

interface AssetCardProps {
  asset: Asset;
  onClick?: () => void;
}

const AssetTypeIcon = ({ type }: { type: Asset["type"] }) => {
  if (type === "nft") return <Box className="h-4 w-4 text-primary" />;
  if (type === "cnft") return <ScanSearch className="h-4 w-4 text-purple-500" />; // Different color for cNFT
  if (type === "token") return <Coins className="h-4 w-4 text-green-500" />;
  return null;
};

export const AssetCard: React.FC<AssetCardProps> = ({ asset, onClick }) => {
  const assetTypeLabel = asset.type === "nft" ? "NFT" : asset.type === "cnft" ? "Compressed NFT" : "Token";
  
  return (
    <Card className={`shadow-lg hover:shadow-xl transition-shadow duration-200 ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
      <CardHeader className="p-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold truncate" title={asset.name}>
            {asset.name}
          </CardTitle>
          <Badge variant="secondary" className="flex items-center gap-1 text-xs">
            <AssetTypeIcon type={asset.type} />
            {assetTypeLabel}
          </Badge>
        </div>
        {asset.symbol && <CardDescription className="text-sm text-muted-foreground">{asset.symbol}</CardDescription>}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="aspect-square w-full relative mb-2 rounded-md overflow-hidden bg-muted">
          {asset.imageUrl ? (
            <Image
              src={asset.imageUrl}
              alt={asset.name}
              layout="fill"
              objectFit="cover"
              data-ai-hint="abstract digital"
              onError={(e) => { e.currentTarget.src = 'https://placehold.co/300x300.png'; }} // Fallback
            />
          ) : (
            <Image
              src="https://placehold.co/300x300.png"
              alt="Placeholder"
              layout="fill"
              objectFit="cover"
              data-ai-hint="abstract geometric"
            />
          )}
        </div>
        {asset.type === "token" && (
          <p className="text-sm font-medium">Balance: {(asset as SplToken).balance.toLocaleString()} {asset.symbol}</p>
        )}
         {(asset.type === "nft" || asset.type === "cnft") && (asset as Nft | CNft).collection && (
          <p className="text-xs text-muted-foreground truncate" title={(asset as Nft | CNft).collection?.name}>
            Collection: {(asset as Nft | CNft).collection?.name || 'N/A'}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
