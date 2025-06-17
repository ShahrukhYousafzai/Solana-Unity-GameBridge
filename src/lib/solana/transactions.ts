
import {
  Connection,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
  type AccountMeta,
  TransactionInstruction, // Ensure this is statically imported
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
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID_SDK, // Renamed to avoid conflict if we define BUBBLEGUM_PROGRAM_ID locally
  createBurnInstruction as createBubblegumBurnInstruction,
  // createTransferInstruction as createBubblegumTransferInstructionSdk, // Keep commented if using manual
} from "@metaplex-foundation/mpl-bubblegum";
import { 
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, 
  SPL_NOOP_PROGRAM_ID 
} from '@solana/spl-account-compression';
import { getHeliusAssetProof, type HeliusAssetProof } from "@/lib/helius";
import BN from 'bn.js';
import { serialize } from 'borsh';

// Use the imported BUBBLEGUM_PROGRAM_ID from the SDK
const BUBBLEGUM_PROGRAM_ID = new PublicKey(BUBBLEGUM_PROGRAM_ID_SDK.toBase58());


// Bubblegum Transfer Args Structure (as expected by the on-chain program)
class TransferArgs {
  root: Uint8Array;
  dataHash: Uint8Array;
  creatorHash: Uint8Array;
  nonce: BN;
  index: number;

  constructor(fields: {
    root: Uint8Array;
    dataHash: Uint8Array;
    creatorHash: Uint8Array;
    nonce: BN;
    index: number;
  }) {
    this.root = fields.root;
    this.dataHash = fields.dataHash;
    this.creatorHash = fields.creatorHash;
    this.nonce = fields.nonce;
    this.index = fields.index;
  }
}

// Borsh schema for TransferArgs
const transferSchema = new Map<any, any>([
  [
    TransferArgs,
    {
      kind: "struct",
      fields: [
        ["root", [32]],
        ["dataHash", [32]],
        ["creatorHash", [32]],
        ["nonce", "u64"], 
        ["index", "u32"],
      ],
    },
  ],
]);

// Discriminator for the "transfer" instruction in Bubblegum program
// This is sha256("global:transfer").slice(0, 8)
const BUBBLEGUM_TRANSFER_INSTRUCTION_DISCRIMINATOR = Buffer.from([208, 122, 164, 231, 204, 200, 182, 13]);

function createManualBubblegumTransferInstruction({
  treeConfig,
  leafOwner,
  leafDelegate,
  newLeafOwner,
  merkleTree,
  logWrapper,
  compressionProgram,
  systemProgram,
  root,
  dataHash,
  creatorHash,
  nonce,
  index,
  proofPath,
}: {
  treeConfig: PublicKey;
  leafOwner: PublicKey; 
  leafDelegate: PublicKey; 
  newLeafOwner: PublicKey; 
  merkleTree: PublicKey;
  logWrapper: PublicKey;
  compressionProgram: PublicKey;
  systemProgram: PublicKey;
  root: Uint8Array;
  dataHash: Uint8Array;
  creatorHash: Uint8Array;
  nonce: BN;
  index: number;
  proofPath: AccountMeta[]; 
}): TransactionInstruction {
  const args = new TransferArgs({ root, dataHash, creatorHash, nonce, index });
  const serializedArgs = serialize(transferSchema, args);
  const instructionData = Buffer.concat([BUBBLEGUM_TRANSFER_INSTRUCTION_DISCRIMINATOR, serializedArgs]);

  const keys: AccountMeta[] = [
    { pubkey: treeConfig, isSigner: false, isWritable: true },
    { pubkey: leafOwner, isSigner: true, isWritable: true }, // leafOwner is a signer and mutable
    { pubkey: leafDelegate, isSigner: false, isWritable: false }, // delegate can be owner if no explicit delegate
    { pubkey: newLeafOwner, isSigner: false, isWritable: false },
    { pubkey: merkleTree, isSigner: false, isWritable: true }, // Merkle tree is mutable
    { pubkey: logWrapper, isSigner: false, isWritable: false },
    { pubkey: compressionProgram, isSigner: false, isWritable: false },
    { pubkey: systemProgram, isSigner: false, isWritable: false },
    ...proofPath,
  ];

  return new TransactionInstruction({
    keys,
    programId: BUBBLEGUM_PROGRAM_ID,
    data: instructionData,
  });
}


async function sendTransaction(
  instructions: TransactionInstruction[],
  connection: Connection,
  wallet: WalletContextState
): Promise<string> {
  const payerPublicKey = wallet.publicKey; 
  const signTransactionFn = wallet.signTransaction; 
  
  if (!payerPublicKey || !signTransactionFn) {
    throw new Error("Wallet not connected or doesn't support signing.");
  }
  if (!(payerPublicKey instanceof PublicKey)) {
    throw new Error("Invalid wallet public key. Expected instance of PublicKey.");
  }

  instructions.forEach((instruction, idx) => {
    if (!instruction.programId || !(instruction.programId instanceof PublicKey)) {
      console.error("Problematic instruction:", JSON.stringify(instruction, null, 2));
      throw new Error(`Instruction ${idx} has invalid or undefined programId.`);
    }
    instruction.keys.forEach((key, keyIdx) => {
      if (!key.pubkey || !(key.pubkey instanceof PublicKey)) {
         console.error(`Problematic key in instruction ${idx}, key ${keyIdx}:`, JSON.stringify(key, null, 2));
         console.error("Full instruction:", JSON.stringify(instruction, null, 2));
        throw new Error(
          `Instruction ${idx} key ${keyIdx} has invalid or undefined pubkey: ${JSON.stringify(key)}`
        );
      }
    });
  });

  const latestBlockhash = await connection.getLatestBlockhash();
  if (!latestBlockhash || !latestBlockhash.blockhash) {
    throw new Error("Failed to get recent blockhash from connection.");
  }
  
  const messageV0 = new TransactionMessage({
    payerKey: payerPublicKey, 
    recentBlockhash: latestBlockhash.blockhash,
    instructions: instructions,
  }).compileToV0Message();

  const versionedTransaction = new VersionedTransaction(messageV0);
  
  const signedTransaction = await signTransactionFn(versionedTransaction); 
  
  const signature = await connection.sendTransaction(signedTransaction, {
    maxRetries: 5,
    // skipPreflight: true, // Enable for debugging simulation errors, then disable for production
  });
  
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  }, "confirmed");

  if (confirmation.value.err) {
    console.error("Transaction confirmation error:", confirmation.value.err);
    let logs;
    try {
        logs = await connection.getLogs(signature);
        console.error("Transaction logs:", logs);
    } catch (logError) {
        console.error("Failed to fetch transaction logs:", logError);
    }
    throw new Error(`Transaction failed to confirm: ${JSON.stringify(confirmation.value.err)}. Logs: ${logs ? JSON.stringify(logs) : "Could not fetch logs."}`);
  }

  return signature;
}


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
      1 
    )
  );

  return sendTransaction(instructions, connection, wallet);
}

export async function transferSplToken(
  connection: Connection,
  wallet: WalletContextState,
  token: SplToken,
  recipientAddress: PublicKey,
  amount: number 
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
      ownerTokenAccount, 
      mintPublicKey,     
      ownerPublicKey,  
      1                  
    ),
    createCloseAccountInstruction(
      ownerTokenAccount,    
      ownerPublicKey,     
      ownerPublicKey      
    )
  ];
  return sendTransaction(instructions, connection, wallet);
}

export async function burnSplToken(
  connection: Connection,
  wallet: WalletContextState,
  token: SplToken,
  amount: number 
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
  if (!(SPL_NOOP_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: SPL_NOOP_PROGRAM_ID is not a PublicKey.");
  if (!(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID is not a PublicKey.");
  if (!(SystemProgram.programId instanceof PublicKey)) throw new Error("Critical: SystemProgram.programId is not a PublicKey.");

  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing for transfer.");
  const { compression, ownership } = cnft.rawHeliusAsset;
  if (!compression || typeof compression.data_hash !== 'string' || !compression.data_hash.trim() ||
      typeof compression.creator_hash !== 'string' || !compression.creator_hash.trim() || 
      typeof compression.leaf_id !== 'number') { 
    throw new Error("Essential compression data (data_hash, creator_hash, or leaf_id) is missing, invalid, or not of the expected type from rawHeliusAsset.");
  }
  if (typeof ownership.owner !== 'string' || !ownership.owner.trim()) {
    throw new Error("Essential ownership data (owner) is missing or invalid from rawHeliusAsset.");
  }

  const assetProof = await getHeliusAssetProof(cnft.id, rpcUrl);
  if (!assetProof || !assetProof.root || typeof assetProof.root !== 'string' || !assetProof.root.trim() ||
      !assetProof.proof || !Array.isArray(assetProof.proof) || assetProof.proof.length === 0 ) { 
    throw new Error('Failed to retrieve valid asset proof (root or proof array missing, empty, or invalid).');
  }
  if (typeof assetProof.tree_id !== 'string' || !assetProof.tree_id.trim()) {
    throw new Error('Asset proof contains an invalid or empty tree_id.');
  }
  const merkleTreeKey = new PublicKey(assetProof.tree_id);


  assetProof.proof.forEach((p, idx) => {
    if (typeof p !== 'string' || !p.trim()) {
      throw new Error(`Proof element at index ${idx} is invalid (not a non-empty string). Received: ${p}`);
    }
    try { new PublicKey(p); } catch (e) { throw new Error(`Proof element at index ${idx} ('${p}') is not a valid base58 public key string.`); }
  });
  
  const currentLeafOwner = new PublicKey(ownership.owner);
  const currentLeafDelegate = ownership.delegate ? new PublicKey(ownership.delegate) : currentLeafOwner;

  const [treeConfig] = PublicKey.findProgramAddressSync(
    [merkleTreeKey.toBuffer()], 
    BUBBLEGUM_PROGRAM_ID 
  );


  if (!(treeConfig instanceof PublicKey)) throw new Error("Failed to derive treeConfig PDA or it's not a PublicKey.");
  if (!(currentLeafOwner instanceof PublicKey)) throw new Error("currentLeafOwner is not a PublicKey.");
  if (!(currentLeafDelegate instanceof PublicKey)) throw new Error("currentLeafDelegate is not a PublicKey.");
  if (!(merkleTreeKey instanceof PublicKey)) throw new Error("merkleTreeKey is not a PublicKey.");


  const proofPathAccountMetas: AccountMeta[] = assetProof.proof.map((p) => ({
    pubkey: new PublicKey(p),
    isSigner: false,
    isWritable: false,
  }));

  const transferInstruction = createManualBubblegumTransferInstruction({
    treeConfig,
    leafOwner: currentLeafOwner, 
    leafDelegate: currentLeafDelegate,                                   
    newLeafOwner: recipientAddress,
    merkleTree: merkleTreeKey,
    logWrapper: SPL_NOOP_PROGRAM_ID,
    compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    systemProgram: SystemProgram.programId, 
    root: new PublicKey(assetProof.root).toBuffer(),
    dataHash: new PublicKey(compression.data_hash).toBuffer(),
    creatorHash: new PublicKey(compression.creator_hash).toBuffer(),
    nonce: new BN(compression.leaf_id), 
    index: compression.leaf_id,         
    proofPath: proofPathAccountMetas,
  });
  
  const instructions: TransactionInstruction[] = [transferInstruction];
  return sendTransaction(instructions, connection, wallet);
}


export async function burnCNft(
  connection: Connection,
  wallet: WalletContextState,
  cnft: CNft,
  rpcUrl: string 
): Promise<string> {
  const walletPublicKey = wallet.publicKey;

  if (!walletPublicKey) throw new Error("Wallet not connected for cNFT burn.");
  if (!(walletPublicKey instanceof PublicKey)) throw new Error("Invalid wallet public key. Expected instance of PublicKey for cNFT burn.");
  
  if (!(BUBBLEGUM_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: BUBBLEGUM_PROGRAM_ID is not a valid PublicKey for burn.");
  if (!(SPL_NOOP_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: SPL_NOOP_PROGRAM_ID is not a PublicKey for burn.");
  if (!(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID is not a PublicKey for burn.");
  if (!(SystemProgram.programId instanceof PublicKey)) throw new Error("Critical: SystemProgram.programId is not a PublicKey for burn.");

  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing for burn.");
  const { compression, ownership } = cnft.rawHeliusAsset;
   if (!compression || typeof compression.data_hash !== 'string' || !compression.data_hash.trim() ||
      typeof compression.creator_hash !== 'string' || !compression.creator_hash.trim() || 
      typeof compression.leaf_id !== 'number') { 
    throw new Error("Essential compression data (data_hash, creator_hash, or leaf_id) is missing, invalid, or not of the expected type from rawHeliusAsset for burn.");
  }

  const assetProof = await getHeliusAssetProof(cnft.id, rpcUrl);
  if (!assetProof || !assetProof.root || typeof assetProof.root !== 'string' || !assetProof.root.trim() ||
      !assetProof.proof || !Array.isArray(assetProof.proof) || assetProof.proof.length === 0 ) {
    throw new Error('Failed to retrieve valid asset proof for burn (root or proof array missing, empty, or invalid).');
  }
   if (typeof assetProof.tree_id !== 'string' || !assetProof.tree_id.trim()) {
    throw new Error('Asset proof contains an invalid or empty tree_id for burn.');
  }
  const merkleTreeKey = new PublicKey(assetProof.tree_id);


  assetProof.proof.forEach((p, idx) => {
     if (typeof p !== 'string' || !p.trim()) {
        throw new Error(`Proof element at index ${idx} is invalid (not a non-empty string). Received: ${p}`);
    }
    try { new PublicKey(p); } catch (e) { throw new Error(`Proof element at index ${idx} ('${p}') is not a valid base58 public key string for burn.`); }
  });

  const currentLeafOwner = new PublicKey(ownership.owner);
  const currentLeafDelegate = ownership.delegate ? new PublicKey(ownership.delegate) : currentLeafOwner;
  
  const [treeConfig] = PublicKey.findProgramAddressSync(
    [merkleTreeKey.toBuffer()], 
    BUBBLEGUM_PROGRAM_ID 
  );

  if (!(treeConfig instanceof PublicKey)) throw new Error("Failed to derive treeConfig PDA for burn or it's not a PublicKey.");
  if (!(currentLeafOwner instanceof PublicKey)) throw new Error("currentLeafOwner (burn) is not a PublicKey.");
  if (!(currentLeafDelegate instanceof PublicKey)) throw new Error("currentLeafDelegate (burn) is not a PublicKey.");
  if (!(merkleTreeKey instanceof PublicKey)) throw new Error("merkleTreeKey (burn) is not a PublicKey.");


  const proofPathAccountMetas: AccountMeta[] = assetProof.proof.map((p) => ({
    pubkey: new PublicKey(p),
    isSigner: false,
    isWritable: false,
  }));
  
  const burnInstructionAccounts = {
    treeAuthority: treeConfig, 
    leafOwner: currentLeafOwner, 
    leafDelegate: currentLeafDelegate, 
    merkleTree: merkleTreeKey,
    logWrapper: SPL_NOOP_PROGRAM_ID,
    compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    systemProgram: SystemProgram.programId, 
  };

  const burnInstructionArgs = {
    root: new PublicKey(assetProof.root).toBuffer(),
    dataHash: new PublicKey(compression.data_hash).toBuffer(),
    creatorHash: new PublicKey(compression.creator_hash).toBuffer(),
    nonce: new BN(compression.leaf_id),
    index: compression.leaf_id,
  };
  
  let burnInstruction = createBubblegumBurnInstruction(
    burnInstructionAccounts,
    burnInstructionArgs,
    proofPathAccountMetas 
  );
  
  if (!burnInstruction.programId || !(burnInstruction.programId instanceof PublicKey)) {
    console.warn("Warning: programId from createBubblegumBurnInstruction was invalid. Overwriting with BUBBLEGUM_PROGRAM_ID.");
    burnInstruction.programId = BUBBLEGUM_PROGRAM_ID;
  }

  const instructions: TransactionInstruction[] = [burnInstruction];
  return sendTransaction(instructions, connection, wallet);
}
