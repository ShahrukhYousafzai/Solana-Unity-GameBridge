
import { Connection, PublicKey, ParsedAccountData } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fetchAllDigitalAssetByOwner, mplTokenMetadata, TokenStandard as UmiTokenStandard, DigitalAsset as UmiDigitalAsset, fetchJsonMetadata } from "@metaplex-foundation/mpl-token-metadata";
import type { Umi } from "@metaplex-foundation/umi";

import type { Nft, CNft, SplToken, HeliusAsset } from "@/types/solana";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export interface HeliusAssetProof {
  root: string;
  proof: string[];
  leaf: string;
  tree_id: string;
  node_index: number;
}

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

const getHeliusAssetsByOwner = async (ownerAddress: string, rpcUrl: string): Promise<HeliusAsset[]> => {
  const result = await callHeliusApi(rpcUrl, {
    jsonrpc: "2.0",
    id: "solblaze-rpc-getAssetsByOwner",
    method: "getAssetsByOwner",
    params: {
      ownerAddress,
      page: 1,
      limit: 1000, // Consider pagination for very large wallets
      displayOptions: {
        showFungible: true, // Helius might return some fungibles
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
      params: { id: assetId },
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

const normalizeHeliusToNftOrCnft = (heliusAsset: HeliusAsset): Nft | CNft | null => {
  if (heliusAsset.burnt) return null;

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
    const nftName = commonName || `NFT ${heliusAsset.id.substring(0,6)}...`;
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
  return null;
};


async function fetchImageUrlFromMetadataUri(uri: string, umi?: Umi): Promise<string | undefined> {
  if (!uri) return undefined;
  try {
    let metadataJson: any;
    if (umi) {
         metadataJson = await fetchJsonMetadata(umi, uri);
    } else {
        const response = await fetch(uri);
        if (!response.ok) {
            console.warn(`Failed to fetch metadata from URI: ${uri}, status: ${response.status}`);
            return undefined;
        }
        metadataJson = await response.json();
    }
    return metadataJson.image || metadataJson.image_url || metadataJson.imageUrl;
  } catch (e) {
    console.warn(`Failed to fetch or parse metadata from URI: ${uri}`, e);
    return undefined;
  }
}

export async function fetchAssetsForOwner(
  ownerAddressString: string,
  rpcUrl: string,
  connection: Connection,
  wallet: WalletContextState
): Promise<{ nfts: Nft[]; cnfts: CNft[]; tokens: SplToken[] }> {
  const ownerPublicKey = new PublicKey(ownerAddressString);
  const nfts: Nft[] = [];
  const cnfts: CNft[] = [];
  const tokensMap = new Map<string, SplToken>(); // Use Map for easy upsert and deduplication by mint

  // 1. Fetch and process NFTs and cNFTs from Helius
  try {
    const heliusAssets = await getHeliusAssetsByOwner(ownerAddressString, rpcUrl);
    for (const heliusAsset of heliusAssets) {
      const asset = normalizeHeliusToNftOrCnft(heliusAsset);
      if (asset) {
        if (asset.type === "nft") nfts.push(asset);
        else if (asset.type === "cnft") cnfts.push(asset);
      }
    }
  } catch (error) {
    console.error("Failed to fetch or process Helius assets:", error);
    // Decide if we want to throw or continue with (potentially) only UMI tokens
  }

  // 2. Fetch Fungible Tokens (balances via direct RPC, metadata via UMI)
  const umi = createUmi(rpcUrl).use(mplTokenMetadata());
  if (wallet.publicKey && wallet.connected) { // UMI identity needed for some operations or if RPC requires it
    umi.use(walletAdapterIdentity(wallet));
  }


  // Get all token accounts for the owner to establish balances
  const tokenAccountsRaw = [];
  try {
    const splTokenAccounts = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, { programId: TOKEN_PROGRAM_ID });
    tokenAccountsRaw.push(...splTokenAccounts.value);
  } catch (e) { console.warn("Failed to get SPL token accounts:", e); }
  try {
    const token2022Accounts = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, { programId: TOKEN_2022_PROGRAM_ID });
    tokenAccountsRaw.push(...token2022Accounts.value);
  } catch (e) { console.warn("Failed to get Token-2022 accounts:", e); }


  const tokenAccountInfoMap = new Map<string, { mint: string; balance: number; rawBalance: bigint; decimals: number; tokenAccountAddress: string }>();
  for (const acc of tokenAccountsRaw) {
    try {
      const parsedInfo = (acc.account.data as ParsedAccountData).parsed.info;
      if (parsedInfo.mint && (parsedInfo.tokenAmount.uiAmount > 0 || parsedInfo.tokenAmount.amount !== "0" || nfts.some(n => n.id === parsedInfo.mint) || cnfts.some(c => c.id === parsedInfo.mint)) ) { // Keep even if balance is 0 for NFTs/cNFTs
        tokenAccountInfoMap.set(parsedInfo.mint, {
          mint: parsedInfo.mint,
          balance: parsedInfo.tokenAmount.uiAmount,
          rawBalance: BigInt(parsedInfo.tokenAmount.amount),
          decimals: parsedInfo.tokenAmount.decimals,
          tokenAccountAddress: acc.pubkey.toBase58(),
        });
      }
    } catch (e) {
      console.warn("Failed to parse token account data:", acc.pubkey.toBase58(), e);
    }
  }
  
  // Fetch all digital assets metadata using UMI for all known mints from token accounts
  const mintsToFetchMeta = Array.from(tokenAccountInfoMap.keys());
  const umiAssets: UmiDigitalAsset[] = [];

  if (mintsToFetchMeta.length > 0) {
    try {
        // fetchAllDigitalAssetByOwner is good if we don't have mint list, but since we do,
        // fetching one by one or in batches might be more targeted if fetchAll is too broad or slow.
        // For now, let's try to get all by owner and then filter.
        const umiOwnerUmiPublicKey = umi.eddsa.createPublicKey(ownerAddressString);
        const allOwnerAssetsUmi = await fetchAllDigitalAssetByOwner(umi, umiOwnerUmiPublicKey);
        
        for (const asset of allOwnerAssetsUmi) {
            if (mintsToFetchMeta.includes(asset.mint.publicKey.toString())) {
                umiAssets.push(asset);
            }
        }

    } catch (e) {
        console.warn("UMI fetchAllDigitalAssetByOwner failed, or processing UMI assets failed:", e);
    }
  }


  for (const [mint, accInfo] of tokenAccountInfoMap.entries()) {
    const umiAsset = umiAssets.find(ua => ua.mint.publicKey.toString() === mint);
    let name = `Token ${mint.substring(0, 6)}...`;
    let symbol = mint.substring(0, 4).toUpperCase();
    let imageUrl: string | undefined = undefined;
    let uri: string | undefined = undefined;
    // Using a placeholder as rawHeliusAsset is specific to Helius, UMI assets are different.
    // We might need to adjust the SplToken type if we want to store raw UMI asset data.
    const placeholderRawHeliusAsset = {} as HeliusAsset;


    if (umiAsset) {
      name = umiAsset.metadata.name || name;
      symbol = umiAsset.metadata.symbol || symbol;
      uri = umiAsset.metadata.uri;
      if (uri) {
        imageUrl = await fetchImageUrlFromMetadataUri(uri, umi);
      }
    }
    
    // Add or update the token in the map
    tokensMap.set(mint, {
      id: mint,
      name,
      symbol,
      imageUrl,
      type: "token",
      uri,
      decimals: accInfo.decimals,
      balance: accInfo.balance,
      rawBalance: accInfo.rawBalance,
      tokenAddress: accInfo.tokenAccountAddress,
      rawHeliusAsset: placeholderRawHeliusAsset, 
    });
  }

  return { nfts, cnfts, tokens: Array.from(tokensMap.values()) };
}
