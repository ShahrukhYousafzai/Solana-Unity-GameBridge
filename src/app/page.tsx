
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
import { CUSTODIAL_WALLET_ADDRESS, SOL_DECIMALS, SOL_BURN_ADDRESS, UNITY_GAME_BUILD_BASE_NAME } from "@/config";
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
    UnityGame?: { // Fallback for older Unity WebGL templates or specific global exposure
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

    if (unityInstance) {
      console.log(`[UnityBridge] Sending via unityInstance: ${gameObjectName}.${methodName}`, message);
      unityInstance.SendMessage(gameObjectName, methodName, msgStr);
    }
    else if (window.UnityGame && typeof window.UnityGame.SendMessage === 'function') {
      console.log(`[UnityBridge] Sending via window.UnityGame: ${gameObjectName}.${methodName}`, message);
      window.UnityGame.SendMessage(gameObjectName, methodName, msgStr);
    } else {
      console.warn(`[UnityBridge] Unity SendMessage not found (unityInstance or window.UnityGame). Message for ${gameObjectName}.${methodName} not sent.`, message);
    }
  }, [unityInstance]);


  useEffect(() => {
    if (typeof window !== 'undefined' && canvasRef.current) {
      if (typeof window.createUnityInstance === 'function') {
        // IMPORTANT: These paths MUST match your Unity WebGL build output in /public/Build/
        // And your Unity Build Settings should have "Name Files As Hashes" DISABLED.
        // The UNITY_GAME_BUILD_BASE_NAME is configured in src/config.ts (and .env).
        // Example: If UNITY_GAME_BUILD_BASE_NAME is "GearHeadRacing", paths will be:
        // /Build/GearHeadRacing.data, /Build/GearHeadRacing.framework.js, /Build/GearHeadRacing.wasm
        const unityConfig = {
          dataUrl: `/Build/${UNITY_GAME_BUILD_BASE_NAME}.data`,
          frameworkUrl: `/Build/${UNITY_GAME_BUILD_BASE_NAME}.framework.js`,
          codeUrl: `/Build/${UNITY_GAME_BUILD_BASE_NAME}.wasm`,
          // companyName: "YourCompany", // Optional: Set in Unity Player Settings
          // productName: UNITY_GAME_BUILD_BASE_NAME, // Optional: Set in Unity Player Settings
        };

        window.createUnityInstance(canvasRef.current, unityConfig, (progress) => {
          setUnityLoadingProgress(progress * 100);
        }).then((instance) => {
          setUnityInstance(instance);
          window.unityInstance = instance; // Make it globally accessible if needed by other scripts or for debugging
          setIsUnityLoading(false);
          sendToUnity("GameManager", "OnUnityReady", {}); // Notify Unity game that the JS bridge is ready
        }).catch((error) => {
          console.error("Error creating Unity instance:", error);
          setIsUnityLoading(false); // Stop loading on error
          sendToUnity("GameManager", "OnUnityLoadError", { error: error.message });
          toast({ title: "Unity Load Error", description: `Failed to load game: ${error.message}. Check console. Ensure game files are in /public/Build/ and paths in page.tsx (unityConfig) and layout.tsx (loader script) correctly use UNITY_GAME_BUILD_BASE_NAME to match your non-hashed Unity build filenames.`, variant: "destructive", duration: 15000 });
        });
      } else {
        console.warn("window.createUnityInstance is not available. Check if UnityLoader.js (or your game's loader script, e.g., YourGameName.loader.js) is correctly loaded via <Script> in layout.tsx, and that your Unity build files are in /public/Build/ and named according to UNITY_GAME_BUILD_BASE_NAME.");
        // Set a timeout to stop loading if createUnityInstance doesn't exist after a few seconds
        const timer = setTimeout(() => {
          if (isUnityLoading) { // Check if still loading
               setIsUnityLoading(false);
               toast({ title: "Game Loader Error", description: "Could not initialize Unity game loader. Check browser console and ensure Unity build files (matching UNITY_GAME_BUILD_BASE_NAME) and the loader script (e.g., MyGame.loader.js) are present and correctly pathed.", variant: "destructive", duration: 15000 });
          }
        }, 5000); // 5 seconds timeout
        return () => clearTimeout(timer); // Cleanup timer on component unmount or if effect re-runs
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures this runs once on mount


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
      // Fetch SOL balance and assets concurrently
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
      // setSolBalance is called within fetchSolBalance
      sendToUnity("GameManager", "OnAssetsLoaded", { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, solBalance: fetchedSolBalance });

      // Provide feedback to user even if there's a Helius warning, but tailor the message.
      if (!heliusWarning) { // Only show generic success if no specific warning was raised
        toast({ title: "Asset Scan Complete", description: `Found ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs, ${fetchedTokens.length} Tokens, and ${fetchedSolBalance.toFixed(SOL_DECIMALS)} SOL on ${currentNetwork}.` });
      }
    } catch (error: any) {
      console.error("Failed to load assets:", error);
      toast({ title: "Error Loading Assets", description: error.message, variant: "destructive" });
      sendToUnity("GameManager", "OnAssetsLoadFailed", { error: error.message });
      // Reset states on failure
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
      // Clear assets if wallet disconnects
      setNfts([]); setCnfts([]); setTokens([]); setSolBalance(0);
    }
  }, [connected, publicKey, loadUserAssets, currentNetwork, sendToUnity]); // Added currentNetwork as a dependency as loadUserAssets depends on it via rpcUrl


  useEffect(() => {
    const bridge = {
      connectWallet: async () => {
        try {
          if (!connected) {
            // Attempt to connect. The wallet adapter modal will handle wallet selection.
            await connectWalletAdapter(); // This might trigger the modal
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
      isWalletConnected: () => {
        const currentlyConnected = wallet.connected;
        const pk = wallet.publicKey?.toBase58() || null;
        sendToUnity("GameManager", "OnWalletConnectionStatus", {
          isConnected: currentlyConnected,
          publicKey: pk
        });
        return currentlyConnected; // This return value is for JS, Unity gets info via callback
      },
      getPublicKey: () => {
        const pk = publicKey?.toBase58() || null;
        sendToUnity("GameManager", "OnPublicKeyReceived", { publicKey: pk });
        return pk; // This return value is for JS, Unity gets info via callback
      },
      disconnectWallet: async () => {
        try {
          await disconnectWalletAdapter();
          // OnWalletDisconnected is handled by the other useEffect listening to `connected` state
        } catch (error: any) {
          console.error("[UnityBridge] disconnectWallet error:", error);
          sendToUnity("GameManager", "OnWalletConnectionError", { error: error.message }); // More specific error for disconnect failure
          toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
        }
      },
      getAvailableWallets: () => {
        const available = availableWallets.map(w => ({
          name: w.adapter.name,
          icon: w.adapter.icon,
          readyState: w.adapter.readyState // e.g., "Installed", "NotDetected", "Loadable"
        }));
        sendToUnity("GameManager", "OnAvailableWalletsReceived", { wallets: available });
        return available; // For JS if needed
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
          select(walletName as WalletName); // This sets the active wallet adapter
          // If autoConnect is true (default), it might try to connect automatically.
          // If not, or if user interaction is needed, connectWallet() might be needed after this.
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
        setIsLoadingAssets(true);
        sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: true });
        try {
            // Only fetch NFT/cNFT specific parts or re-use full fetch if simpler
            const { nfts: fetchedNfts, cnfts: fetchedCnfts, heliusWarning } = await fetchAssetsForOwner(publicKey.toBase58(), rpcUrl, connection, wallet);
            if (heliusWarning) {
                 sendToUnity("GameManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            }
            setNfts(fetchedNfts); // Update state
            setCnfts(fetchedCnfts);
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
                fetchSolBalance(), // Re-fetch SOL balance
                fetchAssetsForOwner(publicKey.toBase58(), rpcUrl, connection, wallet) // This gets all assets, extract tokens
            ]);
            if (heliusWarning) {
                 sendToUnity("GameManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            }
            setTokens(fetchedTokens); // Update state
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
          return 0; // JS return, Unity gets callback
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
          loadUserAssets(); // Refresh all assets as token balance changed
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
          loadUserAssets(); // Refresh assets
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
          fetchSolBalance(); // Refresh SOL balance
        } catch (error: any) {
          toast({ title: "SOL Burn Failed", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: error.message });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: false });
        }
      },
      burnNFT: async (mint: string, amount?: number) => { // Renamed from burnAsset for clarity, matches transferNFT style
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
                // This error should ideally be caught before calling, but good to have a safeguard
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
          loadUserAssets(); // Refresh assets
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

        // Safety: Prevent minting on mainnet from the bridge as it's usually a dev/test feature
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
        // Placeholder - Not Implemented
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
            const token = tokens.find(t => t.id === tokenMintOrSol); // Use current tokens state
            if (!token) {
                // This is a scenario where the token might not be in the user's wallet if called directly
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
            result = await initiateWithdrawalRequest(publicKey.toBase58(), grossAmount, currentNetwork);
          } else {
            // For SPL token withdrawal, we need its details (decimals, programId) to pass to the API
            // The API needs this to correctly interpret the 'grossAmount' if it's in human-readable units
            // and to know which token it's dealing with.
            // We assume 'allFetchedAssets' or a similar up-to-date list is available.
            const token = allFetchedAssets.find(a => a.id === tokenMintOrSol && a.type === 'token') as SplToken | undefined;
            if (!token) {
               // This is important: if Unity requests withdrawal of a token JS doesn't know (e.g. not in wallet, or in-game only)
               // We need a way to get its decimals and programId. For now, assume it must be a known (wallet) token.
               sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: `Token ${tokenMintOrSol} details not available. Cannot process withdrawal.`, action: "withdraw_funds", tokenMint: tokenMintOrSol });
               setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol });
               return;
            }
             result = await initiateWithdrawalRequest(publicKey.toBase58(), grossAmount, currentNetwork, token);
          }

          if (result.success) {
            toast({ title: "Withdrawal Processed", description: result.signature ? `Sig: ${result.signature}` : result.message, action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetwork)} target="_blank" rel="noopener noreferrer">View</a> : undefined });
          } else {
            toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
          }
          sendToUnity("GameManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetwork) : undefined });
          // Note: User's on-chain balance won't change until backend processes.
          // Game might need to update an "in-game" balance based on this request.
        } catch (error: any) {
          toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" });
          sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint: tokenMintOrSol });
        } finally {
          setIsSubmittingTransaction(false);
          sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol });
        }
      },
      // Network Management
      setNetwork: (network: SupportedSolanaNetwork) => {
        setCurrentNetwork(network); // This will trigger re-renders and wallet adapter changes
        sendToUnity("GameManager", "OnNetworkChanged", { network });
      },
      getCurrentNetwork: () => {
        sendToUnity("GameManager", "OnCurrentNetworkReceived", { network: currentNetwork });
        return currentNetwork; // JS return
      },
    };

    (window as any).unityBridge = bridge;

    // Cleanup on component unmount
    return () => {
      delete (window as any).unityBridge;
      // Attempt to quit Unity instance if it exists and supports Quit
      if (unityInstance?.Quit) {
        unityInstance.Quit().then(() => console.log("Unity instance quit.")).catch(console.error);
        setUnityInstance(null);
      } else if (window.unityInstance?.Quit) { // Check global fallback
         window.unityInstance.Quit().then(() => console.log("Global window.unityInstance quit.")).catch(console.error);
        window.unityInstance = undefined;
      }
    };
  }, [
    connected, publicKey, currentNetwork, rpcUrl, connection, wallet, // Core Solana/wallet hooks
    nfts, cnfts, tokens, allFetchedAssets, solBalance, // Asset states
    connectWalletAdapter, disconnectWalletAdapter, select, sendTransaction, signTransaction, availableWallets, // Wallet adapter functions
    loadUserAssets, fetchSolBalance, // Data fetching functions
    setCurrentNetwork, // Network context function
    toast, sendToUnity, // UI/Communication utilities
    isSubmittingTransaction, unityInstance // Internal component state
  ]);


  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground overflow-hidden"> {/* Ensure this root div takes full screen and hides overflow */}
       <header className="sticky top-0 z-[100] w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-4 md:px-6 mx-auto">
          <NetworkSwitcher />
          <ConnectWalletButton />
        </div>
      </header>

      {/* Main content area for the Unity game, takes remaining height */}
      <main className="flex-1 w-full h-[calc(100vh-4rem)] p-0 m-0 relative overflow-hidden">
        {isUnityLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-50">
             {/* Placeholder for Game Logo - replace with actual Image component if you have one */}
             <div className="w-60 h-60 mb-4"> {/* Increased size for better visibility */}
                {/* You would ideally use an <Image> component from Next.js here if the logo is static */}
                {/* Using a simple img tag for now, assuming logo is in public/Build/ or similar */}
                <img
                     src={`/Build/${UNITY_GAME_BUILD_BASE_NAME}_Logo.png`} // Dynamic logo name
                     alt="Game Logo"
                     className="w-full h-full object-contain"
                     data-ai-hint="phoenix fire"
                     onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/240x240.png'; (e.target as HTMLImageElement).alt = 'Game Logo Placeholder'; }}
                />
             </div>
            {/* Progress Bar */}
            <div className="w-3/4 max-w-md h-5 bg-muted rounded-full overflow-hidden relative shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-150 rounded-full" // Themed gradient
                style={{ width: `${unityLoadingProgress}%`}}
              ></div>
              {/* Progress Text Overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-xs font-bold text-primary-foreground drop-shadow-sm">
                    {Math.round(unityLoadingProgress)}%
                </p>
              </div>
            </div>
             <p className="text-lg text-foreground mt-4">Loading Game...</p>
          </div>
        )}
        {/* Unity Canvas - Conditionally rendered to replace loading UI */}
        {!isUnityLoading && (
            <canvas
                ref={canvasRef}
                id="unity-canvas"
                className="w-full h-full block" // Ensure it's block and takes full space of parent
                style={{ background: 'transparent' }} // Style for transparency
                tabIndex={-1} // Good for accessibility if canvas is interactive but not directly focusable via keyboard outside of game
            ></canvas>
        )}
      </main>
    </div>
  );
}
