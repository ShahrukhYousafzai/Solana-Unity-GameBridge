
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

  // Token Processing Logic:
  let tokenData: SplToken | null = null;

  // Attempt 1: Using heliusAsset.token_info (preferred for modern fungible assets like Token-2022)
  if (heliusAsset.interface === "FungibleAsset" || heliusAsset.interface === "FungibleToken") {
    if (heliusAsset.token_info) {
      const ti = heliusAsset.token_info;
      // Ensure all necessary fields from token_info are present
      if (typeof ti.decimals === 'number' && typeof ti.balance === 'number' && (heliusAsset.ownership.token_account || ti.raw_token_amount ) ) {
        const decimals = ti.decimals;
        const uiBalance = ti.balance; // This is already decimal-adjusted by Helius

        let rawBalanceBigInt: bigint;
        if (ti.raw_token_amount && /^\d+$/.test(ti.raw_token_amount)) {
          rawBalanceBigInt = BigInt(ti.raw_token_amount);
        } else {
          // Fallback if raw_token_amount is missing, calculate from UI balance and decimals
          rawBalanceBigInt = BigInt(Math.round(uiBalance * (10 ** decimals)));
        }

        const tokenName = commonName || `Token ${heliusAsset.id.substring(0, 6)}...`;
        const tokenSymbol = ti.symbol || commonSymbol || heliusAsset.id.substring(0, 4).toUpperCase();
        
        tokenData = {
          id: heliusAsset.id,
          name: tokenName,
          symbol: tokenSymbol,
          imageUrl,
          type: "token",
          uri: heliusAsset.content?.json_uri,
          decimals,
          balance: uiBalance,
          rawBalance: rawBalanceBigInt,
          tokenAddress: heliusAsset.ownership.token_account, // Prefer ownership.token_account from DAS
          rawHeliusAsset: heliusAsset,
        };
      } else {
         console.warn(`Asset ${heliusAsset.id} (Interface: ${heliusAsset.interface}) has incomplete token_info. Details:`, ti);
      }
    } else {
      console.warn(`Asset ${heliusAsset.id} (Interface: ${heliusAsset.interface}) is missing token_info. Will attempt fallback to spl_token_info if available.`);
    }
  }

  // Attempt 2: Using heliusAsset.spl_token_info (fallback or for older SPL token standards)
  // This will also catch cases where interface wasn't FungibleAsset/Token but spl_token_info is present,
  // or if the FungibleAsset/Token processing above couldn't form tokenData.
  if (!tokenData && heliusAsset.spl_token_info && heliusAsset.id) {
    const sti = heliusAsset.spl_token_info;
    // Ensure all necessary fields are present in spl_token_info
    if (typeof sti.decimals === 'number' && sti.balance && sti.token_account) {
      const decimals = sti.decimals;
      // spl_token_info.balance from Helius is typically the raw, non-adjusted string for older SPL tokens.
      const rawBalance = BigInt(String(sti.balance)); 
      const balance = Number(rawBalance) / (10 ** decimals); // Calculate UI balance

      const tokenName = commonName || `Token ${heliusAsset.id.substring(0, 6)}...`;
      const tokenSymbol = commonSymbol || heliusAsset.id.substring(0, 4).toUpperCase();

      tokenData = {
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
      };
    } else {
      console.warn(`Asset ${heliusAsset.id} has spl_token_info but it's incomplete. Skipping tokenization via spl_token_info. Details:`, sti);
    }
  }

  if (tokenData) {
    return tokenData;
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
        // Ensure tokens with any positive balance (either UI or raw) are included
        // Also include if balance is 0 but rawBalance is also 0 (e.g. an empty token account we might still want to list)
        if (asset.balance > 0 || asset.rawBalance > 0n || (asset.balance === 0 && asset.rawBalance === 0n)) { 
           tokens.push(asset);
        }
      }
    }
  }
  return { nfts, cnfts, tokens };
};

    
