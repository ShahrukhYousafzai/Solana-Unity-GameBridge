
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import dynamic from "next/dynamic";
import { fetchAssetsForOwner } from "@/lib/asset-loader";
import type { Asset, Nft, CNft, SplToken } from "@/types/solana";
import { useToast } from "@/hooks/use-toast";
import { getTransactionExplorerUrl } from "@/utils/explorer";
import {
  transferNft, transferSplToken, burnNft, burnSplToken,
  transferCNft, burnCNft, depositSplToken, initiateWithdrawalRequest,
  transferSol, depositSol, burnSol, type WithdrawalResponse, mintStandardNft
} from "@/lib/solana/transactions";
import { useNetwork } from "@/contexts/NetworkContext";
import type { SupportedSolanaNetwork } from "@/config";
import { NetworkSwitcher } from "@/components/NetworkSwitcher";
import { CUSTODIAL_WALLET_ADDRESS, SOL_DECIMALS, HELIUS_API_KEY } from "@/config";
import { Skeleton } from "@/components/ui/skeleton";

const ConnectWalletButton = dynamic(
  () => import("@/components/ConnectWalletButton").then((mod) => mod.ConnectWalletButton),
  {
    ssr: false,
    loading: () => <Skeleton className="h-10 w-32 rounded-md" />
  }
);

// Define the interface for the Unity Game Instance
interface UnityInstance {
  SendMessage: (gameObjectName: string, methodName: string, message: string | number | object) => void;
  SetFullscreen: (fullscreen: 0 | 1) => void;
  Quit?: () => Promise<void>;
  // Add other methods your Unity build might expose
}

declare global {
  interface Window {
    createUnityInstance: (
      canvas: HTMLElement,
      config: object,
      onProgress?: (progress: number) => void
    ) => Promise<UnityInstance>;
    unityInstance?: UnityInstance; // To store the created instance globally if needed
    unityBridge?: any; // The bridge object we are creating
    UnityGame?: { // For Unity to send messages back, if its template sets this up
      SendMessage: (gameObjectName: string, methodName: string, message: string | number | object) => void;
    };
  }
}

export default function HomePage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, sendTransaction, connected, connect: connectWalletAdapter, disconnect: disconnectWalletAdapter, select, signTransaction } = wallet;
  const { toast } = useToast();
  const { currentNetwork, setCurrentNetwork, rpcUrl } = useNetwork();

  const [nfts, setNfts] = useState<Nft[]>([]);
  const [cnfts, setCnfts] = useState<CNft[]>([]);
  const [tokens, setTokens] = useState<SplToken[]>([]);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);

  const allFetchedAssets = useMemo(() => [...nfts, ...cnfts, ...tokens], [nfts, cnfts, tokens]);

  const [unityInstance, setUnityInstance] = useState<UnityInstance | null>(null);
  const [isUnityLoading, setIsUnityLoading] = useState(true);
  const [unityLoadingProgress, setUnityLoadingProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sendToUnity = useCallback((gameObjectName: string, methodName: string, message: any) => {
    const msgStr = typeof message === 'object' ? JSON.stringify(message) : String(message);
    // Prefer using the specific unityInstance if available from createUnityInstance
    if (unityInstance) {
      console.log(`[UnityBridge] Sending via unityInstance: ${gameObjectName}.${methodName}`, message);
      unityInstance.SendMessage(gameObjectName, methodName, msgStr);
    } 
    // Fallback to window.UnityGame if Unity's template sets that up
    else if (window.UnityGame && typeof window.UnityGame.SendMessage === 'function') {
      console.log(`[UnityBridge] Sending via window.UnityGame: ${gameObjectName}.${methodName}`, message);
      window.UnityGame.SendMessage(gameObjectName, methodName, msgStr);
    } else {
      console.warn(`[UnityBridge] Unity SendMessage not found (unityInstance or window.UnityGame). Message for ${gameObjectName}.${methodName} not sent.`, message);
    }
  }, [unityInstance]);
  

  useEffect(() => {
    if (typeof window.createUnityInstance === 'function' && canvasRef.current) {
      const unityConfig = {
        dataUrl: "/Build/solblaze-unity-build.data", // Path to data file
        frameworkUrl: "/Build/solblaze-unity-build.framework.js", // Path to framework file
        codeUrl: "/Build/solblaze-unity-build.wasm", // Path to wasm file
        // streamnigAssetsUrl: "StreamingAssets", // Optional
        // companyName: "DefaultCompany", // Optional
        // productName: "SolBlazeGame", // Optional
        // productVersion: "0.1", // Optional
      };

      window.createUnityInstance(canvasRef.current, unityConfig, (progress) => {
        setUnityLoadingProgress(progress * 100);
      }).then((instance) => {
        setUnityInstance(instance);
        setIsUnityLoading(false);
        // Optionally set fullscreen: instance.SetFullscreen(1);
        sendToUnity("GameManager", "OnUnityReady", {}); // Notify game that Unity is ready
      }).catch((error) => {
        console.error("Error creating Unity instance:", error);
        setIsUnityLoading(false);
        sendToUnity("GameManager", "OnUnityLoadError", { error: error.message });
        toast({ title: "Unity Load Error", description: error.message, variant: "destructive"});
      });
    } else {
        console.warn("createUnityInstance is not available on window, or canvasRef is not set.");
    }
  }, []);


  const fetchSolBalance = useCallback(async () => {
    if (publicKey && connection) {
      try {
        const balance = await connection.getBalance(publicKey);
        const sol = balance / LAMPORTS_PER_SOL;
        setSolBalance(sol);
        sendToUnity("GameManager", "OnSolBalanceUpdated", { solBalance: sol });
        return sol;
      } catch (error: any) {
        console.error("Failed to fetch SOL balance:", error);
        toast({ title: "Error Fetching SOL Balance", description: error.message, variant: "destructive" });
        sendToUnity("GameManager", "OnSolBalanceUpdateFailed", { error: error.message });
        return 0;
      }
    }
    return 0;
  }, [publicKey, connection, sendToUnity, toast]);

  const loadUserAssets = useCallback(async () => {
    if (!publicKey || !rpcUrl || !connection || !wallet) {
      setNfts([]); setCnfts([]); setTokens([]); setSolBalance(0);
      sendToUnity("GameManager", "OnAssetsLoaded", { nfts: [], cnfts: [], tokens: [], solBalance: 0 });
      return;
    }
    setIsLoadingAssets(true);
    sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: true });
    try {
      const [fetchedSolBalance, { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, heliusWarning }] = await Promise.all([
        fetchSolBalance(),
        fetchAssetsForOwner(publicKey.toBase58(), rpcUrl, connection, wallet)
      ]);

      if (heliusWarning) {
        const isApiKeyError = heliusWarning.toLowerCase().includes("access forbidden") || heliusWarning.toLowerCase().includes("api key");
        const toastVariant = isApiKeyError ? "destructive" : "default";
        toast({ title: "API Warning", description: heliusWarning, variant: toastVariant });
        sendToUnity("GameManager", "OnHeliusWarning", { warning: heliusWarning, isError: isApiKeyError });
      }

      setNfts(fetchedNfts);
      setCnfts(fetchedCnfts);
      setTokens(fetchedTokens);
      
      sendToUnity("GameManager", "OnAssetsLoaded", { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, solBalance: fetchedSolBalance });

      if (!heliusWarning) {
        toast({ title: "Asset Scan Complete", description: `Found ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs, ${fetchedTokens.length} Tokens, and ${fetchedSolBalance.toFixed(SOL_DECIMALS)} SOL on ${currentNetwork}.` });
      }
    } catch (error: any) {
      console.error("Failed to load assets:", error);
      toast({ title: "Error Loading Assets", description: error.message, variant: "destructive" });
      sendToUnity("GameManager", "OnAssetsLoadFailed", { error: error.message });
      setNfts([]); setCnfts([]); setTokens([]); setSolBalance(0);
    } finally {
      setIsLoadingAssets(false);
      sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: false });
    }
  }, [publicKey, rpcUrl, connection, wallet, toast, currentNetwork, sendToUnity, fetchSolBalance]);

  useEffect(() => {
    if (connected && publicKey) {
      sendToUnity("GameManager", "OnWalletConnected", { publicKey: publicKey.toBase58() });
      loadUserAssets();
    } else {
      sendToUnity("GameManager", "OnWalletDisconnected", {});
      setNfts([]); setCnfts([]); setTokens([]); setSolBalance(0);
    }
  }, [connected, publicKey, loadUserAssets, currentNetwork, sendToUnity]);

  // UNITY BRIDGE IMPLEMENTATION
  useEffect(() => {
    const bridge = {
      // Wallet
      connectWallet: async () => {
        try {
          if (!connected) {
            if (wallet.wallets.length > 0 && !wallet.wallet) {
               select(wallet.wallets[0].adapter.name); // Attempt to select the first available wallet
            }
            await connectWalletAdapter(); // This promise resolves when connection is attempted/established or modal closed
            // The connected state update will trigger the useEffect above for OnWalletConnected
          } else {
            sendToUnity("GameManager", "OnWalletConnected", { publicKey: publicKey?.toBase58() });
          }
        } catch (error: any) {
          console.error("[UnityBridge] connectWallet error:", error);
          sendToUnity("GameManager", "OnWalletConnectionError", { error: error.message });
          toast({ title: "Wallet Connection Error", description: error.message, variant: "destructive" });
        }
      },
      getPublicKey: () => {
        const pk = publicKey?.toBase58() || null;
        sendToUnity("GameManager", "OnPublicKeyReceived", { publicKey: pk });
        return pk;
      },
      disconnectWallet: async () => {
        try {
          await disconnectWalletAdapter();
          // The connected state update will trigger the useEffect for OnWalletDisconnected
        } catch (error: any) {
          console.error("[UnityBridge] disconnectWallet error:", error);
          sendToUnity("GameManager", "OnWalletConnectionError", { error: error.message });
          toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
        }
      },

      // Assets
      getUserNFTs: async () => {
        if (!publicKey) {
          sendToUnity("GameManager", "OnUserNFTsReceived", { error: "Wallet not connected", nfts: [], cnfts: [] });
          return;
        }
        if (!isLoadingAssets) await loadUserAssets(); // Reload or load if not already
        sendToUnity("GameManager", "OnUserNFTsReceived", { nfts, cnfts });
      },
      getUserTokens: async () => {
         if (!publicKey) {
          sendToUnity("GameManager", "OnUserTokensReceived", { error: "Wallet not connected", tokens: [], solBalance: 0 });
          return;
        }
        if (!isLoadingAssets) { // Ensure assets are loaded
          await fetchSolBalance(); 
          await loadUserAssets();
        }
        sendToUnity("GameManager", "OnUserTokensReceived", { tokens, solBalance });
      },
      
      // Transfers
      transferSOL: async (amount: number, toAddress: string) => {
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_sol", error: "Transaction in progress" });
        if (!publicKey || !sendTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_sol", error: "Wallet not connected" });
        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: true });
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          const signature = await transferSol(connection, wallet, recipientPublicKey, amount);
          toast({ title: "SOL Transfer Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "transfer_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          fetchSolBalance();
        } catch (error: any) {
          toast({ title: "SOL Transfer Failed", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnTransactionError", { action: "transfer_sol", error: error.message });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: false });
        }
      },
      transferToken: async (mint: string, amount: number, toAddress: string) => {
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: "Transaction in progress" });
        const token = tokens.find(t => t.id === mint);
        if (!token) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: "Token not found" });
        if (!publicKey || !sendTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: "Wallet not connected" });
        
        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_token", submitting: true, mint });
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          const signature = await transferSplToken(connection, wallet, token, recipientPublicKey, amount);
          toast({ title: "Token Transfer Initiated", description: `${token.symbol} Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "transfer_token", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          loadUserAssets();
        } catch (error: any) {
          toast({ title: "Token Transfer Failed", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: error.message, mint });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_token", submitting: false, mint });
        }
      },
      transferNFT: async (mint: string, toAddress: string) => {
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_nft", error: "Transaction in progress" });
        const asset = allFetchedAssets.find(a => a.id === mint && (a.type === 'nft' || a.type === 'cnft'));
        if (!asset) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_nft", error: "NFT/cNFT not found" });
        if (!publicKey || !sendTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_nft", error: "Wallet not connected" });

        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_nft", submitting: true, mint });
        let signature;
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          if (asset.type === 'nft') {
            signature = await transferNft(connection, wallet, asset as Nft, recipientPublicKey);
          } else if (asset.type === 'cnft') {
            signature = await transferCNft(connection, wallet, asset as CNft, recipientPublicKey, rpcUrl);
          } else {
            throw new Error("Asset is not an NFT or cNFT.");
          }
          toast({ title: "NFT Transfer Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "transfer_nft", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          loadUserAssets();
        } catch (error: any) {
          toast({ title: "NFT Transfer Failed", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnTransactionError", { action: "transfer_nft", error: error.message, mint });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_nft", submitting: false, mint });
        }
      },

      // Burn
      burnSOL: async (amount: number) => {
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: "Transaction in progress" });
        if (!publicKey || !sendTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: "Wallet not connected" });
        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: true });
        try {
          const signature = await burnSol(connection, wallet, amount);
          toast({ title: "SOL Burn Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "burn_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          fetchSolBalance();
        } catch (error: any) {
          toast({ title: "SOL Burn Failed", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: error.message });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: false });
        }
      },
      burnNFT: async (mint: string, amount?: number) => { // Amount is for SPL tokens, generally 1 for NFTs
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: "Transaction in progress" });
        const asset = allFetchedAssets.find(a => a.id === mint);
        if (!asset) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: "Asset not found" });
        if (!publicKey || !sendTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: "Wallet not connected" });

        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: true, mint });
        let signature;
        try {
          if (asset.type === 'nft') {
            signature = await burnNft(connection, wallet, asset as Nft);
          } else if (asset.type === 'cnft') {
            signature = await burnCNft(connection, wallet, asset as CNft, rpcUrl);
          } else if (asset.type === 'token') {
             if (typeof amount !== 'number' || amount <= 0) throw new Error("Invalid amount for token burn.");
             signature = await burnSplToken(connection, wallet, asset as SplToken, amount);
          } else {
            throw new Error("Asset type not burnable through this function.");
          }
          toast({ title: "Asset Burn Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "burn_asset", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          loadUserAssets();
        } catch (error: any) {
          toast({ title: "Asset Burn Failed", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: error.message, mint });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: false, mint });
        }
      },
      
      // Mint & Swap
      mintNFT: async (name: string, symbol: string, metadataUri: string) => {
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "mint_nft", error: "Transaction in progress" });
        if (!publicKey || !sendTransaction || !signTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "mint_nft", error: "Wallet not connected or doesn't support signing" });
        if (currentNetwork === 'mainnet-beta') {
            toast({ title: "Minting Disabled", description: "NFT minting is disabled on Mainnet for safety.", variant: "destructive" });
            sendToUnity("GameManager", "OnTransactionError", { action: "mint_nft", error: "Minting disabled on Mainnet" });
            return;
        }
        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "mint_nft", submitting: true });
        try {
          const signature = await mintStandardNft(connection, wallet, metadataUri, name, symbol);
          toast({ title: "NFT Mint Successful!", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a>});
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "mint_nft", signature, name, symbol, metadataUri, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          loadUserAssets();
        } catch (error: any) {
          console.error("NFT Minting failed:", error);
          toast({ title: "NFT Mint Failed", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnTransactionError", { action: "mint_nft", error: error.message });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "mint_nft", submitting: false });
        }
      },
      swapTokens: async (fromMint: string, toMint: string, amount: number) => {
        const msg = "Token swapping is not yet implemented in this version.";
        toast({ title: "Feature Unavailable", description: msg });
        sendToUnity("GameManager", "OnTransactionError", { action: "swap_tokens", error: msg });
      },

      // Custodial Transactions
      depositFunds: async (tokenMint: string, amount: number) => {
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Transaction in progress" });
        if (!publicKey || !sendTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Wallet not connected" });
        if (!CUSTODIAL_WALLET_ADDRESS) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Custodial address not set" });

        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: true, tokenMint });
        try {
          let signature;
          if (tokenMint.toUpperCase() === "SOL") {
            signature = await depositSol(connection, wallet, amount, CUSTODIAL_WALLET_ADDRESS);
          } else {
            const token = tokens.find(t => t.id === tokenMint);
            if (!token) throw new Error("Token for deposit not found in user's wallet.");
            signature = await depositSplToken(connection, wallet, token, amount, CUSTODIAL_WALLET_ADDRESS);
          }
          toast({ title: "Deposit Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "deposit_funds", signature, tokenMint, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          loadUserAssets(); // Refresh balances
        } catch (error: any) {
          toast({ title: "Deposit Failed", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: error.message, tokenMint });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: false, tokenMint });
        }
      },
      withdrawFunds: async (tokenMint: string, grossAmount: number) => {
        // Note: Unity sends grossAmount. Tax calculation happens based on this.
        // The `initiateWithdrawalRequest` expects `netAmount`.
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: "Transaction in progress", action: "withdraw_funds", tokenMint });
        if (!publicKey) return sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: "Wallet not connected", action: "withdraw_funds", tokenMint });

        const taxRate = 0.05; // 5%
        const taxAmount = grossAmount * taxRate;
        const netAmount = grossAmount - taxAmount;

        if (netAmount <= 0) {
             sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: "Net withdrawal amount must be positive after tax.", action: "withdraw_funds", tokenMint });
             return;
        }

        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: true, tokenMint });
        try {
          let result: WithdrawalResponse;
          if (tokenMint.toUpperCase() === "SOL") {
            result = await initiateWithdrawalRequest(publicKey.toBase58(), netAmount, currentNetwork); // No token means SOL
          } else {
            const token = allFetchedAssets.find(a => a.id === tokenMint && a.type === 'token') as SplToken | undefined;
            // For withdrawal, we don't check user's balance of this token, as it's coming from custodial.
            // We do need its decimals and program ID if it's an SPL token.
            // This might require fetching token metadata if not in `allFetchedAssets` (e.g. if it's a token the user *doesn't* own but can withdraw)
            // For simplicity now, assuming if it's not SOL, we need its details.
            // A robust system might fetch mint details if `token` is not found.
            if (!token && tokenMint.toUpperCase() !== "SOL") { // If it's an SPL token, we need its details
               throw new Error(`Details for token mint ${tokenMint} not available for withdrawal processing.`);
            }
            // If token is undefined and it's not SOL, it's an issue.
            // The `initiateWithdrawalRequest` needs token details for SPL, or knows it's SOL if token is undefined.
             result = await initiateWithdrawalRequest(publicKey.toBase58(), netAmount, currentNetwork, token);
          }

          if (result.success) {
            toast({ title: "Withdrawal Processed", description: result.signature ? `Sig: ${result.signature}` : result.message, action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> : undefined });
          } else {
            toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
          }
          sendToUnity("GameManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetwork) : undefined });
          // User's balance will update once the backend transaction confirms and they reload assets or it's polled.
        } catch (error: any) {
          toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint });
        }
      },

      // Network
      setNetwork: (network: SupportedSolanaNetwork) => {
        setCurrentNetwork(network);
        sendToUnity("GameManager", "OnNetworkChanged", { network });
      },
      getCurrentNetwork: () => {
        sendToUnity("GameManager", "OnCurrentNetworkReceived", { network: currentNetwork });
        return currentNetwork;
      },
    };

    (window as any).unityBridge = bridge;

    return () => {
      delete (window as any).unityBridge;
    };
  }, [
    connected, publicKey, currentNetwork, rpcUrl, connection, wallet,
    nfts, cnfts, tokens, solBalance, allFetchedAssets,
    connectWalletAdapter, disconnectWalletAdapter, select, sendTransaction, signTransaction,
    loadUserAssets, fetchSolBalance, setCurrentNetwork, toast, sendToUnity,
    isSubmittingTransaction, isLoadingAssets, // Added missing dependencies
  ]);


  return (
    <div className="flex flex-col min-h-screen bg-gray-900 text-white overflow-hidden">
       <header className="sticky top-0 z-[100] w-full border-b border-gray-700 bg-gray-800/95 backdrop-blur supports-[backdrop-filter]:bg-gray-800/60">
        <div className="container flex h-16 items-center justify-between px-4 md:px-6 mx-auto">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <svg width="28" height="28" viewBox="0 0 100 100" fill="hsl(var(--primary))" xmlns="http://www.w3.org/2000/svg">
                <path d="M50 0L61.226 23.407L87.364 26.795L70.957 44.09L73.607 70.039L50 58.36L26.393 70.039L29.043 44.09L12.636 26.795L38.774 23.407L50 0ZM50 28.778L43.111 54.444H71.111L64.222 28.778H50ZM28.889 60L35.778 85.667L50 73.333L64.222 85.667L71.111 60H28.889Z"/>
              </svg>
              <h1 className="text-xl font-bold text-primary">SolBlaze GameBridge</h1>
            </div>
            <NetworkSwitcher />
          </div>
          <ConnectWalletButton />
        </div>
      </header>

      <main className="flex-1 w-full h-[calc(100vh-4rem)] p-0 m-0 relative">
        {isUnityLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-50">
            <p className="text-xl text-white mb-4">Loading Game...</p>
            <div className="w-64 h-4 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-150" 
                style={{ width: `${unityLoadingProgress}%`}}
              ></div>
            </div>
            <p className="text-sm text-gray-400 mt-2">{Math.round(unityLoadingProgress)}%</p>
          </div>
        )}
        <canvas ref={canvasRef} id="unity-canvas" className="w-full h-full" style={{ display: isUnityLoading ? 'none' : 'block' }}></canvas>
      </main>
    </div>
  );
}
