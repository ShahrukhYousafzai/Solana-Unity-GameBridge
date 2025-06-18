
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

import type { Nft, CNft, SplToken, HeliusAsset, Asset } from "@/types/solana"; // Added Asset
import { getHeliusAssetProof as fetchHeliusAssetProof } from "./helius"; // Renamed for clarity

// Re-introducing getHeliusAssetProof directly here, or ensure helius.ts only contains this.
// For this change, assuming getHeliusAssetProof is now part of this file or correctly imported.

export { fetchHeliusAssetProof }; // Export it if it's defined in helius.ts and imported

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
      id: "solblaze-searchAssets",
      method: "searchAssets",
      params: {
        ownerAddress,
        page: 1,
        limit: 1000,
        tokenType: "all", // Fetch all types
        displayOptions: {
          showFungible: true, // Ensure fungibles are included
          showNativeBalance: false, // Not interested in SOL balance here
          showUnverifiedCollections: true,
          showCollectionMetadata: true,
        }
      },
    });
    console.log(`[AssetLoader] searchAssets returned ${result.items?.length || 0} total items.`);
    return result.items || [];
  } catch (error) {
    console.error("[AssetLoader] Error calling Helius searchAssets:", error);
    throw error; // Rethrow to be caught by fetchAssetsForOwner
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


  // Handle cNFTs
  if (heliusAsset.compression?.compressed) {
    const cNftName = commonName || `Compressed Asset ${heliusAsset.id.substring(0, 6)}...`;
    console.log(`[AssetLoader] Normalizing as cNFT: ${cNftName} (ID: ${heliusAsset.id})`);
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

  // Handle standard NFTs (identified by specific interfaces, not primarily by compression)
  if (heliusAsset.interface === "V1_NFT" || heliusAsset.interface === "ProgrammableNFT" || heliusAsset.interface === "V1_PRINT" || heliusAsset.interface === "IdentityNFT") {
    const nftName = commonName || `NFT ${heliusAsset.id.substring(0, 6)}...`;
    console.log(`[AssetLoader] Normalizing as NFT: ${nftName} (ID: ${heliusAsset.id})`);
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
  
  // Handle Fungible Tokens (SPL & Token-2022)
  if (heliusAsset.interface === "FungibleAsset" || heliusAsset.interface === "FungibleToken" || heliusAsset.token_info) {
    const tokenInfo = heliusAsset.token_info;
    if (!tokenInfo) {
      console.warn(`[AssetLoader] Asset ${heliusAsset.id} (Interface: ${heliusAsset.interface}) looks like a token but lacks token_info. Skipping.`);
      return null;
    }

    const decimals = tokenInfo.decimals;
    const balance = tokenInfo.balance; // Helius provides this decimal-adjusted
    const rawBalance = tokenInfo.raw_token_amount ? BigInt(tokenInfo.raw_token_amount) : BigInt(Math.round(balance * (10 ** decimals)));

    if (rawBalance === BigInt(0) && balance === 0) { // Check both just in case
        console.log(`[AssetLoader] Skipping zero balance token: ${heliusAsset.id} (Name: ${commonName || 'N/A'})`);
        return null;
    }
    
    const tokenName = commonName || tokenInfo.symbol || `Token ${heliusAsset.id.substring(0, 6)}...`;
    const tokenSymbol = tokenInfo.symbol || commonSymbol || heliusAsset.id.substring(0, 4).toUpperCase();

    console.log(`[AssetLoader] Normalizing as SPL Token: ${tokenName} (ID: ${heliusAsset.id}), Balance: ${balance}, Raw: ${rawBalance.toString()}`);
    
    return {
      id: heliusAsset.id, // Mint address
      name: tokenName,
      symbol: tokenSymbol,
      imageUrl, // Image from common section if available
      type: "token",
      uri: heliusAsset.content?.json_uri,
      decimals,
      balance,
      rawBalance,
      tokenAddress: heliusAsset.ownership.token_account, // Associated Token Account address
      rawHeliusAsset: heliusAsset,
    } as SplToken;
  }
  
  console.log(`[AssetLoader] Asset ${heliusAsset.id} did not match any known normalization rules. Interface: ${heliusAsset.interface}, Compression: ${heliusAsset.compression?.compressed}`);
  return null;
};


export async function fetchAssetsForOwner(
  ownerAddressString: string,
  rpcUrl: string,
  connection: Connection, // Keep connection for potential future use or other non-Helius tasks
  wallet: WalletContextState // Keep wallet for identity or signing if needed elsewhere
): Promise<{ nfts: Nft[]; cnfts: CNft[]; tokens: SplToken[]; heliusWarning?: string }> {
  const nfts: Nft[] = [];
  const cnfts: CNft[] = [];
  const tokens: SplToken[] = [];
  let heliusWarning: string | undefined = undefined;

  console.log(`[AssetLoader] Starting asset fetch for owner: ${ownerAddressString} using RPC for Helius: ${rpcUrl}`);

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
          tokens.push(appAsset);
        }
      }
    }
  } catch (error: any) {
    console.error("[AssetLoader] Error fetching or processing Helius assets:", error);
    heliusWarning = "Failed to load assets from Helius: " + error.message;
    // Optionally, decide if you want to return empty arrays or rethrow
  }

  console.log(`[AssetLoader] Asset fetch complete. NFTs: ${nfts.length}, cNFTs: ${cnfts.length}, Tokens: ${tokens.length}. Helius Warning: ${heliusWarning || 'None'}`);
  return { nfts, cnfts, tokens, heliusWarning };
}
