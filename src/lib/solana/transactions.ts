
import {
  Connection,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  TransactionMessage,
  type TransactionInstruction, // Import TransactionInstruction type
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
import type { Nft, CNft, SplToken } from "@/types/solana";
import { 
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID, 
  createBurnInstruction as createBubblegumBurnInstruction,
  createTransferInstruction as createBubblegumTransferInstruction,
} from "@metaplex-foundation/mpl-bubblegum";
import { getHeliusAssetProof, type HeliusAssetProof } from "@/lib/helius";
import BN from "bn.js";

// Define these constants directly if import is problematic
const LOCAL_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJM2BzpA1RDAPn5pA");
const LOCAL_SPL_NOOP_PROGRAM_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");


// Helper to send transaction, now using VersionedTransaction
async function sendTransaction(
  instructions: TransactionInstruction[],
  connection: Connection,
  wallet: WalletContextState
): Promise<string> {
  // Capture wallet properties at start to avoid async changes
  const publicKey = wallet.publicKey;
  const signTransaction = wallet.signTransaction;
  
  if (!publicKey || !signTransaction) {
    throw new Error("Wallet not connected or doesn't support signing.");
  }

  // Additional validation for public key
  if (!(publicKey instanceof PublicKey)) {
    throw new Error("Invalid wallet public key. Expected instance of PublicKey.");
  }

  // Validate all instruction keys
  instructions.forEach((instruction, idx) => {
    if (!instruction.programId || !(instruction.programId instanceof PublicKey)) {
      throw new Error(`Instruction ${idx} has invalid or undefined programId.`);
    }
    
    instruction.keys.forEach((key, keyIdx) => {
      if (!key.pubkey || !(key.pubkey instanceof PublicKey)) {
        throw new Error(
          `Instruction ${idx} key ${keyIdx} has invalid or undefined pubkey: ${JSON.stringify(key)}`
        );
      }
    });
  });

  const latestBlockhash = await connection.getLatestBlockhash();
  
  // Ensure publicKey is still valid before creating message
  if (!wallet.publicKey) {
    throw new Error("Wallet public key became undefined before transaction message creation.");
  }

  const messageV0 = new TransactionMessage({
    payerKey: publicKey, // Use the captured publicKey
    recentBlockhash: latestBlockhash.blockhash,
    instructions: instructions,
  }).compileToV0Message();

  const versionedTransaction = new VersionedTransaction(messageV0);
  
  // Use the captured signTransaction
  const signedTransaction = await signTransaction(versionedTransaction); 
  
  const signature = await connection.sendTransaction(signedTransaction, {
    maxRetries: 5,
  });
  
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  }, "confirmed");

  if (confirmation.value.err) {
    console.error("Transaction confirmation error:", confirmation.value.err);
    throw new Error(`Transaction failed to confirm: ${JSON.stringify(confirmation.value.err)}`);
  }

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
  
  const instructions: TransactionInstruction[] = [];

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey, // Payer
        recipientAta,    // ATA
        recipientAddress, // Owner
        mintPublicKey     // Mint
      )
    );
  }
  
  instructions.push(
    createSplTransferInstruction(
      sourceAta,
      recipientAta,
      wallet.publicKey,
      1 // NFTs always have amount 1
    )
  );

  return sendTransaction(instructions, connection, wallet);
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
  
  const instructions: TransactionInstruction[] = [];

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        recipientAta,
        recipientAddress,
        mintPublicKey
      )
    );
  }

  instructions.push(
    createSplTransferInstruction(
      sourceAta,
      recipientAta,
      wallet.publicKey,
      rawAmount
    )
  );
  
  return sendTransaction(instructions, connection, wallet);
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

  const instructions: TransactionInstruction[] = [
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
  ];
  return sendTransaction(instructions, connection, wallet);
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
  
  const instructions: TransactionInstruction[] = [
    createSplBurnInstruction(
      ownerTokenAccount,
      mintPublicKey,
      wallet.publicKey,
      rawAmount
    )
  ];

  if (rawAmount === token.rawBalance) { // If burning entire balance, also close account
     instructions.push(
        createCloseAccountInstruction(
            ownerTokenAccount,    
            wallet.publicKey,     
            wallet.publicKey      
        )
     );
  }

  return sendTransaction(instructions, connection, wallet);
}


// Transfer cNFT (Compressed NFT)
export async function transferCNft(
  connection: Connection,
  wallet: WalletContextState,
  cnft: CNft,
  recipientAddress: PublicKey,
  rpcUrl: string
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error("Wallet not connected or doesn't support signing.");
  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing.");

  const assetProof = await getHeliusAssetProof(cnft.id, rpcUrl);
  if (!assetProof || !assetProof.root || !assetProof.proof) {
    throw new Error('Failed to retrieve valid asset proof from Helius for transfer (proof or root missing).');
  }
  if (assetProof.proof.some(p => !p)) {
    throw new Error('Invalid asset proof: contains undefined or null proof elements.');
  }
  if (!assetProof.proof.length && cnft.rawHeliusAsset.compression.tree !== SystemProgram.programId.toBase58()) { 
    // Only allow empty proof for certain "well-known" trees or if explicitly handled
    // For now, require proof if tree is not system program (which indicates no compression/special case)
    // This check might need adjustment based on specific cNFT standards or tree types
     console.warn("Asset proof is empty for non-system tree. This might be unexpected for standard cNFTs.", cnft.rawHeliusAsset.compression.tree);
     // Depending on strictness, you might throw an error here:
     // throw new Error('Asset proof is empty. This is usually required for cNFT operations.');
  }
  
  const { compression, ownership } = cnft.rawHeliusAsset;
  if (!compression || !compression.data_hash || !compression.creator_hash || !compression.tree) {
    throw new Error("Essential compression data (data_hash, creator_hash, or tree) is missing.");
  }

  const treeAccount = new PublicKey(compression.tree);
  const leafOwner = new PublicKey(ownership.owner); 
  const leafDelegate = ownership.delegate ? new PublicKey(ownership.delegate) : leafOwner;

  const anchorRemainingAccounts = assetProof.proof.map((p, idx) => {
    if (!p) throw new Error(`Proof element at index ${idx} is undefined.`); // Should be caught by earlier check
    return { pubkey: new PublicKey(p), isSigner: false, isWritable: false };
  });

  const transferInstruction = createBubblegumTransferInstruction(
    {
      treeAccount,
      leafOwner,
      leafDelegate,
      newLeafOwner: recipientAddress,
      merkleTree: treeAccount, 
      logWrapper: LOCAL_SPL_NOOP_PROGRAM_ID, 
      compressionProgram: LOCAL_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, 
      anchorRemainingAccounts: anchorRemainingAccounts,
    },
    {
      root: new PublicKey(assetProof.root).toBuffer(),
      dataHash: new PublicKey(compression.data_hash).toBuffer(),
      creatorHash: new PublicKey(compression.creator_hash).toBuffer(),
      nonce: new BN(cnft.compression.leafId),
      index: cnft.compression.leafId,
    }
  );

  const instructions: TransactionInstruction[] = [transferInstruction];
  return sendTransaction(instructions, connection, wallet);
}


// Burn cNFT (Compressed NFT)
export async function burnCNft(
  connection: Connection,
  wallet: WalletContextState,
  cnft: CNft,
  rpcUrl: string 
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error("Wallet not connected or doesn't support signing.");
  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing.");

  const assetProof = await getHeliusAssetProof(cnft.id, rpcUrl);
  if (!assetProof || !assetProof.root || !assetProof.proof) {
    throw new Error('Failed to retrieve valid asset proof from Helius for burn (proof or root missing).');
  }
  if (assetProof.proof.some(p => !p)) {
    throw new Error('Invalid asset proof: contains undefined or null proof elements.');
  }
   if (!assetProof.proof.length && cnft.rawHeliusAsset.compression.tree !== SystemProgram.programId.toBase58()) {
     console.warn("Asset proof is empty for non-system tree during burn.", cnft.rawHeliusAsset.compression.tree);
     // Potentially throw error here as well, similar to transferCNft
   }

  const { compression, ownership } = cnft.rawHeliusAsset;

  if (!compression || !compression.data_hash || !compression.creator_hash || !compression.tree) {
    throw new Error("Essential compression data (data_hash, creator_hash, or tree) is missing.");
  }
  
  const treeAccount = new PublicKey(compression.tree);
  const leafOwner =  new PublicKey(ownership.owner); 
  const leafDelegate = ownership.delegate ? new PublicKey(ownership.delegate) : leafOwner;

  const anchorRemainingAccounts = assetProof.proof.map((p, idx) => {
    if (!p) throw new Error(`Proof element at index ${idx} is undefined.`); // Should be caught by earlier check
    return { pubkey: new PublicKey(p), isSigner: false, isWritable: false };
  });

  const burnInstruction = createBubblegumBurnInstruction(
    {
      treeAccount,
      leafOwner,
      leafDelegate,
      merkleTree: treeAccount,
      logWrapper: LOCAL_SPL_NOOP_PROGRAM_ID, 
      compressionProgram: LOCAL_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, 
      anchorRemainingAccounts: anchorRemainingAccounts,
    },
    {
      root: new PublicKey(assetProof.root).toBuffer(),
      dataHash: new PublicKey(compression.data_hash).toBuffer(),
      creatorHash: new PublicKey(compression.creator_hash).toBuffer(),
      nonce: new BN(cnft.compression.leafId),
      index: cnft.compression.leafId,
    }
  );

  const instructions: TransactionInstruction[] = [burnInstruction];
  return sendTransaction(instructions, connection, wallet);
}

