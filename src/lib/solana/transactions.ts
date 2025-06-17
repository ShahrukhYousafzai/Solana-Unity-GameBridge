
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction as createSplTransferInstruction,
  createBurnInstruction as createSplBurnInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Asset, Nft, CNft, SplToken } from "@/types/solana";
import { 
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID, 
  createBurnInstruction as createBubblegumBurnInstruction,
  createTransferInstruction as createBubblegumTransferInstruction,
} from "@metaplex-foundation/mpl-bubblegum";
import {SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, SPL_NOOP_PROGRAM_ID} from "@solana/spl-account-compression";
import { getHeliusAssetProof } from "@/lib/helius";
import BN from "bn.js";

// Helper to send transaction
async function sendTransaction(
  transaction: Transaction,
  connection: Connection,
  wallet: WalletContextState
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error("Wallet not connected or doesn't support signing.");
  }
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;
  
  const signedTransaction = await wallet.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(
    signedTransaction.serialize()
  );
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}


// Transfer Standard NFT
export async function transferNft(
  connection: Connection,
  wallet: WalletContextState,
  nft: Nft,
  recipientAddress: PublicKey
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected.");

  const mintPublicKey = new PublicKey(nft.id);
  const sourceAta = getAssociatedTokenAddressSync(mintPublicKey, wallet.publicKey);
  
  const recipientAta = getAssociatedTokenAddressSync(mintPublicKey, recipientAddress);
  const transaction = new Transaction();

  // Check if recipient ATA exists, if not, create it
  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey, // Payer
        recipientAta,    // ATA
        recipientAddress, // Owner
        mintPublicKey     // Mint
      )
    );
  }
  
  transaction.add(
    createSplTransferInstruction(
      sourceAta,
      recipientAta,
      wallet.publicKey,
      1 // NFTs always have amount 1
    )
  );

  return sendTransaction(transaction, connection, wallet);
}

// Transfer SPL Token
export async function transferSplToken(
  connection: Connection,
  wallet: WalletContextState,
  token: SplToken,
  recipientAddress: PublicKey,
  amount: number // UI amount, not raw
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected.");

  const mintPublicKey = new PublicKey(token.id);
  const rawAmount = BigInt(Math.round(amount * (10 ** token.decimals)));

  const sourceAta = getAssociatedTokenAddressSync(mintPublicKey, wallet.publicKey);
  const recipientAta = getAssociatedTokenAddressSync(mintPublicKey, recipientAddress);
  const transaction = new Transaction();

  // Check if recipient ATA exists
  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        recipientAta,
        recipientAddress,
        mintPublicKey
      )
    );
  }

  transaction.add(
    createSplTransferInstruction(
      sourceAta,
      recipientAta,
      wallet.publicKey,
      rawAmount
    )
  );
  
  return sendTransaction(transaction, connection, wallet);
}

// Burn Standard NFT
export async function burnNft(
  connection: Connection,
  wallet: WalletContextState,
  nft: Nft
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected.");

  const mintPublicKey = new PublicKey(nft.id);
  const ownerTokenAccount = nft.tokenAddress ? new PublicKey(nft.tokenAddress) : getAssociatedTokenAddressSync(mintPublicKey, wallet.publicKey);

  const transaction = new Transaction().add(
    createSplBurnInstruction(
      ownerTokenAccount, // account to burn from
      mintPublicKey,     // mint
      wallet.publicKey,  // owner
      1                  // amount
    ),
    createCloseAccountInstruction(
      ownerTokenAccount,    // account to close
      wallet.publicKey,     // destination (refund lamports to)
      wallet.publicKey      // owner of account to close
    )
  );
  return sendTransaction(transaction, connection, wallet);
}

// Burn SPL Token
export async function burnSplToken(
  connection: Connection,
  wallet: WalletContextState,
  token: SplToken,
  amount: number // UI amount
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected.");

  const mintPublicKey = new PublicKey(token.id);
  const rawAmount = BigInt(Math.round(amount * (10 ** token.decimals)));
  const ownerTokenAccount = token.tokenAddress ? new PublicKey(token.tokenAddress) : getAssociatedTokenAddressSync(mintPublicKey, wallet.publicKey);
  
  const transaction = new Transaction().add(
    createSplBurnInstruction(
      ownerTokenAccount,
      mintPublicKey,
      wallet.publicKey,
      rawAmount
    )
  );
  if (rawAmount === token.rawBalance) {
     transaction.add(
        createCloseAccountInstruction(
            ownerTokenAccount,    
            wallet.publicKey,     
            wallet.publicKey      
        )
     );
  }

  return sendTransaction(transaction, connection, wallet);
}


// Transfer cNFT (Compressed NFT)
export async function transferCNft(
  connection: Connection,
  wallet: WalletContextState,
  cnft: CNft,
  recipientAddress: PublicKey,
  rpcUrl: string // Pass rpcUrl for Helius calls
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error("Wallet not connected or doesn't support signing.");
  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing.");

  const assetProof = await getHeliusAssetProof(cnft.id, rpcUrl);
  
  const { compression, creators, ownership } = cnft.rawHeliusAsset;
  if (!compression.data_hash || !compression.creator_hash || !compression.tree) {
    throw new Error("Essential compression data (data_hash, creator_hash, or tree) is missing.");
  }

  const treeAccount = new PublicKey(compression.tree);
  const leafOwner = new PublicKey(ownership.owner); // Should be wallet.publicKey
  const leafDelegate = ownership.delegate ? new PublicKey(ownership.delegate) : leafOwner;

  const transferInstruction = createBubblegumTransferInstruction(
    {
      treeAccount,
      leafOwner,
      leafDelegate,
      newLeafOwner: recipientAddress,
      merkleTree: treeAccount, 
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      anchorRemainingAccounts: assetProof.proof.map(p => ({ pubkey: new PublicKey(p), isSigner: false, isWritable: false })),
    },
    {
      root: new PublicKey(assetProof.root).toBuffer(),
      dataHash: new PublicKey(compression.data_hash).toBuffer(),
      creatorHash: new PublicKey(compression.creator_hash).toBuffer(),
      nonce: new BN(cnft.compression.leafId),
      index: cnft.compression.leafId,
    }
  );

  const transaction = new Transaction().add(transferInstruction);
  return sendTransaction(transaction, connection, wallet);
}


// Burn cNFT (Compressed NFT)
export async function burnCNft(
  connection: Connection,
  wallet: WalletContextState,
  cnft: CNft,
  rpcUrl: string // Pass rpcUrl for Helius calls
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error("Wallet not connected or doesn't support signing.");
  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing.");

  const assetProof = await getHeliusAssetProof(cnft.id, rpcUrl);
  const { compression, ownership } = cnft.rawHeliusAsset;

  if (!compression.data_hash || !compression.creator_hash || !compression.tree) {
    throw new Error("Essential compression data (data_hash, creator_hash, or tree) is missing.");
  }
  
  const treeAccount = new PublicKey(compression.tree);
  const leafOwner =  new PublicKey(ownership.owner); // Should be wallet.publicKey
  const leafDelegate = ownership.delegate ? new PublicKey(ownership.delegate) : leafOwner;


  const burnInstruction = createBubblegumBurnInstruction(
    {
      treeAccount,
      leafOwner,
      leafDelegate,
      merkleTree: treeAccount,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      anchorRemainingAccounts: assetProof.proof.map(p => ({ pubkey: new PublicKey(p), isSigner: false, isWritable: false })),
    },
    {
      root: new PublicKey(assetProof.root).toBuffer(),
      dataHash: new PublicKey(compression.data_hash).toBuffer(),
      creatorHash: new PublicKey(compression.creator_hash).toBuffer(),
      nonce: new BN(cnft.compression.leafId),
      index: cnft.compression.leafId,
    }
  );

  const transaction = new Transaction().add(burnInstruction);
  return sendTransaction(transaction, connection, wallet);
}
