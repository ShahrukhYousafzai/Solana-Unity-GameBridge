
// This file can be removed if getHeliusAssetProof is moved or no longer needed.
// For now, assuming it might contain getHeliusAssetProof or other Helius-specific utilities.
// If getHeliusAssetProof was the only function and moved to asset-loader.ts, this file might be empty or deleted.

import { PublicKey } from "@solana/web3.js";

export interface HeliusAssetProof {
  root: string;
  proof: string[];
  leaf: string;
  tree_id: string;
  node_index: number;
}

const callHeliusApiForProof = async (rpcUrl: string, body: object): Promise<any> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (data.error) {
    let message = `Helius API Error (getAssetProof): ${data.error.message}`;
     const errorMessageLower = data.error.message?.toLowerCase();
    if (errorMessageLower?.includes("access forbidden") || errorMessageLower?.includes("unauthorized") || data.error.code === 403) {
      message += " This often indicates an issue with your Helius API key. Please ensure NEXT_PUBLIC_HELIUS_API_KEY is set correctly in your environment and is valid.";
    }
    throw new Error(message);
  }
  return data.result;
};

export const getHeliusAssetProof = async (assetId: string, rpcUrl: string): Promise<HeliusAssetProof | null> => {
  try {
    const result = await callHeliusApiForProof(rpcUrl, {
      jsonrpc: '2.0',
      id: 'solblaze-rpc-getAssetProof', // Unique ID for this call
      method: 'getAssetProof',
      params: { id: assetId },
    });
    if (!result || !result.root || !result.proof) {
      console.warn(`[HeliusUtil] No valid asset proof returned from Helius for asset ID: ${assetId}. Result:`, result);
      return null;
    }
    return result as HeliusAssetProof;
  } catch (error) {
    console.error(`[HeliusUtil] Error fetching Helius asset proof for ${assetId}:`, error);
    throw error; 
  }
};
