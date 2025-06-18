
import type { SupportedSolanaNetwork } from "@/config";
// Removed direct import of WalletAdapterNetwork as we use string literals for comparison


const getExplorerUrl = (path: string, id: string, network: SupportedSolanaNetwork): string => {
  const base = "https://explorer.solana.com";
  // For devnet/testnet, cluster query param is needed. Mainnet doesn't strictly need it but doesn't hurt.
  // Using string literals for network comparison to avoid SSR issues.
  const clusterQuery = network === 'devnet' ? `?cluster=devnet` :
                       network === 'testnet' ? `?cluster=testnet` : ""; // Mainnet default if not devnet/testnet
  return `${base}/${path}/${id}${clusterQuery}`;
};

export const getTransactionExplorerUrl = (signature: string, network: SupportedSolanaNetwork): string => {
  return getExplorerUrl("tx", signature, network);
};

export const getAddressExplorerUrl = (address: string, network: SupportedSolanaNetwork): string => {
  return getExplorerUrl("address", address, network);
};

export const getAccountExplorerUrl = (address: string, network: SupportedSolanaNetwork): string => {
  return getExplorerUrl("account", address, network); 
};

