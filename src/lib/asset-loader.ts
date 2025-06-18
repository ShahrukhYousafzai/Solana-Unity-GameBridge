
import type { Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Nft, CNft, SplToken, HeliusAsset, Asset } from "@/types/solana";
import type { HeliusAssetProof } from "./helius";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";


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
    console.error("[AssetLoader] Helius API Error Details:", JSON.stringify(data.error, null, 2));
    throw new Error(message);
  }
  return data.result;
};


const searchHeliusAssets = async (ownerAddress: string, rpcUrl: string): Promise<HeliusAsset[]> => {
  console.log(`[AssetLoader] Fetching all assets via searchAssets for owner: ${ownerAddress} using RPC: ${rpcUrl}`);
  try {
    const result = await callHeliusApi(rpcUrl, {
      jsonrpc: "2.0",
      id: "solblaze-searchAssets-all-types", 
      method: "searchAssets",
      params: {
        ownerAddress,
        page: 1, 
        limit: 1000,
        tokenType: "all", 
        displayOptions: { 
          showUnverifiedCollections: true, 
          showCollectionMetadata: true,
          showNativeBalance: false, // Keep this false unless SOL balance is explicitly needed as an asset
          // showFungible: true, // Removed as it caused an API error; tokenType: "all" should cover fungibles
        }
      },
    });
    console.log(`[AssetLoader] searchAssets returned ${result.items?.length || 0} total items.`);
    return result.items || [];
  } catch (error) {
    console.error("[AssetLoader] Error calling Helius searchAssets:", error);
    throw error; 
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
    console.log(`[AssetLoader] Normalizing as cNFT: ${heliusAsset.id} (Name: ${commonName || 'N/A'})`);
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
  if (heliusAsset.interface === "V1_NFT" || heliusAsset.interface === "ProgrammableNFT" || heliusAsset.interface === "V1_PRINT" || heliusAsset.interface === "IdentityNFT" || heliusAsset.interface === "ExecutableNFT" || heliusAsset.interface === "Inscription") {
    console.log(`[AssetLoader] Normalizing as NFT: ${heliusAsset.id} (Name: ${commonName || 'N/A'}, Interface: ${heliusAsset.interface})`);
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
  // Check for token_info first as it's more comprehensive for fungibles from searchAssets
  const tokenInfo = heliusAsset.token_info;
  if (tokenInfo || heliusAsset.interface === "FungibleAsset" || heliusAsset.interface === "FungibleToken" || heliusAsset.spl_token_info) {
    console.log(`[AssetLoader] Attempting to normalize as Token: ${heliusAsset.id} (Name: ${commonName || 'N/A'}, Interface: ${heliusAsset.interface})`);

    let decimals: number;
    let balance: number; // UI balance
    let rawBalanceBigInt: bigint;
    let tokenAccount: string | undefined = heliusAsset.ownership.token_account;
    let tokenProgramIdToStore: string = TOKEN_PROGRAM_ID.toBase58(); // Default to standard SPL

    if (tokenInfo) { 
      console.log(`[AssetLoader] Using token_info for ${heliusAsset.id}:`, tokenInfo);
      decimals = tokenInfo.decimals;
      balance = tokenInfo.balance; 
      if (typeof tokenInfo.raw_token_amount === 'string' && tokenInfo.raw_token_amount.length > 0) {
        rawBalanceBigInt = BigInt(tokenInfo.raw_token_amount);
      } else {
        console.warn(`[AssetLoader] token_info for ${heliusAsset.id} missing raw_token_amount or it's empty. Calculating from UI balance. This might lead to precision loss.`);
        rawBalanceBigInt = BigInt(Math.round(balance * (10 ** decimals)));
      }
      if (!tokenAccount && tokenInfo.token_program) tokenAccount = heliusAsset.ownership.owner; // Fallback if ATA not directly in ownership

      if (tokenInfo.token_program === TOKEN_2022_PROGRAM_ID.toBase58()) {
        tokenProgramIdToStore = TOKEN_2022_PROGRAM_ID.toBase58();
      }

    } else if (heliusAsset.spl_token_info) { 
      // Fallback to spl_token_info if token_info is missing, though less likely with searchAssets
      const splTokenInfo = heliusAsset.spl_token_info;
      console.log(`[AssetLoader] Using spl_token_info for ${heliusAsset.id}:`, splTokenInfo);
      decimals = splTokenInfo.decimals;
      rawBalanceBigInt = BigInt(splTokenInfo.balance); 
      balance = Number(rawBalanceBigInt) / (10 ** decimals);
      tokenAccount = splTokenInfo.token_account || heliusAsset.ownership.owner; // Fallback for token account
      // Determining program ID from spl_token_info is harder; mint's program_id is needed.
      // This path implies Helius didn't provide full token_info.
      // We might need to fetch mint info separately or rely on a convention if this path is common.
      // For now, it will use the default tokenProgramIdToStore (standard SPL) unless overwritten.
      // Check ownership.program_owner if it corresponds to the mint for Token-2022.
      // This is less reliable. The primary source should be token_info.token_program.
      if(heliusAsset.ownership?.program_owner === TOKEN_2022_PROGRAM_ID.toBase58()){
         console.warn(`[AssetLoader] Inferring Token-2022 program ID from ownership.program_owner for ${heliusAsset.id} as token_info.token_program was missing.`);
         tokenProgramIdToStore = TOKEN_2022_PROGRAM_ID.toBase58();
      } else {
        console.warn(`[AssetLoader] Token ${heliusAsset.id} missing token_info.token_program. Defaulting to standard SPL program ID from spl_token_info path.`);
      }

    } else {
      console.warn(`[AssetLoader] Asset ${heliusAsset.id} (Interface: ${heliusAsset.interface}) looks like a token but lacks sufficient token_info or spl_token_info. Skipping.`);
      return null;
    }

    if (rawBalanceBigInt === BigInt(0)) {
      console.log(`[AssetLoader] Skipping zero balance token: ${heliusAsset.id} (Name: ${commonName || 'N/A'})`);
      return null;
    }
    
    const tokenName = commonName || tokenInfo?.symbol || heliusAsset.id.substring(0, 6) + "...";
    const tokenSymbolFromMeta = commonSymbol || tokenInfo?.symbol;
    const tokenSymbol = tokenSymbolFromMeta ? tokenSymbolFromMeta : heliusAsset.id.substring(0, 4).toUpperCase();
    
    console.log(`[AssetLoader] Successfully normalized as Token: ${tokenName} (${tokenSymbol}), Balance: ${balance}, ProgramID: ${tokenProgramIdToStore}`);
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
      tokenProgramId: tokenProgramIdToStore,
    } as SplToken;
  }
  
  console.log(`[AssetLoader] Asset ${heliusAsset.id} did not match any known normalization rules. Interface: ${heliusAsset.interface}, Compression: ${heliusAsset.compression?.compressed}, TokenInfo: ${!!heliusAsset.token_info}, SplTokenInfo: ${!!heliusAsset.spl_token_info}`);
  return null;
};


export const fetchHeliusAssetProof = async (assetId: string, rpcUrl: string): Promise<HeliusAssetProof | null> => {
  console.log(`[AssetLoader/Proof] Fetching Helius asset proof for asset ID: ${assetId} using RPC: ${rpcUrl}`);
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
    console.log(`[AssetLoader/Proof] Successfully fetched asset proof for ${assetId}.`);
    return result as HeliusAssetProof;
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith("Helius API Error:"))) {
        console.error(`[AssetLoader/Proof] Error fetching Helius asset proof for ${assetId}:`, error);
    } // Helius API errors are logged by callHeliusApi
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
          // Zero balance check is now inside normalizeHeliusAssetToAppAsset
          tokens.push(appAsset);
        }
      }
    }
  } catch (error: any) {
    // The error message is constructed in callHeliusApi
    const specificMessage = error.message || "Failed to load assets from Helius due to an unknown error.";
    if (specificMessage.startsWith("Helius API Error:")) {
        heliusWarning = specificMessage;
    } else {
        heliusWarning = `An unexpected error occurred while fetching assets: ${specificMessage}`;
    }
    // No console.error here as callHeliusApi or searchHeliusAssets already logged specifics for API errors.
    // Other errors are re-thrown by searchHeliusAssets if not API errors.
  }

  console.log(`[AssetLoader] Asset fetch complete. NFTs: ${nfts.length}, cNFTs: ${cnfts.length}, Tokens: ${tokens.length}. Helius Warning: ${heliusWarning || 'None'}`);
  return { nfts, cnfts, tokens, heliusWarning };
}
