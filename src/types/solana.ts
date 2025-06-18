
export interface BaseAsset {
  id: string; // Mint address for NFTs/Tokens, ID for cNFTs
  name: string;
  symbol?: string;
  imageUrl?: string;
  type: 'nft' | 'cnft' | 'token';
  uri?: string; // metadata uri
  rawHeliusAsset: HeliusAsset; // Store raw asset for more details if needed
}

export interface Nft extends BaseAsset {
  type: 'nft';
  tokenAddress?: string; // Associated Token Account address
  collection?: { name: string, id: string }; // Collection mint address as id
  creators?: { address: string, verified: boolean, share: number }[];
  isVerifiedCollection?: boolean; 
}

export interface CNft extends BaseAsset {
  type: 'cnft';
  compression: {
    compressed: boolean;
    tree: string;
    leafId: number; 
  };
  collection?: { name: string, id: string }; // Collection mint address as id
  creators?: { address: string, verified: boolean, share: number }[];
  isVerifiedCollection?: boolean;
}

export interface SplToken extends BaseAsset {
  type: 'token';
  decimals: number;
  balance: number; // UI formatted balance
  rawBalance: bigint; // Raw balance as bigint
  tokenAddress?: string; // Associated Token Account address holding the balance
}

export type Asset = Nft | CNft | SplToken;

// Simplified Helius Asset type based on DAS API getAssetsByOwner
export interface HeliusAsset {
  id: string; // mint address or cNFT id
  interface: "V1_NFT" | "Custom" | "V1_PRINT" | "ProgrammableNFT" | "FungibleAsset" | "FungibleToken" | "IdentityNFT" | "ExecutableNFT" | "Inscription";
  content?: {
    json_uri: string;
    files?: { uri?: string; mime?: string; cdn_uri?: string }[];
    metadata: {
      name?: string;
      symbol?: string;
      description?: string;
      attributes?: { trait_type: string; value: string | number }[];
      [key: string]: any;
    };
    links?: {
      image?: string;
      external_url?: string;
      [key: string]: string | undefined;
    };
  };
  authorities?: { address: string; scopes: string[] }[];
  compression?: {
    eligible: boolean;
    compressed: boolean;
    data_hash: string;
    creator_hash: string;
    asset_hash: string;
    tree: string;
    seq: number;
    leaf_id: number;
  };
  grouping?: { group_key: string; group_value: string; verified?: boolean; collection_metadata?: any}[];
  royalty?: {
    royalty_model: "creators" | "fanout" | "single";
    target: string | null;
    percent: number;
    basis_points: number;
    primary_sale_happened: boolean;
    locked: boolean;
  };
  creators?: {
    address: string;
    share: number;
    verified: boolean;
  }[];
  ownership: {
    frozen: boolean;
    delegated: boolean;
    delegate: string | null;
    ownership_model: "single" | "token";
    owner: string;
    token_account?: string;
  };
  supply?: {
    print_max_supply: number;
    print_current_supply: number;
    edition_nonce: number | null;
  };
  mutable: boolean;
  burnt: boolean;
  token_info?: { 
    symbol?: string;
    balance: number; // This is already adjusted for decimals by Helius
    decimals: number;
    token_program?: string;
    price_info?: {
      price_per_token: number;
      total_price: number;
      currency: string;
    };
    raw_token_amount?: string; // Raw token amount (not factoring in decimals)
  };
  spl_token_info?: {
    token_account: string;
    balance: string; 
    decimals: number;
    mint: string;
  }
}

    