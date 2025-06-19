
// This is where the Helius API key is read from the environment variables.
// Ensure NEXT_PUBLIC_HELIUS_API_KEY is set in your .env.local file.
export const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY;

// This is where the Custodial Wallet Address is read from environment variables.
// Ensure NEXT_PUBLIC_CUSTODIAL_WALLET_ADDRESS is set in your .env.local file.
export const CUSTODIAL_WALLET_ADDRESS = process.env.NEXT_PUBLIC_CUSTODIAL_WALLET_ADDRESS;

// Server-side private key for the custodial wallet.
// IMPORTANT: This should be set in your server environment variables (e.g., in .env.local for development,
// or in your hosting provider's secret management for production).
// It MUST NOT be prefixed with NEXT_PUBLIC_ for security.
// The API route /api/process-withdrawal/route.ts uses process.env.CUSTODIAL_WALLET_PRIVATE_KEY.
// Ensure this value (CUSTODIAL_WALLET_PRIVATE_KEY) is defined in your .env.local for local development,
// or as a secret in your production hosting environment.
export const CUSTODIAL_WALLET_PRIVATE_KEY_FOR_SERVER = process.env.CUSTODIAL_WALLET_PRIVATE_KEY;

// Base name for Unity WebGL build files.
// Ensure this matches your Unity "Product Name" when "Name Files As Hashes" is disabled.
// Unity will generate files like YourGameName.loader.js, YourGameName.data, etc.
export const UNITY_GAME_BUILD_BASE_NAME = process.env.NEXT_PUBLIC_UNITY_GAME_BUILD_BASE_NAME || "MyGame";

// Unity WebGL build configuration details for react-unity-webgl
export const UNITY_COMPANY_NAME = process.env.NEXT_PUBLIC_UNITY_COMPANY_NAME || "DefaultCompany";
export const UNITY_PRODUCT_NAME = process.env.NEXT_PUBLIC_UNITY_PRODUCT_NAME || UNITY_GAME_BUILD_BASE_NAME || "MyUnityGame";
export const UNITY_PRODUCT_VERSION = process.env.NEXT_PUBLIC_UNITY_PRODUCT_VERSION || "1.0";


export type SupportedSolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet';

export const DEFAULT_NETWORK: SupportedSolanaNetwork = 'devnet'; // Defaulting to devnet for easier testing

export const getRpcUrl = (network: SupportedSolanaNetwork, apiKey: string | undefined): string => {
  if (!apiKey) {
    console.warn("Helius API key is not defined. Falling back to public RPCs, which might be rate-limited or less reliable.");
    if (network === 'mainnet-beta') return "https://api.mainnet-beta.solana.com";
    if (network === 'devnet') return "https://api.devnet.solana.com";
    if (network === 'testnet') return "https://api.testnet.solana.com";
    return "https://api.devnet.solana.com"; // Default fallback
  }
  if (network === 'mainnet-beta') {
    return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  if (network === 'devnet') {
    return `https://devnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  if (network === 'testnet') {
    // Helius might not have a direct testnet RPC named 'testnet', often it's devnet.
    // Adjust if Helius provides a specific testnet endpoint. For now, falling back to public.
    console.warn("Helius Testnet RPC not explicitly configured, falling back to public testnet RPC.");
    return "https://api.testnet.solana.com";
  }
  console.warn(`Unsupported network ${network} with Helius API key. Falling back to public Devnet RPC.`);
  return "https://api.devnet.solana.com";
};

export const SOL_BURN_ADDRESS = "1nc1nerator11111111111111111111111111111111";
export const SOL_DECIMALS = 9;
export const WITHDRAWAL_TAX_PERCENTAGE = 5; // 5%

// The ALLOWED_WALLET_NAMES constant has been removed.
// The feature to restrict wallets via environment variable is no longer active.

