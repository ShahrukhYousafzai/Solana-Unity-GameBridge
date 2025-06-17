
import {
  Connection,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
  type TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction as createSplTransferInstruction,
  createBurnInstruction as createSplBurnInstruction,
  createCloseAccountInstruction,
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

// Define these constants directly
const LOCAL_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJM2BzpA1RDAPn5pA");
const LOCAL_SPL_NOOP_PROGRAM_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");


// Helper to send transaction, now using VersionedTransaction
async function sendTransaction(
  instructions: TransactionInstruction[],
  connection: Connection,
  wallet: WalletContextState
): Promise<string> {
  // Capture wallet properties at start to avoid async changes
  const payerPublicKey = wallet.publicKey;
  const signTransactionFn = wallet.signTransaction;
  
  if (!payerPublicKey || !signTransactionFn) {
    throw new Error("Wallet not connected or doesn't support signing.");
  }

  // Additional validation for public key
  if (!(payerPublicKey instanceof PublicKey)) {
    throw new Error("Invalid wallet public key. Expected instance of PublicKey.");
  }

  // Validate all instruction keys and programIds
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
  
  const messageV0 = new TransactionMessage({
    payerKey: payerPublicKey, 
    recentBlockhash: latestBlockhash.blockhash,
    instructions: instructions,
  }).compileToV0Message();

  const versionedTransaction = new VersionedTransaction(messageV0);
  
  const signedTransaction = await signTransactionFn(versionedTransaction); 
  
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
  const ownerPublicKey = wallet.publicKey;
  if (!ownerPublicKey) throw new Error("Wallet not connected.");
  if (!(recipientAddress instanceof PublicKey)) {
    throw new Error('Recipient address is not a valid PublicKey instance for NFT transfer.');
  }

  const mintPublicKey = new PublicKey(nft.id);
  const sourceAta = getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey);
  const recipientAta = getAssociatedTokenAddressSync(mintPublicKey, recipientAddress);
  
  const instructions: TransactionInstruction[] = [];

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        ownerPublicKey, // Payer
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
      ownerPublicKey,
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
  const ownerPublicKey = wallet.publicKey;
  if (!ownerPublicKey) throw new Error("Wallet not connected.");
  if (!(recipientAddress instanceof PublicKey)) {
    throw new Error('Recipient address is not a valid PublicKey instance for SPL token transfer.');
  }

  const mintPublicKey = new PublicKey(token.id);
  const rawAmount = BigInt(Math.round(amount * (10 ** token.decimals)));

  const sourceAta = getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey);
  const recipientAta = getAssociatedTokenAddressSync(mintPublicKey, recipientAddress);
  
  const instructions: TransactionInstruction[] = [];

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        ownerPublicKey,
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
      ownerPublicKey,
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
  const ownerPublicKey = wallet.publicKey;
  if (!ownerPublicKey) throw new Error("Wallet not connected.");

  const mintPublicKey = new PublicKey(nft.id);
  const ownerTokenAccount = nft.tokenAddress ? new PublicKey(nft.tokenAddress) : getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey);

  const instructions: TransactionInstruction[] = [
    createSplBurnInstruction(
      ownerTokenAccount, // account to burn from
      mintPublicKey,     // mint
      ownerPublicKey,  // owner
      1                  // amount
    ),
    createCloseAccountInstruction(
      ownerTokenAccount,    // account to close
      ownerPublicKey,     // destination (refund lamports to)
      ownerPublicKey      // owner of account to close
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
  const ownerPublicKey = wallet.publicKey;
  if (!ownerPublicKey) throw new Error("Wallet not connected.");

  const mintPublicKey = new PublicKey(token.id);
  const rawAmount = BigInt(Math.round(amount * (10 ** token.decimals)));
  const ownerTokenAccount = token.tokenAddress ? new PublicKey(token.tokenAddress) : getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey);
  
  const instructions: TransactionInstruction[] = [
    createSplBurnInstruction(
      ownerTokenAccount,
      mintPublicKey,
      ownerPublicKey,
      rawAmount
    )
  ];

  if (rawAmount === token.rawBalance) { 
     instructions.push(
        createCloseAccountInstruction(
            ownerTokenAccount,    
            ownerPublicKey,     
            ownerPublicKey      
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
  const walletPublicKey = wallet.publicKey; 

  if (!walletPublicKey) throw new Error("Wallet not connected for cNFT transfer.");
  if (!(walletPublicKey instanceof PublicKey)) throw new Error("Invalid wallet public key. Expected instance of PublicKey for cNFT transfer.");
  if (!(recipientAddress instanceof PublicKey)) throw new Error('Recipient address is not a valid PublicKey instance for cNFT transfer.');
  
  if (!(BUBBLEGUM_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: BUBBLEGUM_PROGRAM_ID is not a valid PublicKey.");
  if (!(LOCAL_SPL_NOOP_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: LOCAL_SPL_NOOP_PROGRAM_ID is not a PublicKey.");
  if (!(LOCAL_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: LOCAL_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID is not a PublicKey.");
  if (!(SystemProgram.programId instanceof PublicKey)) throw new Error("Critical: SystemProgram.programId is not a PublicKey.");

  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing for transfer.");

  const assetProof = await getHeliusAssetProof(cnft.id, rpcUrl);
  if (!assetProof || !assetProof.root || !assetProof.proof || assetProof.proof.length === 0 || !assetProof.tree_id) {
    throw new Error('Failed to retrieve valid asset proof from Helius for transfer (proof, root, tree_id missing, or proof array empty).');
  }
  if (typeof assetProof.tree_id !== 'string' || !assetProof.tree_id.trim()) {
    throw new Error('Asset proof contains an invalid tree_id.');
  }
  assetProof.proof.forEach((p, idx) => {
    if (typeof p !== 'string' || !p.trim()) {
      throw new Error(`Proof element at index ${idx} is invalid (not a non-empty string). Received: ${p}`);
    }
  });
  
  const { compression, ownership } = cnft.rawHeliusAsset;
  if (!compression || !compression.data_hash || !compression.creator_hash ) {
    throw new Error("Essential compression data (data_hash or creator_hash) is missing from rawHeliusAsset.");
  }
  if (typeof ownership.owner !== 'string' || !ownership.owner.trim()) {
    throw new Error("Essential ownership data (owner) is missing or invalid from rawHeliusAsset.");
  }
  if (ownership.delegate && (typeof ownership.delegate !== 'string' || !ownership.delegate.trim())) {
    throw new Error("Ownership delegate data is invalid (must be non-empty string if present) from rawHeliusAsset.");
  }

  const merkleTreeKey = new PublicKey(assetProof.tree_id); 
  const leafOwner = new PublicKey(ownership.owner); 
  const leafDelegate = ownership.delegate ? new PublicKey(ownership.delegate) : leafOwner;

  if (!(merkleTreeKey instanceof PublicKey)) throw new Error("merkleTreeKey (from proof tree_id) is not a PublicKey.");
  if (!(leafOwner instanceof PublicKey)) throw new Error("leafOwner is not a PublicKey.");
  if (!(leafDelegate instanceof PublicKey)) throw new Error("leafDelegate is not a PublicKey.");

  const [treeConfig] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata-token", "utf8"),
      BUBBLEGUM_PROGRAM_ID.toBuffer(),
      merkleTreeKey.toBuffer(),
    ],
    BUBBLEGUM_PROGRAM_ID
  );
  if (!(treeConfig instanceof PublicKey)) throw new Error("Failed to derive treeConfig PDA or it's not a PublicKey.");


  const anchorRemainingAccounts: AccountMeta[] = assetProof.proof.map((p) => {
    const pubkey = new PublicKey(p);
    return { pubkey, isSigner: false, isWritable: false };
  });

  const transferInstructionAccounts = {
    treeConfig,
    leafOwner, 
    leafDelegate, 
    newLeafOwner: recipientAddress,
    merkleTree: merkleTreeKey,
    logWrapper: LOCAL_SPL_NOOP_PROGRAM_ID,
    compressionProgram: LOCAL_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    systemProgram: SystemProgram.programId, 
  };
  
  const transferInstructionArgs = {
    root: new PublicKey(assetProof.root).toBuffer(),
    dataHash: new PublicKey(compression.data_hash).toBuffer(),
    creatorHash: new PublicKey(compression.creator_hash).toBuffer(),
    nonce: new BN(cnft.compression.leafId),
    index: cnft.compression.leafId,
  };

  let transferInstruction = createBubblegumTransferInstruction(
    transferInstructionAccounts,
    transferInstructionArgs,
    anchorRemainingAccounts 
  );
  
  if (!transferInstruction.programId || !(transferInstruction.programId instanceof PublicKey)) {
    console.warn("Warning: programId from createBubblegumTransferInstruction was invalid. Overwriting with BUBBLEGUM_PROGRAM_ID.");
    transferInstruction.programId = BUBBLEGUM_PROGRAM_ID;
  }

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
  const walletPublicKey = wallet.publicKey;

  if (!walletPublicKey) throw new Error("Wallet not connected for cNFT burn.");
  if (!(walletPublicKey instanceof PublicKey)) throw new Error("Invalid wallet public key. Expected instance of PublicKey for cNFT burn.");
  
  if (!(BUBBLEGUM_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: BUBBLEGUM_PROGRAM_ID from SDK is not a valid PublicKey.");
  if (!(LOCAL_SPL_NOOP_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: LOCAL_SPL_NOOP_PROGRAM_ID is not a PublicKey.");
  if (!(LOCAL_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: LOCAL_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID is not a PublicKey.");
  if (!(SystemProgram.programId instanceof PublicKey)) throw new Error("Critical: SystemProgram.programId is not a PublicKey.");

  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing for burn.");

  const assetProof = await getHeliusAssetProof(cnft.id, rpcUrl);
  if (!assetProof || !assetProof.root || !assetProof.proof || assetProof.proof.length === 0 || !assetProof.tree_id) {
    throw new Error('Failed to retrieve valid asset proof from Helius for burn (proof, root, tree_id missing, or proof array empty).');
  }
  if (typeof assetProof.tree_id !== 'string' || !assetProof.tree_id.trim()) {
    throw new Error('Asset proof contains an invalid tree_id for burn.');
  }
  assetProof.proof.forEach((p, idx) => {
     if (typeof p !== 'string' || !p.trim()) {
        throw new Error(`Proof element at index ${idx} is invalid (not a non-empty string). Received: ${p}`);
    }
  });

  const { compression, ownership } = cnft.rawHeliusAsset;

  if (!compression || !compression.data_hash || !compression.creator_hash ) {
    throw new Error("Essential compression data (data_hash or creator_hash) is missing from rawHeliusAsset for burn.");
  }
  if (typeof ownership.owner !== 'string' || !ownership.owner.trim()) {
    throw new Error("Essential ownership data (owner) is missing or invalid from rawHeliusAsset for burn.");
  }
  if (ownership.delegate && (typeof ownership.delegate !== 'string' || !ownership.delegate.trim())) {
    throw new Error("Ownership delegate data is invalid (must be non-empty string if present) from rawHeliusAsset for burn.");
  }
  
  const merkleTreeKey = new PublicKey(assetProof.tree_id); 
  const leafOwner =  new PublicKey(ownership.owner); 
  const leafDelegate = ownership.delegate ? new PublicKey(ownership.delegate) : leafOwner;

  if (!(merkleTreeKey instanceof PublicKey)) throw new Error("merkleTreeKey (from proof tree_id) is not a PublicKey for burn.");
  if (!(leafOwner instanceof PublicKey)) throw new Error("leafOwner is not a PublicKey for burn.");
  if (!(leafDelegate instanceof PublicKey)) throw new Error("leafDelegate is not a PublicKey for burn.");

  const [treeConfig] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata-token", "utf8"),
      BUBBLEGUM_PROGRAM_ID.toBuffer(),
      merkleTreeKey.toBuffer(),
    ],
    BUBBLEGUM_PROGRAM_ID
  );
  if (!(treeConfig instanceof PublicKey)) throw new Error("Failed to derive treeConfig PDA for burn or it's not a PublicKey.");


  const anchorRemainingAccounts: AccountMeta[] = assetProof.proof.map((p) => {
    const pubkey = new PublicKey(p);
    return { pubkey, isSigner: false, isWritable: false };
  });

  const burnInstructionAccounts = {
    treeConfig,
    leafOwner, 
    leafDelegate, 
    merkleTree: merkleTreeKey,
    logWrapper: LOCAL_SPL_NOOP_PROGRAM_ID,
    compressionProgram: LOCAL_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };

  const burnInstructionArgs = {
    root: new PublicKey(assetProof.root).toBuffer(),
    dataHash: new PublicKey(compression.data_hash).toBuffer(),
    creatorHash: new PublicKey(compression.creator_hash).toBuffer(),
    nonce: new BN(cnft.compression.leafId),
    index: cnft.compression.leafId,
  };
  
  let burnInstruction = createBubblegumBurnInstruction(
    burnInstructionAccounts,
    burnInstructionArgs,
    anchorRemainingAccounts
  );
  
  if (!burnInstruction.programId || !(burnInstruction.programId instanceof PublicKey)) {
    console.warn("Warning: programId from createBubblegumBurnInstruction was invalid. Overwriting with BUBBLEGUM_PROGRAM_ID.");
    burnInstruction.programId = BUBBLEGUM_PROGRAM_ID;
  }

  const instructions: TransactionInstruction[] = [burnInstruction];
  return sendTransaction(instructions, connection, wallet);
}
