import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createBurnInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Asset, Nft, CNft, SplToken } from "@/types/solana";
import { PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,ผู้ชมcreateBurnInstruction as createBubblegumBurnInstruction } from "@metaplex-foundation/mpl-bubblegum";
import {SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, SPL_NOOP_PROGRAM_ID} from "@solana/spl-account-compression";

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
    createTransferInstruction(
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
    createTransferInstruction(
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
    createBurnInstruction(
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
  // Note: Burning the mint itself requires mint authority and is a separate step, typically not done by users.
  // The prompt "close account + burn mint" is ambitious. This implements burning the token and closing the ATA.
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
    createBurnInstruction(
      ownerTokenAccount,
      mintPublicKey,
      wallet.publicKey,
      rawAmount
    )
  );
  // If burning the entire balance, the ATA can be closed.
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


// Transfer cNFT (Compressed NFT) - Placeholder, requires Bubblegum SDK and Helius for proofs
export async function transferCNft(
  connection: Connection,
  wallet: WalletContextState,
  cnft: CNft,
  recipientAddress: PublicKey
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected.");
  // This is a complex transaction requiring:
  // 1. Fetching asset proof from Helius (getAssetProof RPC method).
  // 2. Building the transfer instruction using @metaplex-foundation/mpl-bubblegum.
  // Example structure:
  // const assetProof = await heliusGetAssetProof(cnft.id); // You'll need to implement this Helius call
  // const { compression, creators, ownership } = cnft.rawHeliusAsset;
  // if (!compression || !creators || !ownership) throw new Error("Missing cNFT data");
  //
  // const transferInstruction = createTransferInstruction({
  //   treeAccount: new PublicKey(compression.tree),
  //   leafOwner: wallet.publicKey,
  //   leafDelegate: wallet.publicKey, // Or actual delegate if set
  //   newLeafOwner: recipientAddress,
  //   merkleTree: new PublicKey(compression.tree),
  //   root: new PublicKey(assetProof.root),
  //   dataHash: new PublicKey(compression.data_hash),
  //   creatorHash: new PublicKey(compression.creator_hash),
  //   nonce: प्रमाण(compression.leaf_id), // leaf_id is the nonce (index)
  //   index: compression.leaf_id,
  //   // ... proofs from assetProof.proof
  // });
  // const transaction = new Transaction().add(transferInstruction);
  // return sendTransaction(transaction, connection, wallet);

  // For now, this is a placeholder.
  console.warn("cNFT transfer is complex and requires full Bubblegum integration with Helius proofs. This is a placeholder.");
  throw new Error("cNFT transfer not fully implemented yet. See Helius & Bubblegum docs.");
}


// Burn cNFT (Compressed NFT) - Placeholder, requires Bubblegum SDK and Helius for proofs
export async function burnCNft(
  connection: Connection,
  wallet: WalletContextState,
  cnft: CNft
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected.");
  // Similar to transfer, requires asset proof and Bubblegum's burn instruction.
  // Example structure:
  // const assetProof = await heliusGetAssetProof(cnft.id);
  // const { compression } = cnft.rawHeliusAsset;
  // if (!compression) throw new Error("Missing cNFT compression data");

  // const burnInstruction = createBubblegumBurnInstruction({
  //   treeAccount: new PublicKey(compression.tree),
  //   leafOwner: wallet.publicKey,
  //   leafDelegate: wallet.publicKey,
  //   merkleTree: new PublicKey(compression.tree),
  //   root: new PublicKey(assetProof.root),
  //   dataHash: new PublicKey(compression.data_hash),
  //   creatorHash: new PublicKey(compression.creator_hash),
  //   nonce: प्रमाण(compression.leaf_id),
  //   index: compression.leaf_id,
  //   // ... proofs from assetProof.proof
  // }, BUBBLEGUM_PROGRAM_ID);
  //
  // const transaction = new Transaction().add(burnInstruction);
  // return sendTransaction(transaction, connection, wallet);

  // For now, this is a placeholder.
  console.warn("cNFT burn is complex and requires full Bubblegum integration with Helius proofs. This is a placeholder.");
  throw new Error("cNFT burn not fully implemented yet. See Helius & Bubblegum docs.");
}
