
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
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
import { CUSTODIAL_WALLET_ADDRESS, SOL_DECIMALS, SOL_BURN_ADDRESS } from "@/config";
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
    // UnityGame is typically exposed by the Unity WebGL template itself
    // for SendMessage to work from JS back to Unity.
    UnityGame?: {
      SendMessage: (gameObjectName: string, methodName: string, message: string | number | object) => void;
    };
  }
}

export default function HomePage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, sendTransaction, connected, connect: connectWalletAdapter, disconnect: disconnectWalletAdapter, select, signTransaction, wallets: availableWallets } = wallet;
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
        return value.toString();
      }
      return value;
    };
    const msgStr = typeof message === 'object' ? JSON.stringify(message, replacer) : String(message);

    // Prefer using the specific unityInstance if available from createUnityInstance
    if (unityInstance) {
      console.log(`[UnityBridge] Sending via unityInstance: ${gameObjectName}.${methodName}`, message);
      unityInstance.SendMessage(gameObjectName, methodName, msgStr);
    }
    // Fallback for older Unity versions or different WebGL template setups
    // where UnityGame might be directly on the window from its own template.
    else if (window.UnityGame && typeof window.UnityGame.SendMessage === 'function') {
      console.log(`[UnityBridge] Sending via window.UnityGame: ${gameObjectName}.${methodName}`, message);
      window.UnityGame.SendMessage(gameObjectName, methodName, msgStr);
    } else {
      console.warn(`[UnityBridge] Unity SendMessage not found (unityInstance or window.UnityGame). Message for ${gameObjectName}.${methodName} not sent.`, message);
    }
  }, [unityInstance]);


  useEffect(() => {
    if (typeof window.createUnityInstance === 'function' && canvasRef.current) {
      // IMPORTANT: These paths MUST match your Unity WebGL build output in /public/Build/
      // Recommendation: In Unity's WebGL Player Settings, disable "Name Files As Hashes"
      // to get predictable filenames (e.g., YourGameName.data, YourGameName.framework.js, YourGameName.wasm).
      // If you keep hashed names, you MUST update these paths manually after each Unity build.
      // The loader script itself (e.g., UnityLoader.js or YourGameName.loader.js)
      // is loaded in src/app/layout.tsx.
      const unityConfig = {
        // Example using "MyGame" as product name, adjust if your Unity build outputs differently
        dataUrl: "/Build/MyGame.data",
        frameworkUrl: "/Build/MyGame.framework.js",
        codeUrl: "/Build/MyGame.wasm",
        // companyName: "YourCompany", // Optional, set in Unity Player Settings
        // productName: "MyGame", // Optional, set in Unity Player Settings
      };

      window.createUnityInstance(canvasRef.current, unityConfig, (progress) => {
        setUnityLoadingProgress(progress * 100);
      }).then((instance) => {
        setUnityInstance(instance);
        window.unityInstance = instance;
        setIsUnityLoading(false);
        sendToUnity("GameManager", "OnUnityReady", {});
      }).catch((error) => {
        console.error("Error creating Unity instance:", error);
        setIsUnityLoading(false);
        sendToUnity("GameManager", "OnUnityLoadError", { error: error.message });
        toast({ title: "Unity Load Error", description: `Failed to load game: ${error.message}. Ensure game files are in /public/Build/ and paths in this page (unityConfig) and layout.tsx (loader script) are correct.`, variant: "destructive", duration: 10000});
      });
    } else {
      console.warn("window.createUnityInstance is not available. Check if UnityLoader.js (or your game's loader script) is correctly loaded via <Script> in layout.tsx, and that your Unity build files are in /public/Build/.");
      const timer = setTimeout(() => {
        if (isUnityLoading) { // Check again if still loading
             setIsUnityLoading(false); // Ensure loading screen hides
             toast({ title: "Game Loader Error", description: "Could not initialize Unity game loader. Check browser console and ensure Unity build files and loader script are present and correctly pathed.", variant: "destructive", duration: 10000 });
        }
      }, 5000); // Wait 5s before showing this general loader error
      return () => clearTimeout(timer); // Cleanup timer
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        toast({ title: "API Warning", description: heliusWarning, variant: toastVariant, duration: 7000 });
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


  useEffect(() => {
    const bridge = {
      connectWallet: async () => {
        try {
          if (!connected) {
            // Attempt to connect using the adapter. This usually triggers the wallet modal or connects directly if a previous session exists.
            await connectWalletAdapter();
          } else {
            // Already connected, just send the info back
            sendToUnity("GameManager", "OnWalletConnected", { publicKey: publicKey?.toBase58() });
          }
        } catch (error: any) {
          console.error("[UnityBridge] connectWallet error:", error);
          sendToUnity("GameManager", "OnWalletConnectionError", { error: error.message });
          toast({ title: "Wallet Connection Error", description: error.message, variant: "destructive" });
        }
      },
      isWalletConnected: () => {
        const currentlyConnected = wallet.connected;
        const pk = wallet.publicKey?.toBase58() || null;
        sendToUnity("GameManager", "OnWalletConnectionStatus", {
          isConnected: currentlyConnected,
          publicKey: pk
        });
        return currentlyConnected; // For potential JS-side use, Unity gets via callback
      },
      getPublicKey: () => {
        const pk = publicKey?.toBase58() || null;
        sendToUnity("GameManager", "OnPublicKeyReceived", { publicKey: pk });
        return pk;
      },
      disconnectWallet: async () => {
        try {
          await disconnectWalletAdapter();
          // OnWalletDisconnected callback is handled by the main connection status useEffect
        } catch (error: any) {
          console.error("[UnityBridge] disconnectWallet error:", error);
          sendToUnity("GameManager", "OnWalletConnectionError", { error: error.message });
          toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
        }
      },
      getAvailableWallets: () => {
        const available = availableWallets.map(w => ({
          name: w.adapter.name,
          icon: w.adapter.icon,
          readyState: w.adapter.readyState
        }));
        sendToUnity("GameManager", "OnAvailableWalletsReceived", { wallets: available });
        return available;
      },
      selectWallet: async (walletName: string) => {
        try {
          const targetWallet = availableWallets.find(w => w.adapter.name === walletName);
          if (!targetWallet) {
            const err = `Wallet ${walletName} not available or not installed.`;
            toast({ title: "Wallet Selection Error", description: err, variant: "destructive" });
            sendToUnity("GameManager", "OnWalletConnectionError", { error: err, action: "select_wallet" });
            return;
          }
          select(walletName as WalletName); // This sets the active wallet
          // autoConnect in WalletProvider should attempt connection.
          // If not, connectWallet might need to be called after selection if it doesn't connect automatically.
          sendToUnity("GameManager", "OnWalletSelectAttempted", { walletName });
        } catch (error: any) {
          console.error("[UnityBridge] selectWallet error:", error);
          sendToUnity("GameManager", "OnWalletConnectionError", { error: error.message, action: "select_wallet" });
          toast({ title: "Wallet Selection Error", description: error.message, variant: "destructive" });
        }
      },
      getUserNFTs: async () => {
        if (!publicKey) {
          sendToUnity("GameManager", "OnUserNFTsRequested", { error: "Wallet not connected", nfts: [], cnfts: [] });
          return;
        }
        // Re-fetch assets for this specific request to ensure freshness
        setIsLoadingAssets(true);
        sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: true });
        try {
            const { nfts: fetchedNfts, cnfts: fetchedCnfts, heliusWarning } = await fetchAssetsForOwner(publicKey.toBase58(), rpcUrl, connection, wallet);
            if (heliusWarning) {
                 sendToUnity("GameManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            }
            setNfts(fetchedNfts); // Update local state
            setCnfts(fetchedCnfts); // Update local state
            sendToUnity("GameManager", "OnUserNFTsRequested", { nfts: fetchedNfts, cnfts: fetchedCnfts });
        } catch (e:any) {
            sendToUnity("GameManager", "OnUserNFTsRequested", { error: e.message, nfts:[], cnfts:[]});
        } finally {
            setIsLoadingAssets(false);
            sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: false });
        }
      },
      getUserTokens: async () => {
         if (!publicKey) {
          sendToUnity("GameManager", "OnUserTokensRequested", { error: "Wallet not connected", tokens: [], solBalance: 0 });
          return;
        }
        setIsLoadingAssets(true);
        sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: true });
        try {
            const [fetchedSolBalance, { tokens: fetchedTokens, heliusWarning }] = await Promise.all([
                fetchSolBalance(), // Fetches SOL and sends OnSolBalanceUpdated
                fetchAssetsForOwner(publicKey.toBase58(), rpcUrl, connection, wallet) // Re-fetch for tokens
            ]);
            if (heliusWarning) {
                 sendToUnity("GameManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            }
            setTokens(fetchedTokens); // Update local state
            sendToUnity("GameManager", "OnUserTokensRequested", { tokens: fetchedTokens, solBalance: fetchedSolBalance });
        } catch (e:any) {
            sendToUnity("GameManager", "OnUserTokensRequested", { error: e.message, tokens:[], solBalance: 0});
        } finally {
            setIsLoadingAssets(false);
            sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: false });
        }
      },
      getSolBalance: async () => {
        if (!publicKey) {
          sendToUnity("GameManager", "OnSolBalanceUpdateFailed", { error: "Wallet not connected" });
          return 0; // Or send specific error code/message
        }
        return fetchSolBalance(); // This already sends OnSolBalanceUpdated or OnSolBalanceUpdateFailed
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
        const token = tokens.find(t => t.id === mint); // Use local state for token details
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
            if (!rpcUrl) throw new Error("RPC URL is not available for cNFT operation.");
            signature = await transferCNft(connection, wallet, asset as CNft, recipientPublicKey, rpcUrl);
          } else {
            throw new Error("Asset is not a transferable NFT or cNFT.");
          }
          toast({ title: "NFT Transfer Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "transfer_nft", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          loadUserAssets(); // Refresh all assets
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
          const signature = await burnSol(connection, wallet, amountSol); // burnSol uses SOL_BURN_ADDRESS
          toast({ title: "SOL Burn Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "burn_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          fetchSolBalance(); // Refresh SOL balance
        } catch (error: any) {
          toast({ title: "SOL Burn Failed", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: error.message });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: false });
        }
      },
      burnNFT: async (mint: string, amount?: number) => { // Amount is for SPL tokens
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
            if (!rpcUrl) throw new Error("RPC URL is not available for cNFT operation.");
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
          loadUserAssets(); // Refresh all assets
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

        if (currentNetwork === 'mainnet-beta') { // Safety check
            toast({ title: "Minting Disabled", description: "NFT minting is disabled on Mainnet for safety.", variant: "destructive" });
            sendToUnity("GameManager", "OnTransactionError", { action: "mint_nft", error: "Minting disabled on Mainnet" });
            return;
        }

        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "mint_nft", submitting: true });
        try {
          // metadata argument from Unity should be an object or JSON string for metadata URI, name, symbol
          // For simplicity, this example expects distinct name, symbol, uri.
          const signature = await mintStandardNft(connection, wallet, metadataUri, name, symbol);
          toast({ title: "NFT Mint Successful!", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a>});
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "mint_nft", signature, name, symbol, metadataUri, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
          loadUserAssets(); // Refresh assets
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
        // Placeholder - Not implemented
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
          loadUserAssets(); // Refresh assets
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

        setIsSubmittingTransaction(true);
        sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: true, tokenMint: tokenMintOrSol });
        try {
          let result: WithdrawalResponse;
          if (tokenMintOrSol.toUpperCase() === "SOL") {
            result = await initiateWithdrawalRequest(publicKey.toBase58(), grossAmount, currentNetwork); // For SOL, grossAmount is in SOL units
          } else {
            const token = allFetchedAssets.find(a => a.id === tokenMintOrSol && a.type === 'token') as SplToken | undefined;
            if (!token) {
               sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: `Token ${tokenMintOrSol} details not available. Cannot process withdrawal.`, action: "withdraw_funds", tokenMint: tokenMintOrSol });
               setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol });
               return;
            }
             // For SPL tokens, grossAmount is in token units (not raw amount)
             result = await initiateWithdrawalRequest(publicKey.toBase58(), grossAmount, currentNetwork, token);
          }

          if (result.success) {
            toast({ title: "Withdrawal Processed", description: result.signature ? `Sig: ${result.signature}` : result.message, action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> : undefined });
          } else {
            toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
          }
          // Send the full result back to Unity
          sendToUnity("GameManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetwork) : undefined });
        } catch (error: any) {
          toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint: tokenMintOrSol });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol });
        }
      },
      setNetwork: (network: SupportedSolanaNetwork) => {
        setCurrentNetwork(network); // This will trigger re-renders and context updates
        sendToUnity("GameManager", "OnNetworkChanged", { network });
      },
      getCurrentNetwork: () => {
        sendToUnity("GameManager", "OnCurrentNetworkReceived", { network: currentNetwork });
        return currentNetwork;
      },
    };

    (window as any).unityBridge = bridge;

    // Cleanup function for when the component unmounts or dependencies change
    return () => {
      delete (window as any).unityBridge;
      // Attempt to quit Unity instance if it exists and has a Quit method
      if (unityInstance?.Quit) {
        unityInstance.Quit().then(() => console.log("Unity instance quit.")).catch(console.error);
        setUnityInstance(null); // Clear the instance from state
      } else if (window.unityInstance?.Quit) { // Check global window.unityInstance as a fallback
         window.unityInstance.Quit().then(() => console.log("Global window.unityInstance quit.")).catch(console.error);
        window.unityInstance = undefined; // Clear global instance
      }
    };
  }, [
    connected, publicKey, currentNetwork, rpcUrl, connection, wallet, // Core Solana hooks
    nfts, cnfts, tokens, allFetchedAssets, solBalance, // Asset states
    connectWalletAdapter, disconnectWalletAdapter, select, sendTransaction, signTransaction, availableWallets, // Wallet actions
    loadUserAssets, fetchSolBalance, // Data fetching functions
    setCurrentNetwork, // Network context action
    toast, sendToUnity, // UI and communication
    isSubmittingTransaction, isLoadingAssets, unityInstance // Internal component state
  ]);


  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground overflow-hidden">
       <header className="sticky top-0 z-[100] w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-4 md:px-6 mx-auto">
          <NetworkSwitcher />
          <ConnectWalletButton />
        </div>
      </header>

      {/* Main content area for the Unity game canvas */}
      <main className="flex-1 w-full h-[calc(100vh-4rem)] p-0 m-0 relative"> {/* Adjust height to account for header */}
        {isUnityLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-50">
             {/* Inspired by user's provided HTML template for loading */}
             <div className="w-60 h-60 mb-4">
                {/* Replace with your actual game logo if available, or remove */}
                <img src="https://placehold.co/240x240.png" alt="Game Logo Placeholder" className="w-full h-full object-contain" data-ai-hint="phoenix fire" />
             </div>
            <div className="w-3/4 max-w-md h-5 bg-muted rounded-full overflow-hidden relative shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-150 rounded-full"
                style={{ width: `${unityLoadingProgress}%`}}
              ></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-xs font-bold text-primary-foreground drop-shadow-sm">
                    {Math.round(unityLoadingProgress)}%
                </p>
              </div>
            </div>
             <p className="text-lg text-foreground mt-4">Loading Game...</p>
          </div>
        )}
        {/* The canvas for Unity. It's hidden while Unity is loading. */}
        <canvas
            ref={canvasRef}
            id="unity-canvas" // Standard ID often used by Unity templates
            className="w-full h-full" // Ensure it tries to take full space of its parent
            style={{ display: isUnityLoading ? 'none' : 'block', background: 'transparent' }} // Transparent bg if game doesn't fill
            tabIndex={-1} // To receive keyboard input if needed by Unity
        ></canvas>
      </main>
    </div>
  );
}

    