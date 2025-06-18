
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

interface UnityInstance {
  SendMessage: (gameObjectName: string, methodName: string, message: string | number | object) => void;
  SetFullscreen: (fullscreen: 0 | 1) => void;
  Quit?: () => Promise<void>;
}

declare global {
  interface Window {
    createUnityInstance: (
      canvas: HTMLElement,
      config: object,
      onProgress?: (progress: number) => void
    ) => Promise<UnityInstance>;
    unityInstance?: UnityInstance;
    unityBridge?: any;
    UnityGame?: { // This object is expected to be set by your Unity game's scripts
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
    const replacer = (key: string, value: any) => {
      if (typeof value === 'bigint') {
        return value.toString(); // Convert BigInt to string
      }
      return value;
    };
    const msgStr = typeof message === 'object' ? JSON.stringify(message, replacer) : String(message);

    // Prefer using the specific unityInstance if available from createUnityInstance
    if (unityInstance) {
      console.log(`[UnityBridge] Sending via unityInstance: ${gameObjectName}.${methodName}`, message);
      unityInstance.SendMessage(gameObjectName, methodName, msgStr);
    }
    // Fallback to window.UnityGame for broader compatibility if Unity sets it up this way
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
        dataUrl: "/Build/solblaze-unity-build.data", // ENSURE THIS MATCHES YOUR UNITY BUILD FILENAME
        frameworkUrl: "/Build/solblaze-unity-build.framework.js", // ENSURE THIS MATCHES YOUR UNITY BUILD FILENAME
        codeUrl: "/Build/solblaze-unity-build.wasm", // ENSURE THIS MATCHES YOUR UNITY BUILD FILENAME
        // companyName: "YourCompany", // Optional
        // productName: "YourGame", // Optional
      };

      window.createUnityInstance(canvasRef.current, unityConfig, (progress) => {
        setUnityLoadingProgress(progress * 100);
      }).then((instance) => {
        setUnityInstance(instance);
        setIsUnityLoading(false);
        sendToUnity("GameManager", "OnUnityReady", {}); // Notify Unity it's ready
      }).catch((error) => {
        console.error("Error creating Unity instance:", error);
        setIsUnityLoading(false); // Important: stop loading on error
        sendToUnity("GameManager", "OnUnityLoadError", { error: error.message });
        toast({ title: "Unity Load Error", description: `Failed to load game: ${error.message}. Ensure game files are in /public/Build/ and paths in page.tsx are correct.`, variant: "destructive", duration: 10000});
      });
    } else {
      // This case handles if UnityLoader.js didn't load or canvasRef isn't ready.
      console.warn("UnityLoader.js might not be loaded (createUnityInstance not found), or canvas element is not available.");
      // Setting a timeout to avoid race condition if canvasRef is just slow to appear.
      const timer = setTimeout(() => {
        if (isUnityLoading) { // Check if still loading after a short delay
             setIsUnityLoading(false); // Stop loading indicator
             toast({ title: "Game Loader Error", description: "Could not initialize Unity game loader. Check browser console for more details.", variant: "destructive", duration: 10000 });
        }
      }, 3000); // Wait 3 seconds
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array: runs once on mount


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
      // SOL balance is already set by fetchSolBalance and sent to Unity

      sendToUnity("GameManager", "OnAssetsLoaded", { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, solBalance: fetchedSolBalance });

      if (!heliusWarning) {
        toast({ title: "Asset Scan Complete", description: `Found ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs, ${fetchedTokens.length} Tokens, and ${fetchedSolBalance.toFixed(SOL_DECIMALS)} SOL on ${currentNetwork}.` });
      }
    } catch (error: any) {
      console.error("Failed to load assets:", error);
      toast({ title: "Error Loading Assets", description: error.message, variant: "destructive" });
      sendToUnity("GameManager", "OnAssetsLoadFailed", { error: error.message });
      setNfts([]); setCnfts([]); setTokens([]); setSolBalance(0); // Reset on error
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


  useEffect(() => {
    const bridge = {
      connectWallet: async () => {
        try {
          if (!connected) {
            // Attempt to pre-select if no wallet is selected but wallets are available.
            // This helps if user dismissed modal previously but hasn't chosen a default.
            if (wallet.wallets.length > 0 && !wallet.wallet) {
               select(wallet.wallets[0].adapter.name); // Select the first available wallet
            }
            await connectWalletAdapter(); // This will open the modal if no wallet is selected or connect directly.
          } else {
            // Already connected, just inform Unity
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
          // OnWalletDisconnected is handled by the other useEffect listening to `connected`
        } catch (error: any) {
          console.error("[UnityBridge] disconnectWallet error:", error);
          sendToUnity("GameManager", "OnWalletConnectionError", { error: error.message }); // Specific disconnect error
          toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
        }
      },
      getUserNFTs: async () => {
        if (!publicKey) {
          sendToUnity("GameManager", "OnUserNFTsReceived", { error: "Wallet not connected", nfts: [], cnfts: [] });
          return;
        }
        // Refresh assets if not currently loading
        if (!isLoadingAssets) await loadUserAssets();
        // Data will be sent via loadUserAssets's OnAssetsLoaded callback
        // This function can simply confirm the request was received or trigger a load if needed
        sendToUnity("GameManager", "OnUserNFTsRequested", {});
      },
      getUserTokens: async () => {
         if (!publicKey) {
          sendToUnity("GameManager", "OnUserTokensReceived", { error: "Wallet not connected", tokens: [], solBalance: 0 });
          return;
        }
        if (!isLoadingAssets) {
          // fetchSolBalance and loadUserAssets will send data to Unity
          await fetchSolBalance(); 
          await loadUserAssets();
        }
        sendToUnity("GameManager", "OnUserTokensRequested", {});
      },
      getSolBalance: async () => {
        if (!publicKey) {
          sendToUnity("GameManager", "OnSolBalanceUpdateFailed", { error: "Wallet not connected" });
          return 0;
        }
        return fetchSolBalance();
      },
      transferSOL: async (amountSol: number, toAddress: string) => {
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_sol", error: "Transaction in progress" });
        if (!publicKey || !sendTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_sol", error: "Wallet not connected" });
        if (amountSol <= 0) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_sol", error: "Amount must be positive" });
        
        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: true });
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          const signature = await transferSol(connection, wallet, recipientPublicKey, amountSol);
          toast({ title: "SOL Transfer Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "transfer_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          fetchSolBalance(); // Refresh SOL balance
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
        if (!token) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: "Token not found in wallet" });
        if (!publicKey || !sendTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: "Wallet not connected" });
        if (amount <= 0) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: "Amount must be positive" });

        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_token", submitting: true, mint });
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          const signature = await transferSplToken(connection, wallet, token, recipientPublicKey, amount);
          toast({ title: "Token Transfer Initiated", description: `${token.symbol} Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "transfer_token", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          loadUserAssets(); // Refresh all assets
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
        if (!asset) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_nft", error: "NFT/cNFT not found in wallet" });
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
            throw new Error("Asset is not a transferable NFT or cNFT.");
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
      burnSOL: async (amountSol: number) => {
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: "Transaction in progress" });
        if (!publicKey || !sendTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: "Wallet not connected" });
        if (amountSol <= 0) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: "Amount must be positive" });

        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: true });
        try {
          const signature = await burnSol(connection, wallet, amountSol);
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
      burnNFT: async (mint: string, amount?: number) => { // Amount is for SPL tokens, NFTs/cNFTs burn 1
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: "Transaction in progress" });
        const asset = allFetchedAssets.find(a => a.id === mint);
        if (!asset) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: "Asset not found in wallet" });
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
             if (typeof amount !== 'number' || amount <= 0) {
                sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: "Invalid amount for token burn.", mint });
                setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: false, mint });
                return;
             }
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
          loadUserAssets(); // Refresh assets to show the new NFT
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
      depositFunds: async (tokenMintOrSol: string, amount: number) => {
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Transaction in progress" });
        if (!publicKey || !sendTransaction) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Wallet not connected" });
        if (!CUSTODIAL_WALLET_ADDRESS) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Custodial address not set" });
        if (amount <= 0) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Amount must be positive" });

        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: true, tokenMint: tokenMintOrSol });
        try {
          let signature;
          if (tokenMintOrSol.toUpperCase() === "SOL") {
            signature = await depositSol(connection, wallet, amount, CUSTODIAL_WALLET_ADDRESS);
          } else {
            const token = tokens.find(t => t.id === tokenMintOrSol);
            if (!token) {
                sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Token for deposit not found in user's wallet.", tokenMint: tokenMintOrSol });
                setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: false, tokenMint: tokenMintOrSol });
                return;
            }
            signature = await depositSplToken(connection, wallet, token, amount, CUSTODIAL_WALLET_ADDRESS);
          }
          toast({ title: "Deposit Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "deposit_funds", signature, tokenMint: tokenMintOrSol, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          loadUserAssets();
        } catch (error: any) {
          toast({ title: "Deposit Failed", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: error.message, tokenMint: tokenMintOrSol });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: false, tokenMint: tokenMintOrSol });
        }
      },
      withdrawFunds: async (tokenMintOrSol: string, grossAmount: number) => {
        if (isSubmittingTransaction) return sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: "Transaction in progress", action: "withdraw_funds", tokenMint: tokenMintOrSol });
        if (!publicKey) return sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: "Wallet not connected", action: "withdraw_funds", tokenMint: tokenMintOrSol });
        if (grossAmount <= 0) return sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: "Amount must be positive", action: "withdraw_funds", tokenMint: tokenMintOrSol });

        const taxRate = 0.05; // 5%
        const taxAmount = grossAmount * taxRate;
        const netAmount = grossAmount - taxAmount;

        if (netAmount <= 0) {
             sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: "Net withdrawal amount must be positive after tax.", action: "withdraw_funds", tokenMint: tokenMintOrSol });
             toast({ title: "Withdrawal Error", description: "Net withdrawal amount too low after tax.", variant: "destructive"});
             return;
        }

        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: true, tokenMint: tokenMintOrSol });
        try {
          let result: WithdrawalResponse;
          if (tokenMintOrSol.toUpperCase() === "SOL") {
            // For SOL, netAmount sent to API should be in SOL units, API converts to lamports.
            // initiateWithdrawalRequest handles lamport conversion for SOL.
            result = await initiateWithdrawalRequest(publicKey.toBase58(), netAmount, currentNetwork);
          } else {
            const token = allFetchedAssets.find(a => a.id === tokenMintOrSol && a.type === 'token') as SplToken | undefined;
            // Note: For SPL token withdrawal, we're withdrawing from a conceptual "game balance",
            // not directly from the user's wallet's SPL token. The custodial wallet holds these.
            // So, 'token' here is mainly for its metadata (decimals, symbol).
            if (!token && tokenMintOrSol.toUpperCase() !== "SOL") { // Ensure it's not SOL if token is not found.
               sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: `Details for token mint ${tokenMintOrSol} not available for withdrawal processing.`, action: "withdraw_funds", tokenMint: tokenMintOrSol });
               setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol });
               return;
            }
             // For SPL tokens, netAmount is in token units.
             result = await initiateWithdrawalRequest(publicKey.toBase58(), netAmount, currentNetwork, token);
          }

          if (result.success) {
            toast({ title: "Withdrawal Processed", description: result.signature ? `Sig: ${result.signature}` : result.message, action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> : undefined });
          } else {
            toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
          }
          sendToUnity("GameManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetwork) : undefined });
          // No asset refresh here, as it's a custodial operation. Game state might update.
        } catch (error: any) {
          toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint: tokenMintOrSol });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol });
        }
      },
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

    // Cleanup: Attempt to quit Unity instance if it supports it
    return () => {
      delete (window as any).unityBridge;
      if (unityInstance?.Quit) {
        unityInstance.Quit().then(() => {
          console.log("Unity instance quit successfully.");
        }).catch((err) => {
          console.error("Error quitting Unity instance:", err);
        });
        setUnityInstance(null); // Clear instance on component unmount
      } else if (window.unityInstance?.Quit) { // Check global window.unityInstance too
         window.unityInstance.Quit().then(() => {
          console.log("Global window.unityInstance quit successfully.");
        }).catch((err) => {
          console.error("Error quitting global window.unityInstance:", err);
        });
        window.unityInstance = undefined;
      }
    };
  }, [
    connected, publicKey, currentNetwork, rpcUrl, connection, wallet,
    nfts, cnfts, tokens, solBalance, allFetchedAssets, // Ensure allFetchedAssets is up-to-date
    connectWalletAdapter, disconnectWalletAdapter, select, sendTransaction, signTransaction,
    loadUserAssets, fetchSolBalance, setCurrentNetwork, toast, sendToUnity,
    isSubmittingTransaction, isLoadingAssets, unityInstance // Added unityInstance
  ]);


  return (
    <div className="flex flex-col min-h-screen bg-gray-900 text-white overflow-hidden">
      {/* Header remains for wallet connection and network switching, overlaid on game */}
       <header className="sticky top-0 z-[100] w-full border-b border-gray-700 bg-gray-800/95 backdrop-blur supports-[backdrop-filter]:bg-gray-800/60">
        <div className="container flex h-16 items-center justify-between px-4 md:px-6 mx-auto">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {/* Simple SVG Icon for SolBlaze */}
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

      {/* Main area for Unity Game Canvas */}
      <main className="flex-1 w-full h-[calc(100vh-4rem)] p-0 m-0 relative"> {/* Adjust height for header */}
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
        {/* Unity Game Canvas will be created here by createUnityInstance */}
        <canvas ref={canvasRef} id="unity-canvas" className="w-full h-full" style={{ display: isUnityLoading ? 'none' : 'block' }}></canvas>
      </main>
    </div>
  );
}

// Make sure to place your Unity build in public/Build/
// And ensure the UnityLoader.js (or equivalent) is correctly referenced in layout.tsx
// And the dataUrl, frameworkUrl, codeUrl in unityConfig match your build's filenames.

