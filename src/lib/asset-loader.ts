
import type { Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Nft, CNft, SplToken, HeliusAsset, Asset } from "@/types/solana";
import type { HeliusAssetProof } from "./helius"; // Assuming HeliusAssetProof is still relevant and defined in a separate helius.ts or moved here.
// If HeliusAssetProof is defined in this file, the import is not needed.
// For now, let's assume it's still needed for fetchHeliusAssetProof.

// Helper to call Helius API and handle common error structure
const callHeliusApi = async (rpcUrl: string, body: object): Promise<any> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (data.error) {
    let message = `Helius API Error: ${data.error.message}`;
    const errorMessageLower = data.error.message?.toLowerCase();
    if (errorMessageLower?.includes("access forbidden") || errorMessageLower?.includes("unauthorized") || data.error.code === 403 || (data.error.code === -32603 && errorMessageLower?.includes("forbidden"))) {
      message += " This often indicates an issue with your Helius API key. Please ensure NEXT_PUBLIC_HELIUS_API_KEY is set correctly in your environment and is valid.";
    }
    throw new Error(message);
  }
  return data.result;
};


const searchHeliusAssets = async (ownerAddress: string, rpcUrl: string): Promise<HeliusAsset[]> => {
  console.log(`[AssetLoader] Fetching all assets via searchAssets for owner: ${ownerAddress} using RPC: ${rpcUrl}`);
  try {
    const result = await callHeliusApi(rpcUrl, {
      jsonrpc: "2.0",
      id: "solblaze-searchAssets", // Consistent ID for this method
      method: "searchAssets",
      params: {
        ownerAddress,
        page: 1, // Consider pagination if >1000 assets expected
        limit: 1000,
        tokenType: "all",
        displayOptions: {
          showFungible: true,
          showNativeBalance: false, // SOL balance is not part of this asset list
          showUnverifiedCollections: true, // To see all possible collection relations
          showCollectionMetadata: true, // To get names for collections
        }
      },
    });
    console.log(`[AssetLoader] searchAssets returned ${result.items?.length || 0} total items.`);
    return result.items || [];
  } catch (error) {
    console.error("[AssetLoader] Error calling Helius searchAssets:", error); // Log for server/build visibility
    throw error; // Re-throw for fetchAssetsForOwner to catch and set heliusWarning
  }
};

const normalizeHeliusAssetToAppAsset = (heliusAsset: HeliusAsset): Asset | null => {
  if (heliusAsset.burnt) {
    console.log(`[AssetLoader] Skipping burnt asset: ${heliusAsset.id}`);
    return null;
  }

  const commonName = heliusAsset.content?.metadata?.name;
  const commonSymbol = heliusAsset.content?.metadata?.symbol;
  let imageUrl = heliusAsset.content?.links?.image || heliusAsset.content?.files?.find(f => f.uri && f.mime?.startsWith("image/"))?.uri;
  if (!imageUrl) {
    imageUrl = heliusAsset.content?.files?.find(f => f.cdn_uri && f.mime?.startsWith("image/"))?.cdn_uri;
  }
  const collectionData = heliusAsset.grouping?.find(g => g.group_key === "collection");
  const collection = collectionData ? { name: collectionData.collection_metadata?.name || collectionData.group_value, id: collectionData.group_value } : undefined;
  const isVerifiedCollection = collectionData?.verified === true || heliusAsset.creators?.some(c => c.verified && collectionData?.group_value === c.address);

  // Compressed NFTs
  if (heliusAsset.compression?.compressed) {
    const cNftName = commonName || `Compressed Asset ${heliusAsset.id.substring(0, 6)}...`;
    return {
      id: heliusAsset.id,
      name: cNftName,
      symbol: commonSymbol || "",
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
  }

  // Standard NFTs
  if (heliusAsset.interface === "V1_NFT" || heliusAsset.interface === "ProgrammableNFT" || heliusAsset.interface === "V1_PRINT" || heliusAsset.interface === "IdentityNFT") {
    const nftName = commonName || `NFT ${heliusAsset.id.substring(0, 6)}...`;
    return {
      id: heliusAsset.id,
      name: nftName,
      symbol: commonSymbol || "",
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
  
  // Fungible Tokens (SPL & Token-2022)
  if (heliusAsset.interface === "FungibleAsset" || heliusAsset.interface === "FungibleToken" || heliusAsset.token_info || heliusAsset.spl_token_info) {
    const tokenInfo = heliusAsset.token_info;
    const splTokenInfo = heliusAsset.spl_token_info; // For potential fallback if token_info is sparse

    let decimals: number;
    let balance: number; // UI balance
    let rawBalanceBigInt: bigint;
    let tokenAccount: string | undefined = heliusAsset.ownership.token_account;

    if (tokenInfo) { // Prefer Helius's top-level token_info if available
      decimals = tokenInfo.decimals;
      balance = tokenInfo.balance; // Helius provides this decimal-adjusted
      rawBalanceBigInt = tokenInfo.raw_token_amount ? BigInt(tokenInfo.raw_token_amount) : BigInt(Math.round(balance * (10 ** decimals)));
      if (!tokenAccount && tokenInfo.token_program) tokenAccount = heliusAsset.ownership.owner; // Fallback for ATA if not directly on ownership.token_account for some reason
    } else if (splTokenInfo) { // Fallback to spl_token_info
      decimals = splTokenInfo.decimals;
      rawBalanceBigInt = BigInt(splTokenInfo.balance); // spl_token_info.balance is usually raw
      balance = Number(rawBalanceBigInt) / (10 ** decimals);
      tokenAccount = splTokenInfo.token_account || heliusAsset.ownership.owner;
    } else {
      console.warn(`[AssetLoader] Asset ${heliusAsset.id} looks like a token but lacks token_info and spl_token_info. Skipping.`);
      return null;
    }

    if (rawBalanceBigInt === BigInt(0)) {
      console.log(`[AssetLoader] Skipping zero balance token: ${heliusAsset.id} (Name: ${commonName || 'N/A'})`);
      return null;
    }
    
    const tokenName = commonName || tokenInfo?.symbol || splTokenInfo?.mint?.substring(0,6) || `Token ${heliusAsset.id.substring(0, 6)}...`;
    const tokenSymbol = tokenInfo?.symbol || commonSymbol || heliusAsset.id.substring(0, 4).toUpperCase();
    
    return {
      id: heliusAsset.id, // Mint address
      name: tokenName,
      symbol: tokenSymbol,
      imageUrl,
      type: "token",
      uri: heliusAsset.content?.json_uri,
      decimals,
      balance,
      rawBalance: rawBalanceBigInt,
      tokenAddress: tokenAccount,
      rawHeliusAsset: heliusAsset,
    } as SplToken;
  }
  
  console.log(`[AssetLoader] Asset ${heliusAsset.id} did not match any known normalization rules. Interface: ${heliusAsset.interface}, Compression: ${heliusAsset.compression?.compressed}`);
  return null;
};


// Re-exporting fetchHeliusAssetProof if it's defined in helius.ts and needed by transactions.ts
// If it's moved here, then just define it.
// Assuming it's defined in a way that's still needed.
export const fetchHeliusAssetProof = async (assetId: string, rpcUrl: string): Promise<HeliusAssetProof | null> => {
  try {
    const result = await callHeliusApi(rpcUrl, {
      jsonrpc: '2.0',
      id: 'solblaze-rpc-getAssetProof', 
      method: 'getAssetProof',
      params: { id: assetId },
    });
    if (!result || !result.root || !result.proof) {
      console.warn(`[AssetLoader/Proof] No valid asset proof returned from Helius for asset ID: ${assetId}. Result:`, result);
      return null;
    }
    return result as HeliusAssetProof;
  } catch (error) {
    console.error(`[AssetLoader/Proof] Error fetching Helius asset proof for ${assetId}:`, error);
    throw error; 
  }
};


export async function fetchAssetsForOwner(
  ownerAddressString: string,
  rpcUrl: string,
  connection: Connection, 
  wallet: WalletContextState 
): Promise<{ nfts: Nft[]; cnfts: CNft[]; tokens: SplToken[]; heliusWarning?: string }> {
  const nfts: Nft[] = [];
  const cnfts: CNft[] = [];
  const tokens: SplToken[] = [];
  let heliusWarning: string | undefined = undefined;

  console.log(`[AssetLoader] Starting asset fetch for owner: ${ownerAddressString} using Helius RPC: ${rpcUrl}`);

  try {
    const heliusAssets = await searchHeliusAssets(ownerAddressString, rpcUrl);
    
    console.log(`[AssetLoader] Processing ${heliusAssets.length} assets from Helius searchAssets.`);
    for (const heliusAsset of heliusAssets) {
      const appAsset = normalizeHeliusAssetToAppAsset(heliusAsset);
      if (appAsset) {
        if (appAsset.type === "nft") {
          nfts.push(appAsset);
        } else if (appAsset.type === "cnft") {
          cnfts.push(appAsset);
        } else if (appAsset.type === "token") {
          // Double check for zero balance tokens again, though normalize should handle it
          if (appAsset.rawBalance > BigInt(0)) {
            tokens.push(appAsset);
          } else {
            console.log(`[AssetLoader] fetchAssetsForOwner: Filtered out zero balance token post-normalization: ${appAsset.name} (${appAsset.id})`);
          }
        }
      }
    }
  } catch (error: any) {
    // Do not console.error here if we are setting heliusWarning, 
    // to prevent Next.js error overlay for this specific handled error.
    heliusWarning = "Failed to load assets from Helius: " + error.message;
  }

  console.log(`[AssetLoader] Asset fetch complete. NFTs: ${nfts.length}, cNFTs: ${cnfts.length}, Tokens: ${tokens.length}. Helius Warning: ${heliusWarning || 'None'}`);
  return { nfts, cnfts, tokens, heliusWarning };
}

    