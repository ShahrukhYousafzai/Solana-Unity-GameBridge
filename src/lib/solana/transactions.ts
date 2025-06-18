
import {
  Connection,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
  type AccountMeta,
  TransactionInstruction,
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
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from '@solana/spl-account-compression';
import { getHeliusAssetProof } from "@/lib/helius";
import BN from 'bn.js';
import * as bs58 from "bs58";


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
      console.error("Problematic instruction at index", idx, "due to programId:", JSON.stringify(instruction, null, 2));
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
    skipPreflight: false, // Default, explicit for clarity
    maxRetries: 0,      // Prevent internal retries with the same signature
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
      logs = await connection.getLogs(signature, { commitment: "confirmed" });
      console.error("Transaction logs:", logs);
    } catch (logError) {
      console.error("Failed to fetch transaction logs:", logError);
    }
    throw new Error(`Transaction failed to confirm: ${JSON.stringify(confirmation.value.err)}. Logs: ${logs && logs.logs ? JSON.stringify(logs.logs) : "Could not fetch logs."}`);
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

const mapProofForBubblegum = (assetProof: { proof: string[] }): AccountMeta[] => {
  if (!assetProof.proof || !Array.isArray(assetProof.proof)) {
    return [];
  }
  // Filter out any potentially problematic (empty or non-string) proof elements
  // This is a defensive measure, ideally Helius returns a clean proof.
  const validProofPubkeys = assetProof.proof.filter(p => typeof p === 'string' && p.trim() !== '');
  
  return validProofPubkeys.map((node) => ({
    pubkey: new PublicKey(node),
    isSigner: false,
    isWritable: false,
  }));
};


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

  if (!(BUBBLEGUM_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: BUBBLEGUM_PROGRAM_ID is not a valid PublicKey for transfer.");
  if (!(SPL_NOOP_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: SPL_NOOP_PROGRAM_ID is not a PublicKey for transfer.");
  if (!(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID instanceof PublicKey)) throw new Error("Critical: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID is not a PublicKey for transfer.");

  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing for transfer.");
  const { compression, ownership } = cnft.rawHeliusAsset;

  if (typeof compression.data_hash !== 'string' || !compression.data_hash.trim()) throw new Error("Compression data_hash missing/invalid.");
  if (typeof compression.creator_hash !== 'string' || !compression.creator_hash.trim()) throw new Error("Compression creator_hash missing/invalid.");
  if (typeof compression.leaf_id !== 'number') throw new Error("Compression leaf_id missing/invalid.");
  if (typeof ownership.owner !== 'string' || !ownership.owner.trim()) throw new Error("Ownership owner missing/invalid.");
  
  const assetProof = await getHeliusAssetProof(cnft.id, rpcUrl);
  if (!assetProof || typeof assetProof.root !== 'string' || !assetProof.root.trim() || typeof assetProof.tree_id !== 'string' || !assetProof.tree_id.trim()) {
    throw new Error('Failed to retrieve valid asset proof (root or tree_id missing/invalid).');
  }
  if (!assetProof.proof || !Array.isArray(assetProof.proof)) {
    // Helius might return an empty proof array for certain tree configurations (e.g. canopy depth 0)
    // or if the leaf is the root itself. The mapProofForBubblegum handles this.
    console.warn(`Asset proof for ${cnft.id} has no proof path array or is not an array. This might be valid for certain tree states.`);
  }


  const merkleTreeKey = new PublicKey(assetProof.tree_id);
  const currentLeafOwner = new PublicKey(ownership.owner);
  const currentLeafDelegate = ownership.delegate ? new PublicKey(ownership.delegate) : currentLeafOwner;

  const [treeAuthority, _bump] = PublicKey.findProgramAddressSync(
    [merkleTreeKey.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );

  const proofPathAsAccounts = mapProofForBubblegum(assetProof);

  const transferInstruction = createBubblegumTransferInstruction({
    treeAuthority: treeAuthority,
    leafOwner: currentLeafOwner,
    leafDelegate: currentLeafDelegate,
    newLeafOwner: recipientAddress,
    merkleTree: merkleTreeKey,
    logWrapper: SPL_NOOP_PROGRAM_ID,
    compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    anchorRemainingAccounts: proofPathAsAccounts,
  }, {
    root: bs58.decode(assetProof.root),
    dataHash: bs58.decode(compression.data_hash),
    creatorHash: bs58.decode(compression.creator_hash),
    nonce: new BN(compression.leaf_id),
    index: compression.leaf_id,
  });
  
  // Defensive assignment of programId if SDK fails to set it (should not be necessary with current SDK versions)
  if (!transferInstruction.programId || !(transferInstruction.programId instanceof PublicKey)) {
     console.warn("SDK's createBubblegumTransferInstruction might not have set programId correctly. Manually setting to BUBBLEGUM_PROGRAM_ID.");
     transferInstruction.programId = BUBBLEGUM_PROGRAM_ID;
  }

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

  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing for burn.");
  const { compression, ownership } = cnft.rawHeliusAsset;

  if (typeof compression.data_hash !== 'string' || !compression.data_hash.trim()) throw new Error("Compression data_hash missing/invalid for burn.");
  if (typeof compression.creator_hash !== 'string' || !compression.creator_hash.trim()) throw new Error("Compression creator_hash missing/invalid for burn.");
  if (typeof compression.leaf_id !== 'number') throw new Error("Compression leaf_id missing/invalid for burn.");
  if (typeof ownership.owner !== 'string' || !ownership.owner.trim()) throw new Error("Ownership owner missing/invalid for burn.");

  const assetProof = await getHeliusAssetProof(cnft.id, rpcUrl);
  if (!assetProof || typeof assetProof.root !== 'string' || !assetProof.root.trim() || typeof assetProof.tree_id !== 'string' || !assetProof.tree_id.trim()) {
    throw new Error('Failed to retrieve valid asset proof for burn (root or tree_id missing/invalid).');
  }
   if (!assetProof.proof || !Array.isArray(assetProof.proof)) {
    console.warn(`Asset proof for burn operation on ${cnft.id} has no proof path array or is not an array.`);
  }

  const merkleTreeKey = new PublicKey(assetProof.tree_id);
  const currentLeafOwner = new PublicKey(ownership.owner);
  const currentLeafDelegate = ownership.delegate ? new PublicKey(ownership.delegate) : currentLeafOwner;

  const [treeAuthority, _bump] = PublicKey.findProgramAddressSync(
    [merkleTreeKey.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );
  
  const proofPathAsAccounts = mapProofForBubblegum(assetProof);

  const burnInstruction = createBubblegumBurnInstruction({
    treeAuthority: treeAuthority,
    leafOwner: currentLeafOwner,
    leafDelegate: currentLeafDelegate,
    merkleTree: merkleTreeKey,
    logWrapper: SPL_NOOP_PROGRAM_ID,
    compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    anchorRemainingAccounts: proofPathAsAccounts,
  }, {
    root: bs58.decode(assetProof.root),
    dataHash: bs58.decode(compression.data_hash),
    creatorHash: bs58.decode(compression.creator_hash),
    nonce: new BN(compression.leaf_id),
    index: compression.leaf_id,
  });

  if (!burnInstruction.programId || !(burnInstruction.programId instanceof PublicKey)) {
    console.warn("SDK's createBubblegumBurnInstruction might not have set programId correctly. Manually setting to BUBBLEGUM_PROGRAM_ID.");
    burnInstruction.programId = BUBBLEGUM_PROGRAM_ID;
  }

  const instructions: TransactionInstruction[] = [burnInstruction];
  return sendTransaction(instructions, connection, wallet);
}
