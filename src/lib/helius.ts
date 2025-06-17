
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
  const name = heliusAsset.content?.metadata?.name || "Unknown Asset";
  const symbol = heliusAsset.content?.metadata?.symbol || "";
  let imageUrl = heliusAsset.content?.links?.image || heliusAsset.content?.files?.find(f => f.uri && f.mime?.startsWith("image/"))?.uri;

  if (!imageUrl) {
    imageUrl = heliusAsset.content?.files?.find(f => f.cdn_uri && f.mime?.startsWith("image/"))?.cdn_uri;
  }

  const collectionData = heliusAsset.grouping?.find(g => g.group_key === "collection");
  const collection = collectionData ? { name: collectionData.collection_metadata?.name || collectionData.group_value, id: collectionData.group_value } : undefined;

  const isVerifiedCollection = collectionData?.verified === true || heliusAsset.creators?.some(c => c.verified && collectionData?.group_value);


  if (heliusAsset.interface === "V1_NFT" || heliusAsset.interface === "ProgrammableNFT" || heliusAsset.interface === "IdentityNFT" || heliusAsset.interface === "V1_PRINT") {
    if (heliusAsset.compression?.compressed) {
      return {
        id: heliusAsset.id, 
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
      return {
        id: heliusAsset.id,
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
    if (!heliusAsset.token_info) return null; 
    
    const rawBalanceBigInt = BigInt(Math.round(heliusAsset.token_info.balance * (10 ** heliusAsset.token_info.decimals)));

    return {
      id: heliusAsset.id, 
      name,
      symbol: heliusAsset.token_info.symbol || symbol,
      imageUrl, 
      type: "token",
      uri: heliusAsset.content?.json_uri,
      decimals: heliusAsset.token_info.decimals,
      balance: heliusAsset.token_info.balance, 
      rawBalance: rawBalanceBigInt,
      tokenAddress: heliusAsset.ownership.token_account || heliusAsset.spl_token_info?.token_account,
      rawHeliusAsset: heliusAsset,
    } as SplToken;
  }
  
   if (heliusAsset.spl_token_info && heliusAsset.id) { 
    const decimals = heliusAsset.spl_token_info.decimals;
    const rawBalance = BigInt(heliusAsset.spl_token_info.balance);
    const balance = Number(rawBalance) / (10 ** decimals);
    return {
      id: heliusAsset.id, 
      name: name !== "Unknown Asset" ? name : heliusAsset.id, 
      symbol: symbol || heliusAsset.id.substring(0,4), 
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
        if (asset.balance > 0) {
           tokens.push(asset);
        }
      }
    }
  }
  return { nfts, cnfts, tokens };
};

