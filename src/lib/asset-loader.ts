
import { Connection, PublicKey, ParsedAccountData, AccountInfo } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fetchAllDigitalAssetByOwner, mplTokenMetadata, fetchJsonMetadata, DigitalAsset as UmiDigitalAsset } from "@metaplex-foundation/mpl-token-metadata";
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
  console.log(`[AssetLoader] Fetching Helius assets for owner: ${ownerAddress} via ${rpcUrl}`);
  const result = await callHeliusApi(rpcUrl, {
    jsonrpc: "2.0",
    id: "solblaze-rpc-getAssetsByOwner",
    method: "getAssetsByOwner",
    params: {
      ownerAddress,
      page: 1,
      limit: 1000,
      displayOptions: {
        showFungible: false, 
        showUnverifiedCollections: true,
        showCollectionMetadata: true,
      }
    },
  });
  console.log(`[AssetLoader] Received ${result.items?.length || 0} assets from Helius for NFT/cNFT processing.`);
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
      console.warn(`[AssetLoader] No valid asset proof returned from Helius for asset ID: ${assetId}. Result:`, result);
      return null;
    }
    return result as HeliusAssetProof;
  } catch (error) {
    console.error(`[AssetLoader] Error fetching Helius asset proof for ${assetId}:`, error);
    throw error; 
  }
};

const normalizeHeliusToNftOrCnft = (heliusAsset: HeliusAsset): Nft | CNft | null => {
  if (heliusAsset.burnt) return null;

  if (heliusAsset.interface === "FungibleAsset" || heliusAsset.interface === "FungibleToken") {
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
            console.warn(`[AssetLoader] Failed to fetch metadata from URI: ${uri}, status: ${response.status}`);
            return undefined;
        }
        metadataJson = await response.json();
    }
    return metadataJson.image || metadataJson.image_url || metadataJson.imageUrl;
  } catch (e) {
    console.warn(`[AssetLoader] Failed to fetch or parse metadata from URI: ${uri}`, e);
    return undefined;
  }
}

export async function fetchAssetsForOwner(
  ownerAddressString: string,
  rpcUrl: string,
  connection: Connection,
  wallet: WalletContextState
): Promise<{ nfts: Nft[]; cnfts: CNft[]; tokens: SplToken[]; heliusWarning?: string }> {
  const ownerPublicKey = new PublicKey(ownerAddressString);
  const nfts: Nft[] = [];
  const cnfts: CNft[] = [];
  const tokensMap = new Map<string, SplToken>();
  let heliusWarning: string | undefined = undefined;

  console.log(`[AssetLoader] Starting asset fetch for owner: ${ownerAddressString} on RPC: ${rpcUrl}`);

  try {
    const heliusAssets = await getHeliusAssetsByOwner(ownerAddressString, rpcUrl);
    for (const heliusAsset of heliusAssets) {
      const asset = normalizeHeliusToNftOrCnft(heliusAsset);
      if (asset) {
        if (asset.type === "nft") nfts.push(asset);
        else if (asset.type === "cnft") cnfts.push(asset);
      }
    }
    console.log(`[AssetLoader] Processed Helius assets: ${nfts.length} NFTs, ${cnfts.length} cNFTs.`);
  } catch (error: any) {
    heliusWarning = "Could not load NFTs and cNFTs from Helius: " + error.message;
    console.warn(`[AssetLoader] Helius NFT/cNFT fetch failed: ${heliusWarning}`);
  }

  const umi = createUmi(rpcUrl).use(mplTokenMetadata());

  const tokenAccountsRaw: Array<{ pubkey: PublicKey; account: AccountInfo<ParsedAccountData>; programId: PublicKey }> = [];
  try {
    console.log(`[AssetLoader] Fetching SPL token accounts for owner: ${ownerAddressString}`);
    const splTokenAccounts = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, { programId: TOKEN_PROGRAM_ID });
    console.log(`[AssetLoader] Found ${splTokenAccounts.value.length} raw SPL token accounts.`);
    splTokenAccounts.value.forEach(acc => tokenAccountsRaw.push({...acc, programId: TOKEN_PROGRAM_ID}));
  } catch (e) { console.warn("[AssetLoader] Failed to get SPL token accounts:", e); }
  
  try {
    console.log(`[AssetLoader] Fetching Token-2022 accounts for owner: ${ownerAddressString}`);
    const token2022Accounts = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, { programId: TOKEN_2022_PROGRAM_ID });
    console.log(`[AssetLoader] Found ${token2022Accounts.value.length} raw Token-2022 accounts.`);
    token2022Accounts.value.forEach(acc => tokenAccountsRaw.push({...acc, programId: TOKEN_2022_PROGRAM_ID}));
  } catch (e) { console.warn("[AssetLoader] Failed to get Token-2022 accounts:", e); }

  console.log(`[AssetLoader] Total raw token accounts (SPL & Token-2022) to process: ${tokenAccountsRaw.length}`);
  const tokenAccountInfoMap = new Map<string, { mint: string; balance: number; rawBalance: bigint; decimals: number; tokenAccountAddress: string }>();

  for (const acc of tokenAccountsRaw) {
    try {
      const parsedInfo = (acc.account.data as ParsedAccountData).parsed.info;
      console.log(`[AssetLoader] Raw token account processing: Mint: ${parsedInfo.mint}, ATA: ${acc.pubkey.toBase58()}, Program: ${acc.programId.toBase58()}, TokenAmount: ${JSON.stringify(parsedInfo.tokenAmount)}`);

      const isNftOrCNftMint = nfts.some(n => n.id === parsedInfo.mint) || cnfts.some(c => c.id === parsedInfo.mint);
      if (isNftOrCNftMint) {
          console.log(`[AssetLoader] Mint ${parsedInfo.mint} is an NFT/cNFT (already processed by Helius), skipping for fungible token list.`);
          continue;
      }
      
      if (parsedInfo.mint && parsedInfo.tokenAmount && typeof parsedInfo.tokenAmount.amount === 'string' && parsedInfo.tokenAmount.amount !== "0") {
        const decimals = (typeof parsedInfo.tokenAmount.decimals === 'number' && !isNaN(parsedInfo.tokenAmount.decimals)) 
                         ? parsedInfo.tokenAmount.decimals 
                         : 0;
        
        let uiBalance: number;
        if (typeof parsedInfo.tokenAmount.uiAmount === 'number' && !isNaN(parsedInfo.tokenAmount.uiAmount)) {
          uiBalance = parsedInfo.tokenAmount.uiAmount;
        } else if (typeof parsedInfo.tokenAmount.uiAmountString === 'string') {
          uiBalance = parseFloat(parsedInfo.tokenAmount.uiAmountString);
          if (isNaN(uiBalance)) {
            console.warn(`[AssetLoader] parseFloat(uiAmountString) resulted in NaN for mint ${parsedInfo.mint}. uiAmountString: ${parsedInfo.tokenAmount.uiAmountString}. Falling back to raw calculation.`);
            uiBalance = Number(parsedInfo.tokenAmount.amount) / (10 ** decimals);
          }
        } else {
          uiBalance = Number(parsedInfo.tokenAmount.amount) / (10 ** decimals);
        }
        
        if (isNaN(uiBalance)) {
            console.warn(`[AssetLoader] Calculated uiBalance is NaN for mint ${parsedInfo.mint}. Raw amount: ${parsedInfo.tokenAmount.amount}, Decimals: ${decimals}. Skipping this token.`);
            continue;
        }
        
        console.log(`[AssetLoader] ADDING to tokenAccountInfoMap: Mint: ${parsedInfo.mint}, UI Balance: ${uiBalance}, Raw Balance: ${parsedInfo.tokenAmount.amount}, Decimals: ${decimals}, ATA: ${acc.pubkey.toBase58()}`);
        tokenAccountInfoMap.set(parsedInfo.mint, {
            mint: parsedInfo.mint,
            balance: uiBalance,
            rawBalance: BigInt(parsedInfo.tokenAmount.amount),
            decimals: decimals,
            tokenAccountAddress: acc.pubkey.toBase58(),
        });
      } else {
        console.log(`[AssetLoader] SKIPPING token account from tokenAccountInfoMap: Mint: ${parsedInfo.mint}, ATA: ${acc.pubkey.toBase58()}. Reason: parsedInfo.mint or parsedInfo.tokenAmount invalid, or raw amount is '0'. Raw amount: ${parsedInfo.tokenAmount?.amount}`);
      }
    } catch (e: any) {
      console.warn(`[AssetLoader] Failed to parse token account data for fungibles: ${acc.pubkey.toBase58()}`, e.message, e.stack);
    }
  }
  console.log(`[AssetLoader] tokenAccountInfoMap size (non-zero balance tokens): ${tokenAccountInfoMap.size}`);
  
  const mintsToFetchMeta = Array.from(tokenAccountInfoMap.keys());
  let allOwnerAssetsUmi: UmiDigitalAsset[] = [];

  if (mintsToFetchMeta.length > 0) {
    if (wallet.publicKey && wallet.connected && wallet.signTransaction) {
        umi.use(walletAdapterIdentity(wallet));
        console.log("[AssetLoader] UMI using wallet adapter identity for metadata fetch.");
    } else {
        console.log("[AssetLoader] UMI operating without wallet signer for metadata fetch (read-only).");
    }
    try {
        console.log(`[AssetLoader] Fetching UMI metadata for ${mintsToFetchMeta.length} mints.`);
        const umiOwnerUmiPublicKey = umi.eddsa.createPublicKey(ownerAddressString);
        allOwnerAssetsUmi = await fetchAllDigitalAssetByOwner(umi, umiOwnerUmiPublicKey);
        console.log(`[AssetLoader] UMI fetchAllDigitalAssetByOwner returned ${allOwnerAssetsUmi.length} assets. Data:`, JSON.stringify(allOwnerAssetsUmi.map(a => ({mint: a.mint.publicKey.toString(), name: a.metadata.name, uri: a.metadata.uri})), null, 2));
    } catch (e: any) {
        console.warn("[AssetLoader] UMI fetchAllDigitalAssetByOwner failed. Proceeding without UMI metadata for some/all tokens:", e.message, e.stack);
    }
  }

  const placeholderRawHeliusAsset = {} as HeliusAsset; 

  for (const [mint, accInfo] of tokenAccountInfoMap.entries()) {
    let name = `Token ${mint.substring(0, 6)}...`;
    let symbol = mint.substring(0, 4).toUpperCase();
    let imageUrl: string | undefined = undefined;
    let uri: string | undefined = undefined;

    const umiAsset = allOwnerAssetsUmi.find(ua => ua.mint.publicKey.toString() === mint);
    if (umiAsset) {
      console.log(`[AssetLoader] Found UMI metadata for mint: ${mint}, Name: ${umiAsset.metadata.name}`);
      name = umiAsset.metadata.name || name; // Use placeholder if UMI name is empty
      symbol = umiAsset.metadata.symbol || symbol; // Use placeholder if UMI symbol is empty
      uri = umiAsset.metadata.uri;
      if (uri) {
        fetchImageUrlFromMetadataUri(uri, umi).then(imgUrl => {
            if (imgUrl) {
                const existingToken = tokensMap.get(mint);
                if (existingToken) tokensMap.set(mint, {...existingToken, imageUrl: imgUrl });
            }
        }).catch(e => console.warn(`[AssetLoader] Background image fetch failed for ${mint} (${uri}): ${e.message}`));
      }
    } else {
        console.log(`[AssetLoader] No UMI metadata found for mint: ${mint}. Using placeholders.`);
    }
    
    console.log(`[AssetLoader] Adding to tokensMap: Mint: ${mint}, Name: ${name}, Symbol: ${symbol}, Balance: ${accInfo.balance}, Decimals: ${accInfo.decimals}`);
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
      tokenAccountAddress: accInfo.tokenAccountAddress,
      rawHeliusAsset: placeholderRawHeliusAsset, 
    });
  }
  const finalTokens = Array.from(tokensMap.values());
  console.log(`[AssetLoader] Final tokens count (from tokensMap.values()): ${finalTokens.length}`);
  console.log(`[AssetLoader] Asset fetch complete. NFTs: ${nfts.length}, cNFTs: ${cnfts.length}, Tokens: ${finalTokens.length}. Helius Warning: ${heliusWarning || 'None'}`);

  return { nfts, cnfts, tokens: finalTokens, heliusWarning };
}

    