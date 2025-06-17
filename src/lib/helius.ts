import { HELIUS_RPC_URL } from "@/config";
import type { HeliusAsset, Nft, CNft, SplToken, Asset } from "@/types/solana";
import { PublicKey } from "@solana/web3.js";

const getAssetsByOwner = async (ownerAddress: string): Promise<HeliusAsset[]> => {
  const response = await fetch(HELIUS_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "solblaze-rpc",
      method: "getAssetsByOwner",
      params: {
        ownerAddress,
        page: 1, // TODO: Implement pagination if needed
        limit: 1000,
        displayOptions: {
          showFungible: true, 
          showNativeBalance: false,
          showUnverifiedCollections: true,
          showCollectionMetadata: true,
        }
      },
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(`Helius API Error: ${data.error.message}`);
  }
  return data.result.items || [];
};


const normalizeHeliusAsset = (heliusAsset: HeliusAsset): Asset | null => {
  const name = heliusAsset.content?.metadata?.name || "Unknown Asset";
  const symbol = heliusAsset.content?.metadata?.symbol || "";
  let imageUrl = heliusAsset.content?.links?.image || heliusAsset.content?.files?.find(f => f.uri && f.mime?.startsWith("image/"))?.uri;
  // Fallback to cdn_uri if available
  if (!imageUrl) {
    imageUrl = heliusAsset.content?.files?.find(f => f.cdn_uri && f.mime?.startsWith("image/"))?.cdn_uri;
  }


  const collectionData = heliusAsset.grouping?.find(g => g.group_key === "collection");
  const collection = collectionData ? { name: collectionData.collection_metadata?.name || collectionData.group_value, id: collectionData.group_value } : undefined;
  // A simple check for verified collection (if any creator in the collection group is verified)
  // This is a basic assumption; more robust verification might be needed.
  const isVerifiedCollection = collectionData?.verified === true || heliusAsset.creators?.some(c => c.verified && collectionData?.group_value);


  if (heliusAsset.interface === "V1_NFT" || heliusAsset.interface === "ProgrammableNFT" || heliusAsset.interface === "IdentityNFT" || heliusAsset.interface === "V1_PRINT") {
    if (heliusAsset.compression?.compressed) {
      // cNFT
      return {
        id: heliusAsset.id, // cNFTs use their specific ID, not mint typically
        name,
        symbol,
        imageUrl,
        type: "cnft",
        uri: heliusAsset.content?.json_uri,
        compression: {
          compressed: true,
          tree: heliusAsset.compression.tree,
          leafId: heliusAsset.compression.leaf_id,
        },
        collection,
        creators: heliusAsset.creators,
        isVerifiedCollection,
        rawHeliusAsset: heliusAsset,
      } as CNft;
    } else {
      // Standard NFT
      return {
        id: heliusAsset.id, // Mint address
        name,
        symbol,
        imageUrl,
        type: "nft",
        uri: heliusAsset.content?.json_uri,
        tokenAddress: heliusAsset.ownership.token_account,
        collection,
        creators: heliusAsset.creators,
        isVerifiedCollection,
        rawHeliusAsset: heliusAsset,
      } as Nft;
    }
  }

  if (heliusAsset.interface === "FungibleAsset" || heliusAsset.interface === "FungibleToken") {
    if (!heliusAsset.token_info) return null; // Should not happen for fungibles
    
    // Helius balance is already adjusted for decimals.
    // For rawBalance, we need to parse it from a string if available, or calculate from float.
    // It's safer to work with BigInt for raw balances. Helius typically provides 'balance' as a number (adjusted)
    // and sometimes raw balance as string. If not, we calculate.
    const rawBalanceBigInt = BigInt(Math.round(heliusAsset.token_info.balance * (10 ** heliusAsset.token_info.decimals)));

    return {
      id: heliusAsset.id, // Mint address
      name,
      symbol: heliusAsset.token_info.symbol || symbol,
      imageUrl, // Tokens can have images via token-list or metadata
      type: "token",
      uri: heliusAsset.content?.json_uri,
      decimals: heliusAsset.token_info.decimals,
      balance: heliusAsset.token_info.balance, // Already UI formatted by Helius
      rawBalance: rawBalanceBigInt,
      tokenAddress: heliusAsset.ownership.token_account || heliusAsset.spl_token_info?.token_account,
      rawHeliusAsset: heliusAsset,
    } as SplToken;
  }
  
  // Fallback for other types like "Inscription" or if it's a token from spl_token_info
   if (heliusAsset.spl_token_info && heliusAsset.id) { // e.g. older token types
    const decimals = heliusAsset.spl_token_info.decimals;
    const rawBalance = BigInt(heliusAsset.spl_token_info.balance);
    const balance = Number(rawBalance) / (10 ** decimals);
    return {
      id: heliusAsset.id, // Mint address
      name: name !== "Unknown Asset" ? name : heliusAsset.id, // Use mint if no name
      symbol: symbol || heliusAsset.id.substring(0,4), // Use symbol or part of mint
      imageUrl,
      type: "token",
      uri: heliusAsset.content?.json_uri,
      decimals,
      balance,
      rawBalance,
      tokenAddress: heliusAsset.spl_token_info.token_account,
      rawHeliusAsset: heliusAsset,
    } as SplToken;
  }


  return null; // Skip unknown or unsupported asset types
};


export const fetchAssetsForOwner = async (
  ownerAddress: string
): Promise<{ nfts: Nft[]; cnfts: CNft[]; tokens: SplToken[] }> => {
  try {
    new PublicKey(ownerAddress); // Validate address
  } catch (error) {
    console.error("Invalid owner address:", ownerAddress);
    return { nfts: [], cnfts: [], tokens: [] };
  }

  const heliusAssets = await getAssetsByOwner(ownerAddress);
  
  const nfts: Nft[] = [];
  const cnfts: CNft[] = [];
  const tokens: SplToken[] = [];

  for (const heliusAsset of heliusAssets) {
    if (heliusAsset.burnt) continue; // Skip burnt assets

    const asset = normalizeHeliusAsset(heliusAsset);
    if (asset) {
      if (asset.type === "nft") {
        nfts.push(asset);
      } else if (asset.type === "cnft") {
        cnfts.push(asset);
      } else if (asset.type === "token") {
        // Filter out tokens with zero balance
        if (asset.balance > 0) {
           tokens.push(asset);
        }
      }
    }
  }
  return { nfts, cnfts, tokens };
};
