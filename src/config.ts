
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import type { SupportedSolanaNetwork as SupportedSolanaNetworkType } from "@solana/wallet-adapter-base";


export const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY; // Defaults to undefined if not set

export type SupportedSolanaNetwork = WalletAdapterNetwork.Mainnet | WalletAdapterNetwork.Devnet;

export const DEFAULT_NETWORK: SupportedSolanaNetwork = WalletAdapterNetwork.Mainnet;

export const getRpcUrl = (network: SupportedSolanaNetwork, apiKey: string | undefined): string => {
  if (!apiKey) {
    console.warn("Helius API key is not defined. Falling back to public RPCs, which might be rate-limited or less reliable.");
    if (network === WalletAdapterNetwork.Mainnet) return "https://api.mainnet-beta.solana.com";
    if (network === WalletAdapterNetwork.Devnet) return "https://api.devnet.solana.com";
    return "https://api.mainnet-beta.solana.com"; // Default fallback
  }
  if (network === WalletAdapterNetwork.Mainnet) {
    return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  if (network === WalletAdapterNetwork.Devnet) {
    return `https://devnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  // Fallback or throw error for unsupported networks if HELIUS_API_KEY is present
  console.warn(`Unsupported network ${network} with Helius API key. Falling back to public Mainnet RPC.`);
  return "https://api.mainnet-beta.solana.com";
};


