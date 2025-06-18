
import {
  Connection,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
  type AccountMeta,
  TransactionInstruction,
  type SendTransactionError, // Import SendTransactionError
  type Commitment,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction as createSplTransferInstruction,
  createBurnInstruction as createSplBurnInstruction,
  createCloseAccountInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID, 
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
import { fetchHeliusAssetProof } from "@/lib/asset-loader"; 
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
      throw new Error(`Instruction ${idx} has invalid or undefined programId: ${JSON.stringify(instruction.programId)}`);
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
  
  let signature: string = "";
  try {
    const latestBlockhash = await connection.getLatestBlockhash();
    if (!latestBlockhash || !latestBlockhash.blockhash) {
      throw new Error("Failed to get recent blockhash from connection for transaction.");
    }

    const messageV0 = new TransactionMessage({
      payerKey: payerPublicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: instructions,
    }).compileToV0Message();

    const versionedTransaction = new VersionedTransaction(messageV0);
    const signedTransaction = await signTransactionFn(versionedTransaction);
    
    console.log("[sendTransaction] Sending transaction with skipPreflight: false, maxRetries: 0");
    signature = await connection.sendTransaction(signedTransaction, {
      skipPreflight: false, 
      maxRetries: 0, 
    });
    console.log("[sendTransaction] Transaction sent, signature:", signature);

    console.log("[sendTransaction] Confirming transaction with signature:", signature);
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    }, "confirmed" as Commitment);
    console.log("[sendTransaction] Transaction confirmation result:", confirmation);


    if (confirmation.value.err) {
      console.error("[sendTransaction] Transaction confirmation error for signature", signature, ":", confirmation.value.err);
      let txLogs: string[] | null | undefined;
      try {
        const txResponse = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        txLogs = txResponse?.meta?.logMessages;
        console.error("[sendTransaction] Transaction logs from getTransaction:", txLogs);
      } catch (logError) {
        console.error("[sendTransaction] Failed to fetch transaction logs for failed confirmation:", logError);
      }
      throw new Error(`Transaction failed to confirm: ${JSON.stringify(confirmation.value.err)}. Logs: ${txLogs ? JSON.stringify(txLogs) : "Could not fetch logs."}`);
    }
    console.log("[sendTransaction] Transaction successfully confirmed:", signature);
    return signature;

  } catch (error: any) {
    let logsContent: string[] | null = null;

    if (error instanceof SendTransactionError) {
      logsContent = error.logs;
    } else if (typeof error.getLogs === 'function') {
      try {
        const potentialLogs = error.getLogs();
        if (Array.isArray(potentialLogs)) {
          logsContent = potentialLogs.filter((l: any) => typeof l === 'string');
        } else if (potentialLogs !== null && potentialLogs !== undefined) {
          console.warn("[sendTransaction] error.getLogs() did not return an array or null:", potentialLogs);
        }
      } catch (e) {
        console.warn("[sendTransaction] Failed to execute or process error.getLogs():", e);
      }
    }
    
    const errorMessage = `Transaction failed: ${error.message || JSON.stringify(error)}`;
    let logsMessage: string;

    if (logsContent && logsContent.length > 0) {
      logsMessage = `\nLogs:\n${logsContent.join('\n')}`;
    } else {
      logsMessage = '\n(No specific transaction logs available or logs were empty/not in expected array format)';
    }
    
    const fullError = errorMessage + logsMessage;
    console.error("[sendTransaction] Full error details:", fullError, "Original error object:", error);
    throw new Error(fullError);
  }
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
  const tokenProgramPk = TOKEN_PROGRAM_ID; // Standard NFTs use TOKEN_PROGRAM_ID

  const sourceAta = getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey, false, tokenProgramPk);
  const recipientAta = getAssociatedTokenAddressSync(mintPublicKey, recipientAddress, false, tokenProgramPk);

  const instructions: TransactionInstruction[] = [];

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        ownerPublicKey,
        recipientAta,
        recipientAddress,
        mintPublicKey,
        tokenProgramPk 
      )
    );
  }

  instructions.push(
    createSplTransferInstruction(
      sourceAta,
      recipientAta,
      ownerPublicKey,
      1, // Amount for NFTs is 1
      [],
      tokenProgramPk 
    )
  );
  console.log("[transferNft] Instructions prepared:", JSON.stringify(instructions.map(ix => ({programId: ix.programId.toBase58(), keys: ix.keys.map(k=>k.pubkey.toBase58())})), null, 2));
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
  const tokenProgramPk = new PublicKey(token.tokenProgramId); 
  const rawAmount = BigInt(Math.round(amount * (10 ** token.decimals)));

  const sourceAta = getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey, false, tokenProgramPk);
  const recipientAta = getAssociatedTokenAddressSync(mintPublicKey, recipientAddress, false, tokenProgramPk);

  const instructions: TransactionInstruction[] = [];

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        ownerPublicKey, 
        recipientAta,   
        recipientAddress, 
        mintPublicKey,  
        tokenProgramPk  
      )
    );
  }

  instructions.push(
    createSplTransferInstruction(
      sourceAta,
      recipientAta,
      ownerPublicKey,
      rawAmount,
      [],
      tokenProgramPk 
    )
  );
  console.log("[transferSplToken] Instructions prepared:", JSON.stringify(instructions.map(ix => ({programId: ix.programId.toBase58(), keys: ix.keys.map(k=>k.pubkey.toBase58())})), null, 2));
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
  const tokenProgramPk = TOKEN_PROGRAM_ID; // Standard NFTs use TOKEN_PROGRAM_ID
  const ownerTokenAccount = nft.tokenAddress ? new PublicKey(nft.tokenAddress) : getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey, false, tokenProgramPk);


  const instructions: TransactionInstruction[] = [
    createSplBurnInstruction(
      ownerTokenAccount,
      mintPublicKey,
      ownerPublicKey,
      1, // Amount for NFTs is 1
      [],
      tokenProgramPk 
    ),
    createCloseAccountInstruction(
      ownerTokenAccount,
      ownerPublicKey, 
      ownerPublicKey, 
      [],
      tokenProgramPk 
    )
  ];
  console.log("[burnNft] Instructions prepared:", JSON.stringify(instructions.map(ix => ({programId: ix.programId.toBase58(), keys: ix.keys.map(k=>k.pubkey.toBase58())})), null, 2));
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
  const tokenProgramPk = new PublicKey(token.tokenProgramId); 
  const rawAmount = BigInt(Math.round(amount * (10 ** token.decimals)));
  const ownerTokenAccount = token.tokenAddress ? new PublicKey(token.tokenAddress) : getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey, false, tokenProgramPk);

  const instructions: TransactionInstruction[] = [
    createSplBurnInstruction(
      ownerTokenAccount,
      mintPublicKey,
      ownerPublicKey,
      rawAmount,
      [],
      tokenProgramPk 
    )
  ];

  if (rawAmount === token.rawBalance) {
    instructions.push(
      createCloseAccountInstruction(
        ownerTokenAccount,
        ownerPublicKey, 
        ownerPublicKey, 
        [],
        tokenProgramPk 
      )
    );
  }
  console.log("[burnSplToken] Instructions prepared:", JSON.stringify(instructions.map(ix => ({programId: ix.programId.toBase58(), keys: ix.keys.map(k=>k.pubkey.toBase58())})), null, 2));
  return sendTransaction(instructions, connection, wallet);
}

const mapProofForBubblegum = (assetProof: { proof: string[] }): AccountMeta[] => {
  if (!assetProof.proof || !Array.isArray(assetProof.proof)) {
    console.warn("[BubblegumUtil] Asset proof is missing or not an array. Returning empty proof path.");
    return [];
  }
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
  if (!(walletPublicKey instanceof PublicKey)) throw new Error("Invalid wallet public key for cNFT transfer.");
  if (!(recipientAddress instanceof PublicKey)) throw new Error('Recipient address is not a valid PublicKey for cNFT transfer.');
  
  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing for transfer.");
  const { compression } = cnft.rawHeliusAsset;

  if (typeof compression.data_hash !== 'string' || !compression.data_hash.trim()) throw new Error("Compression data_hash missing/invalid.");
  if (typeof compression.creator_hash !== 'string' || !compression.creator_hash.trim()) throw new Error("Compression creator_hash missing/invalid.");
  // Leaf ID can be 0, so checking for typeof 'number' is correct.
  if (typeof compression.leaf_id !== 'number') throw new Error("Compression leaf_id missing/invalid (not a number).");
  
  const assetProof = await fetchHeliusAssetProof(cnft.id, rpcUrl);
  if (!assetProof || typeof assetProof.root !== 'string' || !assetProof.root.trim() || typeof assetProof.tree_id !== 'string' || !assetProof.tree_id.trim()) {
    throw new Error('Failed to retrieve valid asset proof (root or tree_id missing/invalid).');
  }

  const merkleTreeKey = new PublicKey(assetProof.tree_id);
  const [treeAuthority, _bump] = PublicKey.findProgramAddressSync(
    [merkleTreeKey.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );

  const proofPathAsAccounts = mapProofForBubblegum(assetProof);

  const transferArgs = {
    root: [...bs58.decode(assetProof.root)],
    dataHash: [...bs58.decode(compression.data_hash)],
    creatorHash: [...bs58.decode(compression.creator_hash)],
    nonce: new BN(compression.leaf_id), 
    index: compression.leaf_id, 
  };

  const transferInstructionAccounts = {
    treeAuthority: treeAuthority,
    leafOwner: walletPublicKey,
    leafDelegate: walletPublicKey, 
    newLeafOwner: recipientAddress,
    merkleTree: merkleTreeKey,
    logWrapper: SPL_NOOP_PROGRAM_ID,
    compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    anchorRemainingAccounts: proofPathAsAccounts,
  };
  
  const transferInstruction = createBubblegumTransferInstruction(transferInstructionAccounts, transferArgs);
  
  if (!transferInstruction.programId || !(transferInstruction.programId instanceof PublicKey)) {
     transferInstruction.programId = BUBBLEGUM_PROGRAM_ID;
  }

  const instructions: TransactionInstruction[] = [transferInstruction];
  console.log("[transferCNft] Instructions prepared:", JSON.stringify(instructions.map(ix => ({programId: ix.programId.toBase58(), keys: ix.keys.map(k=>k.pubkey.toBase58())})), null, 2));
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
  if (!(walletPublicKey instanceof PublicKey)) throw new Error("Invalid wallet public key for cNFT burn.");

  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing for burn.");
  const { compression } = cnft.rawHeliusAsset;

  if (typeof compression.data_hash !== 'string' || !compression.data_hash.trim()) throw new Error("Compression data_hash missing/invalid for burn.");
  if (typeof compression.creator_hash !== 'string' || !compression.creator_hash.trim()) throw new Error("Compression creator_hash missing/invalid for burn.");
  // Leaf ID can be 0, so checking for typeof 'number' is correct.
  if (typeof compression.leaf_id !== 'number') throw new Error("Compression leaf_id missing/invalid (not a number) for burn.");

  const assetProof = await fetchHeliusAssetProof(cnft.id, rpcUrl);
  if (!assetProof || typeof assetProof.root !== 'string' || !assetProof.root.trim() || typeof assetProof.tree_id !== 'string' || !assetProof.tree_id.trim()) {
    throw new Error('Failed to retrieve valid asset proof for burn (root or tree_id missing/invalid).');
  }

  const merkleTreeKey = new PublicKey(assetProof.tree_id);
  const [treeAuthority, _bump] = PublicKey.findProgramAddressSync(
    [merkleTreeKey.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );
  
  const proofPathAsAccounts = mapProofForBubblegum(assetProof);

  const burnArgs = {
    root: [...bs58.decode(assetProof.root)],
    dataHash: [...bs58.decode(compression.data_hash)],
    creatorHash: [...bs58.decode(compression.creator_hash)],
    nonce: new BN(compression.leaf_id), 
    index: compression.leaf_id, 
  };

  const burnInstructionAccounts = {
    treeAuthority: treeAuthority,
    leafOwner: walletPublicKey,
    leafDelegate: walletPublicKey, 
    merkleTree: merkleTreeKey,
    logWrapper: SPL_NOOP_PROGRAM_ID,
    compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    anchorRemainingAccounts: proofPathAsAccounts,
  };

  const burnInstruction = createBubblegumBurnInstruction(burnInstructionAccounts, burnArgs);

  if (!burnInstruction.programId || !(burnInstruction.programId instanceof PublicKey)) {
    burnInstruction.programId = BUBBLEGUM_PROGRAM_ID;
  }

  const instructions: TransactionInstruction[] = [burnInstruction];
  console.log("[burnCNft] Instructions prepared:", JSON.stringify(instructions.map(ix => ({programId: ix.programId.toBase58(), keys: ix.keys.map(k=>k.pubkey.toBase58())})), null, 2));
  return sendTransaction(instructions, connection, wallet);
}
