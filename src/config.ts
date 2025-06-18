
import type { WalletAdapterNetwork } from "@solana/wallet-adapter-base";

// This is where the Helius API key is read from the environment variables.
// Ensure NEXT_PUBLIC_HELIUS_API_KEY is set in your .env.local file.
export const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY; 

export type SupportedSolanaNetwork = 'mainnet-beta' | 'devnet'; // Using string literals for type safety

// Using string literal for DEFAULT_NETWORK to avoid SSR issues with enum access.
export const DEFAULT_NETWORK: SupportedSolanaNetwork = 'mainnet-beta';

export const getRpcUrl = (network: SupportedSolanaNetwork, apiKey: string | undefined): string => {
  if (!apiKey) {
    console.warn("Helius API key is not defined. Falling back to public RPCs, which might be rate-limited or less reliable.");
    if (network === 'mainnet-beta') return "https://api.mainnet-beta.solana.com";
    if (network === 'devnet') return "https://api.devnet.solana.com";
    return "https://api.mainnet-beta.solana.com"; // Default fallback
  }
  if (network === 'mainnet-beta') {
    return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  if (network === 'devnet') {
    return `https://devnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  // Fallback or throw error for unsupported networks if HELIUS_API_KEY is present
  console.warn(`Unsupported network ${network} with Helius API key. Falling back to public Mainnet RPC.`);
  return "https://api.mainnet-beta.solana.com";
};

