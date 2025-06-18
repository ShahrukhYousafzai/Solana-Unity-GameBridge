
import { NextResponse } from 'next/server';
import { Connection, PublicKey, Keypair, SystemProgram, TransactionMessage, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { getRpcUrl, type SupportedSolanaNetwork, WITHDRAWAL_TAX_PERCENTAGE } from '@/config';
import * as bs58 from 'bs58';


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      tokenMint, 
      userWalletAddress,
      grossAmount, // Renamed from netAmount to reflect it's the gross amount before tax
      tokenDecimals, 
      tokenProgramId, 
      network,
      isSolWithdrawal, 
    }: {
      tokenMint?: string;
      userWalletAddress: string;
      grossAmount: number; 
      tokenDecimals?: number;
      tokenProgramId?: string;
      network: SupportedSolanaNetwork;
      isSolWithdrawal?: boolean;
    } = body;

    if (!userWalletAddress || typeof grossAmount !== 'number' || grossAmount <= 0 || !network) {
      return NextResponse.json({ success: false, message: "Missing or invalid common parameters (userWalletAddress, grossAmount, network)." }, { status: 400 });
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
        const keyArray = JSON.parse(custodialWalletPrivateKeyString);
        if (Array.isArray(keyArray) && keyArray.every(num => typeof num === 'number')) {
          privateKeyBytes = Uint8Array.from(keyArray);
        } else {
          throw new Error("Parsed JSON is not an array of numbers.");
        }
      } catch (jsonError) {
        privateKeyBytes = bs58.decode(custodialWalletPrivateKeyString);
      }
      custodialKeypair = Keypair.fromSecretKey(privateKeyBytes);
    } catch (e: any) {
      console.error("Failed to derive Keypair from CUSTODIAL_WALLET_PRIVATE_KEY. Ensure it's a valid base58 string or a JSON string array of numbers representing bytes. Error:", e.message);
      return NextResponse.json({ success: false, message: "Server configuration error: Invalid custodial wallet private key format." }, { status: 500 });
    }

    const rpcUrl = getRpcUrl(network, process.env.NEXT_PUBLIC_HELIUS_API_KEY); 
    const connection = new Connection(rpcUrl, 'confirmed');
    const recipientPublicKey = new PublicKey(userWalletAddress);
    const instructions = [];

    let withdrawalTypeMessage: string;
    let netAmountToTransfer: number; // This will be in lamports for SOL, or raw token units for SPL

    // Calculate net amount after tax
    const taxRate = WITHDRAWAL_TAX_PERCENTAGE / 100;


    if (isSolWithdrawal) {
      // grossAmount is in SOL units from frontend bridge, convert to lamports first for tax calc
      const grossAmountLamports = Math.round(grossAmount * LAMPORTS_PER_SOL);
      const taxAmountLamports = Math.round(grossAmountLamports * taxRate);
      netAmountToTransfer = grossAmountLamports - taxAmountLamports;
      
      if (netAmountToTransfer <= 0) {
        return NextResponse.json({ success: false, message: "SOL withdrawal amount after tax is zero or negative." }, { status: 400 });
      }
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: custodialKeypair.publicKey,
          toPubkey: recipientPublicKey,
          lamports: BigInt(netAmountToTransfer),
        })
      );
      withdrawalTypeMessage = `Withdrawal of ${netAmountToTransfer / LAMPORTS_PER_SOL} SOL processed successfully.`;

    } else if (tokenMint && typeof tokenDecimals === 'number' && tokenProgramId) {
      // grossAmount is in token units from frontend bridge
      const taxAmountTokenUnits = grossAmount * taxRate;
      const netAmountTokenUnits = grossAmount - taxAmountTokenUnits;

      if (netAmountTokenUnits <= 0) {
        return NextResponse.json({ success: false, message: "Token withdrawal amount after tax is zero or negative." }, { status: 400 });
      }
      
      netAmountToTransfer = Math.round(netAmountTokenUnits * (10 ** tokenDecimals)); // Convert net token units to raw amount

      if (netAmountToTransfer <= 0) {
        return NextResponse.json({ success: false, message: "Token withdrawal raw amount after tax and decimal conversion is zero or negative." }, { status: 400 });
      }

      const mintPublicKey = new PublicKey(tokenMint);
      const splTokenProgramId = new PublicKey(tokenProgramId);
      
      const sourceAta = getAssociatedTokenAddressSync(mintPublicKey, custodialKeypair.publicKey, false, splTokenProgramId);
      const recipientAta = getAssociatedTokenAddressSync(mintPublicKey, recipientPublicKey, false, splTokenProgramId);

      const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
      if (!recipientAtaInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            custodialKeypair.publicKey, 
            recipientAta,
            recipientPublicKey, 
            mintPublicKey,
            splTokenProgramId
          )
        );
      }

      instructions.push(
        createTransferInstruction(
          sourceAta,
          recipientAta,
          custodialKeypair.publicKey, 
          BigInt(netAmountToTransfer),
          [],
          splTokenProgramId
        )
      );
      withdrawalTypeMessage = `Withdrawal of ${netAmountTokenUnits} of token ${tokenMint.substring(0,4)}... processed successfully.`;
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
    transaction.sign([custodialKeypair]); 

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
    if (error.logs) { 
      errorMessage += ` Logs: ${JSON.stringify(error.logs)}`;
    } else if (error.message) {
      errorMessage += ` Error: ${error.message}`;
    }
    return NextResponse.json({ success: false, message: errorMessage }, { status: 500 });
  }
}

    