
import {
  Connection,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
  type AccountMeta,
  TransactionInstruction,
  SendTransactionError, // Ensure this is imported
  type Commitment,
  Keypair,
  LAMPORTS_PER_SOL,
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
import type { SupportedSolanaNetwork } from "@/config";
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
import { CUSTODIAL_WALLET_ADDRESS, SOL_BURN_ADDRESS, SOL_DECIMALS, WITHDRAWAL_TAX_PERCENTAGE } from "@/config";

// UMI imports for NFT minting
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
// import {行为包gum} from '@metaplex-foundation/mpl-bubblegum'; // This seems to be a typo or non-English name, UMI typically uses English names for packages/modules
import { percentAmount, generateSigner, transactionBuilder, some } from '@metaplex-foundation/umi';


async function sendTransaction(
  instructions: TransactionInstruction[],
  connection: Connection,
  wallet: WalletContextState,
  signers?: Keypair[] // For UMI, signers are handled differently with transactionBuilder
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

    if (signers && signers.length > 0) {
      // This signing path is for traditional Keypair signers, UMI builder has its own signing.
      versionedTransaction.sign(signers);
    }

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
        if (Array.isArray(potentialLogs) && potentialLogs.every(l => typeof l === 'string')) {
          logsContent = potentialLogs as string[];
        } else if (potentialLogs !== null && potentialLogs !== undefined) {
          console.warn("[sendTransaction] error.getLogs() did not return an array of strings or null:", potentialLogs);
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
      1, // NFTs are non-fungible, amount is 1
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
  const tokenProgramPk = new PublicKey(token.tokenProgramId); // Use the specific program ID for the token
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
  // Get the ATA for the NFT. If nft.tokenAddress is not populated, fallback to calculating it.
  const ownerTokenAccount = nft.tokenAddress ? new PublicKey(nft.tokenAddress) : getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey, false, tokenProgramPk);


  const instructions: TransactionInstruction[] = [
    createSplBurnInstruction(
      ownerTokenAccount,
      mintPublicKey,
      ownerPublicKey,
      1, // Burn 1 unit for an NFT
      [],
      tokenProgramPk
    ),
    createCloseAccountInstruction( // Close the ATA after burning
      ownerTokenAccount,
      ownerPublicKey, // Destination for remaining lamports
      ownerPublicKey, // Authority to close
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
  const tokenProgramPk = new PublicKey(token.tokenProgramId); // Use the specific program ID
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

  // Optionally, close the ATA if the entire balance is burned
  // Check if the rawAmount to burn equals the token's rawBalance
  if (rawAmount === token.rawBalance) {
    instructions.push(
      createCloseAccountInstruction(
        ownerTokenAccount,
        ownerPublicKey, // Lamports destination
        ownerPublicKey, // Authority
        [],
        tokenProgramPk
      )
    );
  }
  console.log("[burnSplToken] Instructions prepared:", JSON.stringify(instructions.map(ix => ({programId: ix.programId.toBase58(), keys: ix.keys.map(k=>k.pubkey.toBase58())})), null, 2));
  return sendTransaction(instructions, connection, wallet);
}

// Helper for cNFT proof
const mapProofForBubblegum = (assetProof: { proof: string[] }): AccountMeta[] => {
  if (!assetProof.proof || !Array.isArray(assetProof.proof)) {
    console.warn("[BubblegumUtil] Asset proof is missing or not an array. Returning empty proof path.");
    return [];
  }
  // Filter out any empty strings or invalid pubkeys from the proof array
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
  rpcUrl: string // Helius RPC URL for fetching proof
): Promise<string> {
  const walletPublicKey = wallet.publicKey;

  if (!walletPublicKey) throw new Error("Wallet not connected for cNFT transfer.");
  if (!(walletPublicKey instanceof PublicKey)) throw new Error("Invalid wallet public key for cNFT transfer.");
  if (!(recipientAddress instanceof PublicKey)) throw new Error('Recipient address is not a valid PublicKey for cNFT transfer.');

  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing for transfer.");
  const { compression } = cnft.rawHeliusAsset;

  // Validate compression data fields
  if (typeof compression.data_hash !== 'string' || !compression.data_hash.trim()) throw new Error("Compression data_hash missing/invalid.");
  if (typeof compression.creator_hash !== 'string' || !compression.creator_hash.trim()) throw new Error("Compression creator_hash missing/invalid.");
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
    nonce: new BN(compression.leaf_id), // Bubblegum uses BN for nonce
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
  
  // Ensure programId is explicitly set if not by create instruction
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
  rpcUrl: string // Helius RPC URL for fetching proof
): Promise<string> {
  const walletPublicKey = wallet.publicKey;

  if (!walletPublicKey) throw new Error("Wallet not connected for cNFT burn.");
  if (!(walletPublicKey instanceof PublicKey)) throw new Error("Invalid wallet public key for cNFT burn.");

  if (!cnft.rawHeliusAsset.compression) throw new Error("cNFT compression data is missing for burn.");
  const { compression } = cnft.rawHeliusAsset;

  if (typeof compression.data_hash !== 'string' || !compression.data_hash.trim()) throw new Error("Compression data_hash missing/invalid for burn.");
  if (typeof compression.creator_hash !== 'string' || !compression.creator_hash.trim()) throw new Error("Compression creator_hash missing/invalid for burn.");
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

// Deposit SPL Token to Custodial Wallet
export async function depositSplToken(
  connection: Connection,
  wallet: WalletContextState,
  token: SplToken,
  amount: number,
  custodialWalletAddressString: string | undefined
): Promise<string> {
  const ownerPublicKey = wallet.publicKey;
  if (!ownerPublicKey) throw new Error("Wallet not connected for deposit.");
  if (!custodialWalletAddressString) throw new Error("Custodial wallet address not configured for deposit.");

  let custodialPublicKey: PublicKey;
  try {
    custodialPublicKey = new PublicKey(custodialWalletAddressString);
  } catch (e) {
    throw new Error("Invalid custodial wallet address format for deposit.");
  }

  const mintPublicKey = new PublicKey(token.id);
  const tokenProgramPk = new PublicKey(token.tokenProgramId);
  const rawAmount = BigInt(Math.round(amount * (10 ** token.decimals)));

  const sourceAta = getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey, false, tokenProgramPk);
  const recipientAta = getAssociatedTokenAddressSync(mintPublicKey, custodialPublicKey, false, tokenProgramPk);

  const instructions: TransactionInstruction[] = [];

  // Check if recipient ATA exists, create if not
  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        ownerPublicKey, // Payer for ATA creation
        recipientAta,
        custodialPublicKey, // Owner of the new ATA
        mintPublicKey,
        tokenProgramPk
      )
    );
  }

  instructions.push(
    createSplTransferInstruction(
      sourceAta,
      recipientAta,
      ownerPublicKey, // Authority to transfer from source
      rawAmount,
      [],
      tokenProgramPk
    )
  );
  console.log("[depositSplToken] Instructions prepared for deposit:", JSON.stringify(instructions.map(ix => ({programId: ix.programId.toBase58(), keys: ix.keys.map(k=>k.pubkey.toBase58())})), null, 2));
  return sendTransaction(instructions, connection, wallet);
}


export interface WithdrawalResponse {
  success: boolean;
  message: string;
  signature?: string;
}

// Used for both SPL Token and SOL withdrawals from Custodial Wallet
export async function initiateWithdrawalRequest(
  userWalletAddress: string,
  netAmount: number, // For SPL tokens, this is token units; for SOL, this is SOL units (after tax)
  currentNetwork: SupportedSolanaNetwork,
  token?: SplToken // Optional: only for SPL token withdrawals
): Promise<WithdrawalResponse> {
  console.log(`[initiateWithdrawalRequest] User ${userWalletAddress} requested withdrawal.`);
  console.log(`  Net Amount to User: ${netAmount} ${token ? token.symbol : 'SOL'}`);
  if (token) {
    console.log(`  Token Mint: ${token.id}, Decimals: ${token.decimals}, Program ID: ${token.tokenProgramId}`);
  }
  console.log(`  Network: ${currentNetwork}`);

  const payload: any = {
    userWalletAddress,
    netAmount, // This will be lamports for SOL, token units for SPL at API level
    network: currentNetwork,
  };

  if (token) { // SPL Token withdrawal
    payload.tokenMint = token.id;
    payload.tokenDecimals = token.decimals;
    payload.tokenProgramId = token.tokenProgramId;
    payload.isSolWithdrawal = false;
  } else { // SOL withdrawal
    // API expects netAmount in lamports for SOL
    payload.netAmount = Math.round(netAmount * LAMPORTS_PER_SOL); 
    payload.isSolWithdrawal = true;
  }

  try {
    const response = await fetch('/api/process-withdrawal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      // Use message from backend if available, otherwise provide a default
      return { success: false, message: result.message || `Backend withdrawal request failed with status: ${response.status}` };
    }
    return { success: true, message: result.message || "Withdrawal processed.", signature: result.signature };
  } catch (error: any) {
    console.error("Error calling /api/process-withdrawal:", error);
    return { success: false, message: `Frontend error initiating withdrawal: ${error.message}` };
  }
}

// Transfer SOL from user's wallet
export async function transferSol(
  connection: Connection,
  wallet: WalletContextState,
  recipientAddress: PublicKey,
  amountSol: number // Amount in SOL
): Promise<string> {
  const ownerPublicKey = wallet.publicKey;
  if (!ownerPublicKey) throw new Error("Wallet not connected for SOL transfer.");
  if (!(recipientAddress instanceof PublicKey)) {
    throw new Error('Recipient address is not a valid PublicKey instance for SOL transfer.');
  }

  const lamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));
  if (lamports <= BigInt(0)) {
    throw new Error("SOL transfer amount must be positive.");
  }

  const instructions: TransactionInstruction[] = [
    SystemProgram.transfer({
      fromPubkey: ownerPublicKey,
      toPubkey: recipientAddress,
      lamports: lamports,
    }),
  ];
  console.log(`[transferSol] Prepared SOL transfer of ${amountSol} SOL (${lamports} lamports) to ${recipientAddress.toBase58()}`);
  return sendTransaction(instructions, connection, wallet);
}

// Deposit SOL from user's wallet to Custodial Wallet
export async function depositSol(
  connection: Connection,
  wallet: WalletContextState,
  amountSol: number, // Amount in SOL
  custodialWalletAddressString: string | undefined
): Promise<string> {
  const ownerPublicKey = wallet.publicKey;
  if (!ownerPublicKey) throw new Error("Wallet not connected for SOL deposit.");
  if (!custodialWalletAddressString) throw new Error("Custodial wallet address not configured for SOL deposit.");

  let custodialPublicKey: PublicKey;
  try {
    custodialPublicKey = new PublicKey(custodialWalletAddressString);
  } catch (e) {
    throw new Error("Invalid custodial wallet address format for SOL deposit.");
  }

  const lamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));
  if (lamports <= BigInt(0)) {
    throw new Error("SOL deposit amount must be positive.");
  }

  const instructions: TransactionInstruction[] = [
    SystemProgram.transfer({
      fromPubkey: ownerPublicKey,
      toPubkey: custodialPublicKey,
      lamports: lamports,
    }),
  ];
  console.log(`[depositSol] Prepared SOL deposit of ${amountSol} SOL (${lamports} lamports) to custodial wallet ${custodialPublicKey.toBase58()}`);
  return sendTransaction(instructions, connection, wallet);
}

// "Burn" SOL by sending to incinerator address from user's wallet
export async function burnSol(
  connection: Connection,
  wallet: WalletContextState,
  amountSol: number // Amount in SOL
): Promise<string> {
  const ownerPublicKey = wallet.publicKey;
  if (!ownerPublicKey) throw new Error("Wallet not connected for SOL burn.");

  const burnAddressPublicKey = new PublicKey(SOL_BURN_ADDRESS);
  const lamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));
  if (lamports <= BigInt(0)) {
    throw new Error("SOL burn amount must be positive.");
  }

  const instructions: TransactionInstruction[] = [
    SystemProgram.transfer({
      fromPubkey: ownerPublicKey,
      toPubkey: burnAddressPublicKey,
      lamports: lamports,
    }),
  ];
  console.log(`[burnSol] Prepared SOL burn (transfer to ${SOL_BURN_ADDRESS}) of ${amountSol} SOL (${lamports} lamports)`);
  return sendTransaction(instructions, connection, wallet);
}


// Mint a new Standard NFT (using UMI)
export async function mintStandardNft(
  connection: Connection,
  wallet: WalletContextState,
  metadataUri: string,
  name: string,
  symbol: string
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Wallet not connected or does not support signing transactions.');
  }

  const umi = createUmi(connection.rpcEndpoint)
    .use(walletAdapterIdentity(wallet as any)) // Cast to any if WalletContextState is not directly compatible
    .use(mplTokenMetadata());

  const mint = generateSigner(umi);

  const txBuilder = transactionBuilder()
    .add(
      mplTokenMetadata.createV1(umi, {
        mint: mint,
        authority: umi.identity,
        name: name,
        symbol: symbol,
        uri: metadataUri,
        sellerFeeBasisPoints: percentAmount(5.5, 2), // Example 5.5% royalty
        isCollection: false,
        // tokenStandard: mplTokenMetadata.TokenStandard.NonFungible, // Default for createV1
      })
    );
  
  const { blockhash, lastValidBlockHeight } = await umi.rpc.getLatestBlockhash();
  let transaction = txBuilder.setFeePayer(umi.identity).toLegacyVersionedTransaction({
      blockhash,
      lastValidBlockHeight,
  });
  
  const signedTransaction = await wallet.signTransaction(transaction);
  
  const signatureBytes = await umi.rpc.sendTransaction(signedTransaction);
  const signature = bs58.encode(signatureBytes);

  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });

  console.log(`[mintStandardNft] NFT minted: ${mint.publicKey}. Signature: ${signature}`);
  return signature;
}

