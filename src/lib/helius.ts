
import type { HeliusAsset, Nft, CNft, SplToken, Asset } from "@/types/solana";
import { PublicKey } from "@solana/web3.js";

export interface HeliusAssetProof {
  root: string;
  proof: string[]; // Array of public key strings
  leaf: string;
  tree_id: string;
  node_index: number;
}

const callHeliusApi = async (rpcUrl: string, body: object): Promise<any> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (data.error) {
    let message = `Helius API Error: ${data.error.message}`;
    const errorMessageLower = data.error.message?.toLowerCase();
    if (errorMessageLower?.includes("access forbidden") || 
        errorMessageLower?.includes("unauthorized") ||
        data.error.code === 403 || 
        (data.error.code === -32603 && errorMessageLower?.includes("forbidden")) 
    ) {
      message += " This often indicates an issue with your Helius API key. Please ensure NEXT_PUBLIC_HELIUS_API_KEY is set correctly in your environment and is valid.";
    }
    throw new Error(message);
  }
  return data.result;
};


const getAssetsByOwner = async (ownerAddress: string, rpcUrl: string): Promise<HeliusAsset[]> => {
  const result = await callHeliusApi(rpcUrl, {
      jsonrpc: "2.0",
      id: "solblaze-rpc-getAssetsByOwner",
      method: "getAssetsByOwner",
      params: {
        ownerAddress,
        page: 1, 
        limit: 1000,
        displayOptions: {
          showFungible: true, 
          showUnverifiedCollections: true,
          showCollectionMetadata: true,
        }
      },
    });
  return result.items || [];
};

export const getHeliusAssetProof = async (assetId: string, rpcUrl: string): Promise<HeliusAssetProof | null> => {
  try {
    const result = await callHeliusApi(rpcUrl, {
      jsonrpc: '2.0',
      id: 'solblaze-rpc-getAssetProof',
      method: 'getAssetProof',
      params: {
        id: assetId,
      },
    });
    if (!result || !result.root || !result.proof) {
      console.warn(`No valid asset proof returned from Helius for asset ID: ${assetId}. Result:`, result);
      return null;
    }
    return result as HeliusAssetProof;
  } catch (error) {
    console.error(`Error fetching Helius asset proof for ${assetId}:`, error);
    throw error; 
  }
};


const normalizeHeliusAsset = (heliusAsset: HeliusAsset): Asset | null => {
  const commonName = heliusAsset.content?.metadata?.name;
  const commonSymbol = heliusAsset.content?.metadata?.symbol;
  
  let imageUrl = heliusAsset.content?.links?.image || heliusAsset.content?.files?.find(f => f.uri && f.mime?.startsWith("image/"))?.uri;
  if (!imageUrl) {
    imageUrl = heliusAsset.content?.files?.find(f => f.cdn_uri && f.mime?.startsWith("image/"))?.cdn_uri;
  }

  const collectionData = heliusAsset.grouping?.find(g => g.group_key === "collection");
  const collection = collectionData ? { name: collectionData.collection_metadata?.name || collectionData.group_value, id: collectionData.group_value } : undefined;
  const isVerifiedCollection = collectionData?.verified === true || heliusAsset.creators?.some(c => c.verified && collectionData?.group_value);

  if (heliusAsset.interface === "V1_NFT" || heliusAsset.interface === "ProgrammableNFT" || heliusAsset.interface === "IdentityNFT" || heliusAsset.interface === "V1_PRINT") {
    const nftName = commonName || "Unknown NFT";
    const nftSymbol = commonSymbol || "";
    if (heliusAsset.compression?.compressed) {
      return {
        id: heliusAsset.id, 
        name: nftName,
        symbol: nftSymbol,
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
      return {
        id: heliusAsset.id,
        name: nftName,
        symbol: nftSymbol,
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
    if (!heliusAsset.token_info) {
        console.warn(`Asset ${heliusAsset.id} (Interface: ${heliusAsset.interface}) is missing token_info. Skipping.`);
        return null;
    }
    
    const ti = heliusAsset.token_info;
    const decimals = typeof ti.decimals === 'number' ? ti.decimals : 0;
    const uiBalance = typeof ti.balance === 'number' ? ti.balance : 0;

    let rawBalanceBigInt: bigint;
    if (ti.raw_token_amount && /^\d+$/.test(ti.raw_token_amount)) {
      rawBalanceBigInt = BigInt(ti.raw_token_amount);
    } else {
      rawBalanceBigInt = BigInt(Math.round(uiBalance * (10 ** decimals)));
    }

    const tokenName = commonName || `Token ${heliusAsset.id.substring(0, 6)}...`;
    const tokenSymbol = ti.symbol || commonSymbol || heliusAsset.id.substring(0, 4).toUpperCase();
    
    return {
      id: heliusAsset.id, 
      name: tokenName,
      symbol: tokenSymbol,
      imageUrl, 
      type: "token",
      uri: heliusAsset.content?.json_uri,
      decimals,
      balance: uiBalance, 
      rawBalance: rawBalanceBigInt,
      tokenAddress: heliusAsset.ownership.token_account || heliusAsset.spl_token_info?.token_account,
      rawHeliusAsset: heliusAsset,
    } as SplToken;
  }
  
   // Handling for older or less detailed SPL token representations if needed
   if (heliusAsset.spl_token_info && heliusAsset.id) { 
    const sti = heliusAsset.spl_token_info;
    const decimals = typeof sti.decimals === 'number' ? sti.decimals : 0;
    const rawBalance = BigInt(sti.balance); // spl_token_info.balance from Helius is typically the raw, non-adjusted string.
    const balance = Number(rawBalance) / (10 ** decimals); // Calculate UI balance

    const tokenName = commonName || `Token ${heliusAsset.id.substring(0, 6)}...`;
    const tokenSymbol = commonSymbol || heliusAsset.id.substring(0, 4).toUpperCase();

    return {
      id: heliusAsset.id, 
      name: tokenName, 
      symbol: tokenSymbol, 
      imageUrl,
      type: "token",
      uri: heliusAsset.content?.json_uri,
      decimals,
      balance,
      rawBalance,
      tokenAddress: sti.token_account,
      rawHeliusAsset: heliusAsset,
    } as SplToken;
  }

  return null; 
};


export const fetchAssetsForOwner = async (
  ownerAddress: string,
  rpcUrl: string 
): Promise<{ nfts: Nft[]; cnfts: CNft[]; tokens: SplToken[] }> => {
  try {
    new PublicKey(ownerAddress); 
  } catch (error) {
    console.error("Invalid owner address:", ownerAddress);
    return { nfts: [], cnfts: [], tokens: [] };
  }

  let heliusAssets: HeliusAsset[] = [];
  try {
    heliusAssets = await getAssetsByOwner(ownerAddress, rpcUrl); 
  } catch (error: any) {
    const errorMessage = error.message?.toLowerCase() || "";
    if (errorMessage.includes("access forbidden") || errorMessage.includes("unauthorized")) {
      console.warn(
        `Helius API Error: ${error.message}. This often indicates an issue with your Helius API key (NEXT_PUBLIC_HELIUS_API_KEY). ` +
        "The app will proceed without Helius assets. Please check your API key configuration if you intend to use Helius."
      );
      return { nfts: [], cnfts: [], tokens: [] }; // Return empty assets on auth failure
    }
    // For other errors, re-throw to be handled by the caller (e.g., display toast)
    throw error;
  }
  
  const nfts: Nft[] = [];
  const cnfts: CNft[] = [];
  const tokens: SplToken[] = [];

  for (const heliusAsset of heliusAssets) {
    if (heliusAsset.burnt) continue; 

    const asset = normalizeHeliusAsset(heliusAsset);
    if (asset) {
      if (asset.type === "nft") {
        nfts.push(asset);
      } else if (asset.type === "cnft") {
        cnfts.push(asset);
      } else if (asset.type === "token") {
        if (asset.balance > 0 || asset.rawBalance > 0n) { // Ensure tokens with any balance are included
           tokens.push(asset);
        }
      }
    }
  }
  return { nfts, cnfts, tokens };
};

    