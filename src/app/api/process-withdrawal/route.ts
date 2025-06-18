
import { NextResponse } from 'next/server';
import { Connection, PublicKey, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { getRpcUrl, type SupportedSolanaNetwork } from '@/config';
import * as bs58 from 'bs58';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      tokenMint, 
      userWalletAddress, 
      netAmount, // Amount user actually receives
      tokenDecimals, 
      tokenProgramId, 
      network 
    }: {
      tokenMint: string;
      userWalletAddress: string;
      netAmount: number;
      tokenDecimals: number;
      tokenProgramId: string;
      network: SupportedSolanaNetwork;
    } = body;

    if (!tokenMint || !userWalletAddress || typeof netAmount !== 'number' || netAmount <= 0 || typeof tokenDecimals !== 'number' || !tokenProgramId || !network) {
      return NextResponse.json({ success: false, message: "Missing or invalid parameters." }, { status: 400 });
    }

    const custodialWalletPrivateKeyBs58 = process.env.CUSTODIAL_WALLET_PRIVATE_KEY;
    if (!custodialWalletPrivateKeyBs58) {
      console.error("CUSTODIAL_WALLET_PRIVATE_KEY environment variable is not set.");
      return NextResponse.json({ success: false, message: "Server configuration error: Custodial wallet not configured." }, { status: 500 });
    }

    let custodialKeypair: Keypair;
    try {
      const privateKeyBytes = bs58.decode(custodialWalletPrivateKeyBs58);
      custodialKeypair = Keypair.fromSecretKey(privateKeyBytes);
    } catch (e) {
      console.error("Failed to decode or create Keypair from CUSTODIAL_WALLET_PRIVATE_KEY:", e);
      return NextResponse.json({ success: false, message: "Server configuration error: Invalid custodial wallet private key." }, { status: 500 });
    }
    
    const rpcUrl = getRpcUrl(network, process.env.NEXT_PUBLIC_HELIUS_API_KEY);
    const connection = new Connection(rpcUrl, 'confirmed');

    const mintPublicKey = new PublicKey(tokenMint);
    const recipientPublicKey = new PublicKey(userWalletAddress);
    const splTokenProgramId = new PublicKey(tokenProgramId);
    const rawAmount = BigInt(Math.round(netAmount * (10 ** tokenDecimals)));

    const sourceAta = getAssociatedTokenAddressSync(mintPublicKey, custodialKeypair.publicKey, false, splTokenProgramId);
    const recipientAta = getAssociatedTokenAddressSync(mintPublicKey, recipientPublicKey, false, splTokenProgramId);
    
    const instructions = [];

    // Check if recipient ATA exists, create if not
    const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
    if (!recipientAtaInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          custodialKeypair.publicKey, // Payer for ATA creation
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
        rawAmount,
        [],
        splTokenProgramId
      )
    );

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
      message: `Withdrawal of ${netAmount} ${tokenMint.substring(0,4)}... processed successfully.`, 
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
