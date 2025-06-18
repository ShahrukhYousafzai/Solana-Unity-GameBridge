
// This is where the Helius API key is read from the environment variables.
// Ensure NEXT_PUBLIC_HELIUS_API_KEY is set in your .env.local file.
export const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY; 

// This is where the Custodial Wallet Address is read from environment variables.
// Ensure NEXT_PUBLIC_CUSTODIAL_WALLET_ADDRESS is set in your .env.local file.
export const CUSTODIAL_WALLET_ADDRESS = process.env.NEXT_PUBLIC_CUSTODIAL_WALLET_ADDRESS;
// Server-side private key for the custodial wallet.
// IMPORTANT: This should be set in your server environment variables, NOT prefixed with NEXT_PUBLIC_ for security.
// For local development, you can add it to .env.local (e.g., CUSTODIAL_WALLET_PRIVATE_KEY=your_base58_encoded_private_key)
// but ensure .env.local is in .gitignore and this key is managed securely in production.
export const CUSTODIAL_WALLET_PRIVATE_KEY_FOR_SERVER = process.env.CUSTODIAL_WALLET_PRIVATE_KEY;


export type SupportedSolanaNetwork = 'mainnet-beta' | 'devnet';

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
  console.warn(`Unsupported network ${network} with Helius API key. Falling back to public Mainnet RPC.`);
  return "https://api.mainnet-beta.solana.com";
};
