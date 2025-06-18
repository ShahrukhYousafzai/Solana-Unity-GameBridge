
import { NextResponse } from 'next/server';
import { Connection, PublicKey, Keypair, SystemProgram, TransactionMessage, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { getRpcUrl, type SupportedSolanaNetwork } from '@/config';
import * as bs58 from 'bs58';

// This API route is a server-side component.
// It securely accesses the CUSTODIAL_WALLET_PRIVATE_KEY environment variable.
// This private key MUST be set in your hosting environment's secrets/environment variables
// and should NEVER be exposed to the client-side.
// For local development, set it in .env.local (which should be in .gitignore).

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      tokenMint, // Optional: only for SPL token withdrawals
      userWalletAddress,
      netAmount, // For SPL tokens, this is token units; for SOL, this is LAMPORTS
      tokenDecimals, // Optional: only for SPL token withdrawals
      tokenProgramId, // Optional: only for SPL token withdrawals
      network,
      isSolWithdrawal, // Explicit flag for SOL withdrawal
    }: {
      tokenMint?: string;
      userWalletAddress: string;
      netAmount: number; // For SOL, this is in lamports; for SPL, it's token units.
      tokenDecimals?: number;
      tokenProgramId?: string;
      network: SupportedSolanaNetwork;
      isSolWithdrawal?: boolean;
    } = body;

    if (!userWalletAddress || typeof netAmount !== 'number' || netAmount <= 0 || !network) {
      return NextResponse.json({ success: false, message: "Missing or invalid common parameters (userWalletAddress, netAmount, network)." }, { status: 400 });
    }

    if (!isSolWithdrawal && (!tokenMint || typeof tokenDecimals !== 'number' || !tokenProgramId)) {
      return NextResponse.json({ success: false, message: "Missing token-specific parameters for SPL withdrawal (tokenMint, tokenDecimals, tokenProgramId)." }, { status: 400 });
    }


    const custodialWalletPrivateKeyString = process.env.CUSTODIAL_WALLET_PRIVATE_KEY;
    if (!custodialWalletPrivateKeyString) {
      console.error("CUSTODIAL_WALLET_PRIVATE_KEY environment variable is not set on the server.");
      return NextResponse.json({ success: false, message: "Server configuration error: Custodial wallet private key not configured." }, { status: 500 });
    }

    let custodialKeypair: Keypair;
    try {
      let privateKeyBytes: Uint8Array;
      try {
        // Attempt to parse as JSON array of numbers (e.g., from Solflare export)
        const keyArray = JSON.parse(custodialWalletPrivateKeyString);
        if (Array.isArray(keyArray) && keyArray.every(num => typeof num === 'number')) {
          privateKeyBytes = Uint8Array.from(keyArray);
        } else {
          throw new Error("Parsed JSON is not an array of numbers.");
        }
      } catch (jsonError) {
        // Fallback to base58 decoding if JSON parsing fails
        privateKeyBytes = bs58.decode(custodialWalletPrivateKeyString);
      }
      custodialKeypair = Keypair.fromSecretKey(privateKeyBytes);
    } catch (e: any) {
      console.error("Failed to derive Keypair from CUSTODIAL_WALLET_PRIVATE_KEY. Ensure it's a valid base58 string or a JSON string array of numbers representing bytes. Error:", e.message);
      return NextResponse.json({ success: false, message: "Server configuration error: Invalid custodial wallet private key format." }, { status: 500 });
    }

    const rpcUrl = getRpcUrl(network, process.env.NEXT_PUBLIC_HELIUS_API_KEY); // Can use Helius here too if server has access
    const connection = new Connection(rpcUrl, 'confirmed');
    const recipientPublicKey = new PublicKey(userWalletAddress);
    const instructions = [];

    let withdrawalTypeMessage: string;

    if (isSolWithdrawal) {
      // SOL Withdrawal - netAmount is already in lamports
      const lamportsToWithdraw = BigInt(netAmount);
      if (lamportsToWithdraw <= BigInt(0)) {
        return NextResponse.json({ success: false, message: "SOL withdrawal amount must be positive." }, { status: 400 });
      }
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: custodialKeypair.publicKey,
          toPubkey: recipientPublicKey,
          lamports: lamportsToWithdraw,
        })
      );
      withdrawalTypeMessage = `Withdrawal of ${Number(lamportsToWithdraw) / LAMPORTS_PER_SOL} SOL processed successfully.`;

    } else if (tokenMint && typeof tokenDecimals === 'number' && tokenProgramId) {
      // SPL Token Withdrawal - netAmount is in token units
      const mintPublicKey = new PublicKey(tokenMint);
      const splTokenProgramId = new PublicKey(tokenProgramId);
      // Convert netAmount (token units) to raw amount using tokenDecimals
      const rawAmount = BigInt(Math.round(netAmount * (10 ** tokenDecimals))); 

      if (rawAmount <= BigInt(0)) {
        return NextResponse.json({ success: false, message: "Token withdrawal amount must be positive." }, { status: 400 });
      }

      const sourceAta = getAssociatedTokenAddressSync(mintPublicKey, custodialKeypair.publicKey, false, splTokenProgramId);
      const recipientAta = getAssociatedTokenAddressSync(mintPublicKey, recipientPublicKey, false, splTokenProgramId);

      const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
      if (!recipientAtaInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            custodialKeypair.publicKey, // Payer for ATA creation
            recipientAta,
            recipientPublicKey, // Owner of the new ATA
            mintPublicKey,
            splTokenProgramId
          )
        );
      }

      instructions.push(
        createTransferInstruction(
          sourceAta,
          recipientAta,
          custodialKeypair.publicKey, // Authority to transfer from source (custodial wallet)
          rawAmount,
          [],
          splTokenProgramId
        )
      );
      withdrawalTypeMessage = `Withdrawal of ${netAmount} of token ${tokenMint.substring(0,4)}... processed successfully.`;
    } else {
       return NextResponse.json({ success: false, message: "Invalid withdrawal type or missing parameters." }, { status: 400 });
    }


    const latestBlockhash = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: custodialKeypair.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([custodialKeypair]); // Sign with the custodial wallet's keypair

    const signature = await connection.sendTransaction(transaction, { skipPreflight: false });
    await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    });

    return NextResponse.json({
      success: true,
      message: withdrawalTypeMessage,
      signature
    });

  } catch (error: any) {
    console.error("Error processing withdrawal:", error);
    let errorMessage = "Failed to process withdrawal.";
    if (error.logs) { // SendTransactionError might have logs
      errorMessage += ` Logs: ${JSON.stringify(error.logs)}`;
    } else if (error.message) {
      errorMessage += ` Error: ${error.message}`;
    }
    return NextResponse.json({ success: false, message: errorMessage }, { status: 500 });
  }
}
