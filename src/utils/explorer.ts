import { SOLANA_CLUSTER } from "@/config";

const getExplorerUrl = (path: string, id: string): string => {
  const base = "https://explorer.solana.com";
  // For devnet/testnet, cluster query param is needed. Mainnet doesn't strictly need it.
  const clusterQuery = SOLANA_CLUSTER === "devnet" || SOLANA_CLUSTER === "testnet" ? `?cluster=${SOLANA_CLUSTER}` : "";
  return `${base}/${path}/${id}${clusterQuery}`;
};

export const getTransactionExplorerUrl = (signature: string): string => {
  return getExplorerUrl("tx", signature);
};

export const getAddressExplorerUrl = (address: string): string => {
  return getExplorerUrl("address", address);
};

export const getAccountExplorerUrl = (address: string): string => {
  return getExplorerUrl("account", address); // Often same as address, but context matters
};
