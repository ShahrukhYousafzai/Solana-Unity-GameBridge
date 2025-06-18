
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
    UnityGame?: {
      SendMessage: (gameObjectName: string, methodName: string, message: string | number | object) => void;
    };
  }
}

// Debounce helper function
function debounce<F extends (...args: any[]) => Promise<any>>(func: F, waitFor: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<F>): Promise<ReturnType<F>> => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    return new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        timeoutId = null; 
        resolve(func(...args));
      }, waitFor);
    });
  };
}


export default function HomePage() {
  const { connection } = useConnection();
  const walletHook = useWallet(); // Keep the hook instance stable
  const { publicKey, sendTransaction, connected, connect: connectWalletAdapter, disconnect: disconnectWalletAdapter, select, signTransaction, wallets: availableWallets } = walletHook;
  const { toast } = useToast();
  const { currentNetwork, setCurrentNetwork, rpcUrl } = useNetwork();

  const [nfts, setNfts] = useState<Nft[]>([]);
  const [cnfts, setCnfts] = useState<CNft[]>([]);
  const [tokens, setTokens] = useState<SplToken[]>([]);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);

  // Refs for frequently changing data
  const nftsRef = useRef(nfts);
  const cnftsRef = useRef(cnfts);
  const tokensRef = useRef(tokens);
  const solBalanceRef = useRef(solBalance);
  const isSubmittingTransactionRef = useRef(isSubmittingTransaction);
  const rpcUrlRef = useRef(rpcUrl);
  const currentNetworkRef = useRef(currentNetwork);

  const allFetchedAssets = useMemo(() => [...nfts, ...cnfts, ...tokens], [nfts, cnfts, tokens]);
  const allFetchedAssetsRef = useRef(allFetchedAssets);

  useEffect(() => { nftsRef.current = nfts; }, [nfts]);
  useEffect(() => { cnftsRef.current = cnfts; }, [cnfts]);
  useEffect(() => { tokensRef.current = tokens; }, [tokens]);
  useEffect(() => { solBalanceRef.current = solBalance; }, [solBalance]);
  useEffect(() => { allFetchedAssetsRef.current = allFetchedAssets; }, [allFetchedAssets]);
  useEffect(() => { isSubmittingTransactionRef.current = isSubmittingTransaction; }, [isSubmittingTransaction]);
  useEffect(() => { rpcUrlRef.current = rpcUrl; }, [rpcUrl]);
  useEffect(() => { currentNetworkRef.current = currentNetwork; }, [currentNetwork]);


  const [unityInstance, setUnityInstance] = useState<UnityInstance | null>(null);
  const [isUnityLoading, setIsUnityLoading] = useState(true);
  const [unityLoadingProgress, setUnityLoadingProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sendToUnity = useCallback((gameObjectName: string, methodName: string, message: any) => {
    const replacer = (key: string, value: any) => (typeof value === 'bigint' ? value.toString() : value);
    const msgStr = typeof message === 'object' ? JSON.stringify(message, replacer) : String(message);

    if (unityInstance) {
      console.log(`[UnityBridge] Sending via unityInstance: ${gameObjectName}.${methodName}`, message);
      unityInstance.SendMessage(gameObjectName, methodName, msgStr);
    } else if (window.UnityGame?.SendMessage) {
      console.log(`[UnityBridge] Sending via window.UnityGame: ${gameObjectName}.${methodName}`, message);
      window.UnityGame.SendMessage(gameObjectName, methodName, msgStr);
    } else {
      console.warn(`[UnityBridge] Unity SendMessage not found. Message for ${gameObjectName}.${methodName} not sent.`, message);
    }
  }, [unityInstance]);


  useEffect(() => {
    if (typeof window !== 'undefined' && canvasRef.current && !unityInstance) { // Ensure only runs once for init
      const unityConfig = {
        dataUrl: `/Build/${UNITY_GAME_BUILD_BASE_NAME}.data`,
        frameworkUrl: `/Build/${UNITY_GAME_BUILD_BASE_NAME}.framework.js`,
        codeUrl: `/Build/${UNITY_GAME_BUILD_BASE_NAME}.wasm`,
      };
      
      console.log("[UnityBridge] Attempting to create Unity instance. UNITY_GAME_BUILD_BASE_NAME from config:", UNITY_GAME_BUILD_BASE_NAME);
      console.log("[UnityBridge] Using Unity config:", JSON.stringify(unityConfig, null, 2));
      console.log("[UnityBridge] Canvas element:", canvasRef.current);

      let criticalErrorTimer: NodeJS.Timeout | null = null;

      if (typeof window.createUnityInstance === 'function') {
        window.createUnityInstance(canvasRef.current, unityConfig, (progress) => {
          setUnityLoadingProgress(progress * 100);
        }).then((instance) => {
          console.log("[UnityBridge] Unity instance created successfully.");
          if (criticalErrorTimer) clearTimeout(criticalErrorTimer);
          setUnityInstance(instance);
          window.unityInstance = instance; // Optional: for easier global access if needed elsewhere
          setIsUnityLoading(false);
          sendToUnity("GameManager", "OnUnityReady", {});
        }).catch((error) => {
          console.error("[UnityBridge] Error creating Unity instance:", error);
          if (criticalErrorTimer) clearTimeout(criticalErrorTimer);
          setIsUnityLoading(false);
          sendToUnity("GameManager", "OnUnityLoadError", { error: error.message || "Unknown error during Unity instance creation." });
          toast({
            title: "Unity Load Error",
            description: `Failed to load game: ${error.message || 'Unknown error'}. Check console. Causes: \n1. Incorrect UNITY_GAME_BUILD_BASE_NAME in .env (current: "${UNITY_GAME_BUILD_BASE_NAME}"). \n2. "Name Files As Hashes" ENABLED (should be OFF). \n3. Build files missing from /public/Build/. \n4. Errors from Unity's framework.`,
            variant: "destructive",
            duration: 30000 
          });
        });
      } else {
        console.error(`[UnityBridge] CRITICAL: window.createUnityInstance is not available. Unity loader script (${UNITY_GAME_BUILD_BASE_NAME}.loader.js) likely failed (404?) or didn't execute. Check Network & Console.`);
        criticalErrorTimer = setTimeout(() => {
          if (isUnityLoading) { 
               setIsUnityLoading(false);
               sendToUnity("GameManager", "OnUnityLoadError", { error: "Unity loader script (createUnityInstance) not found on window."});
               toast({
                title: "Game Loader Script Error!",
                description: `Essential Unity loader ('${UNITY_GAME_BUILD_BASE_NAME}.loader.js') not found or failed. \n1. Verify UNITY_GAME_BUILD_BASE_NAME in .env (current: "${UNITY_GAME_BUILD_BASE_NAME}"). \n2. Ensure loader is in /public/Build/ & named '${UNITY_GAME_BUILD_BASE_NAME}.loader.js'. \n3. "Name Files As Hashes" must be OFF. \n4. Check Network for 404s & Console for errors.`,
                variant: "destructive",
                duration: 30000 
              });
          }
        }, 5000);
      }
      return () => { // Cleanup for this effect (Unity initialization)
        if (criticalErrorTimer) clearTimeout(criticalErrorTimer);
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Runs once on mount to initialize Unity

  // Separate useEffect for Unity instance cleanup on component unmount
  useEffect(() => {
    const instanceToClean = unityInstance; // Capture instance for cleanup
    return () => {
      console.log("[UnityBridge] Component unmount cleanup for Unity instance.");
      if (instanceToClean?.Quit && typeof instanceToClean.Quit === 'function') {
        instanceToClean.Quit()
          .then(() => console.log("[UnityBridge] Unity instance quit successfully on component unmount."))
          .catch(err => console.error("[UnityBridge] Error quitting Unity instance on unmount:", err));
      } else if (window.unityInstance?.Quit && typeof window.unityInstance.Quit === 'function') {
        // Fallback if local state instance isn't what's globally set, though less ideal
        console.log("[UnityBridge] Quitting global window.unityInstance on component unmount.");
        window.unityInstance.Quit()
          .then(() => console.log("[UnityBridge] Global Unity instance quit successfully on component unmount."))
          .catch(err => console.error("[UnityBridge] Error quitting global window.unityInstance:", err));
        window.unityInstance = undefined;
      }
    };
  }, [unityInstance]); // Only re-runs if unityInstance itself changes, sets up cleanup for that instance


  const fetchSolBalanceInternal = useCallback(async (currentPk: PublicKey | null, currentConn: Connection) => {
    if (currentPk && currentConn) {
      try {
        const balance = await currentConn.getBalance(currentPk);
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
  }, [sendToUnity, toast]);

  const loadUserAssetsInternal = useCallback(async (
    currentPk: PublicKey | null, 
    currentRpc: string, 
    currentConn: Connection, 
    currentWallet: WalletContextState
  ) => {
    if (!currentPk || !currentRpc || !currentConn || !currentWallet.publicKey) {
      setNfts([]); setCnfts([]); setTokens([]); setSolBalance(0);
      sendToUnity("GameManager", "OnAssetsLoaded", { nfts: [], cnfts: [], tokens: [], solBalance: 0 });
      return;
    }
    setIsLoadingAssets(true);
    sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: true });
    try {
      const [fetchedSol, { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, heliusWarning }] = await Promise.all([
        fetchSolBalanceInternal(currentPk, currentConn),
        fetchAssetsForOwner(currentPk.toBase58(), currentRpc, currentConn, currentWallet)
      ]);

      if (heliusWarning) {
        const isApiKeyError = heliusWarning.toLowerCase().includes("access forbidden") || heliusWarning.toLowerCase().includes("api key");
        toast({ title: "API Warning", description: heliusWarning, variant: isApiKeyError ? "destructive" : "default", duration: 7000 });
        sendToUnity("GameManager", "OnHeliusWarning", { warning: heliusWarning, isError: isApiKeyError });
      }

      setNfts(fetchedNfts);
      setCnfts(fetchedCnfts);
      setTokens(fetchedTokens);
      sendToUnity("GameManager", "OnAssetsLoaded", { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, solBalance: fetchedSol });

      if (!heliusWarning) {
        toast({ title: "Asset Scan Complete", description: `Found ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs, ${fetchedTokens.length} Tokens, and ${fetchedSol.toFixed(SOL_DECIMALS)} SOL on ${currentNetworkRef.current}.` });
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
  }, [sendToUnity, toast, fetchSolBalanceInternal]);

  const debouncedLoadUserAssets = useMemo(() => debounce(loadUserAssetsInternal, 500), [loadUserAssetsInternal]);

  useEffect(() => {
    if (connected && publicKey && rpcUrl && connection && walletHook) {
      sendToUnity("GameManager", "OnWalletConnected", { publicKey: publicKey.toBase58() });
      debouncedLoadUserAssets(publicKey, rpcUrl, connection, walletHook);
    } else {
      sendToUnity("GameManager", "OnWalletDisconnected", {});
      setNfts([]); setCnfts([]); setTokens([]); setSolBalance(0);
    }
  }, [connected, publicKey, rpcUrl, connection, walletHook, debouncedLoadUserAssets, sendToUnity]);


  useEffect(() => {
    const bridge = {
      connectWallet: async () => {
        try {
          if (!walletHook.connected) {
            await connectWalletAdapter();
          } else {
            sendToUnity("GameManager", "OnWalletConnected", { publicKey: walletHook.publicKey?.toBase58() });
          }
        } catch (error: any) {
          console.error("[UnityBridge] connectWallet error:", error);
          sendToUnity("GameManager", "OnWalletConnectionError", { error: error.message });
          toast({ title: "Wallet Connection Error", description: error.message, variant: "destructive" });
        }
      },
      isWalletConnected: () => {
        const currentlyConnected = walletHook.connected;
        const pk = walletHook.publicKey?.toBase58() || null;
        sendToUnity("GameManager", "OnWalletConnectionStatus", { isConnected: currentlyConnected, publicKey: pk });
        return currentlyConnected;
      },
      getPublicKey: () => {
        const pk = walletHook.publicKey?.toBase58() || null;
        sendToUnity("GameManager", "OnPublicKeyReceived", { publicKey: pk });
        return pk;
      },
      disconnectWallet: async () => {
        try {
          await disconnectWalletAdapter();
        } catch (error: any)
         {
          console.error("[UnityBridge] disconnectWallet error:", error);
          sendToUnity("GameManager", "OnWalletConnectionError", { error: error.message, action: "disconnect_wallet" });
          toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
        }
      },
      getAvailableWallets: () => {
        const available = availableWallets.map(w => ({ name: w.adapter.name, icon: w.adapter.icon, readyState: w.adapter.readyState }));
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
          select(walletName as WalletName);
          sendToUnity("GameManager", "OnWalletSelectAttempted", { walletName });
        } catch (error: any) {
          console.error("[UnityBridge] selectWallet error:", error);
          sendToUnity("GameManager", "OnWalletConnectionError", { error: error.message, action: "select_wallet" });
          toast({ title: "Wallet Selection Error", description: error.message, variant: "destructive" });
        }
      },
      getUserNFTs: async () => {
        if (!walletHook.publicKey || !connection) {
          sendToUnity("GameManager", "OnUserNFTsRequested", { error: "Wallet not connected", nfts: [], cnfts: [] }); return;
        }
        setIsLoadingAssets(true); sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: true });
        try {
            const { nfts: fetchedNfts, cnfts: fetchedCnfts, heliusWarning } = await fetchAssetsForOwner(walletHook.publicKey.toBase58(), rpcUrlRef.current, connection, walletHook);
            if (heliusWarning) sendToUnity("GameManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            setNfts(fetchedNfts); setCnfts(fetchedCnfts);
            sendToUnity("GameManager", "OnUserNFTsRequested", { nfts: nftsRef.current, cnfts: cnftsRef.current });
        } catch (e:any) { sendToUnity("GameManager", "OnUserNFTsRequested", { error: e.message, nfts:[], cnfts:[]});
        } finally { setIsLoadingAssets(false); sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
      },
      getUserTokens: async () => {
         if (!walletHook.publicKey || !connection) {
          sendToUnity("GameManager", "OnUserTokensRequested", { error: "Wallet not connected", tokens: [], solBalance: 0 }); return;
        }
        setIsLoadingAssets(true); sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: true });
        try {
            const [fetchedSol, { tokens: fetchedTokensFromHelius, heliusWarning }] = await Promise.all([
                fetchSolBalanceInternal(walletHook.publicKey, connection),
                fetchAssetsForOwner(walletHook.publicKey.toBase58(), rpcUrlRef.current, connection, walletHook)
            ]);
            if (heliusWarning) sendToUnity("GameManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            setTokens(fetchedTokensFromHelius.filter(a => a.type === 'token') as SplToken[]);
            sendToUnity("GameManager", "OnUserTokensRequested", { tokens: tokensRef.current, solBalance: solBalanceRef.current });
        } catch (e:any) { sendToUnity("GameManager", "OnUserTokensRequested", { error: e.message, tokens:[], solBalance: 0});
        } finally { setIsLoadingAssets(false); sendToUnity("GameManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
      },
      getSolBalance: async () => {
        if (!walletHook.publicKey || !connection) {
          sendToUnity("GameManager", "OnSolBalanceUpdateFailed", { error: "Wallet not connected" }); return 0;
        }
        return fetchSolBalanceInternal(walletHook.publicKey, connection);
      },
      transferSOL: async (amountSol: number, toAddress: string) => {
        if (isSubmittingTransactionRef.current) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_sol", error: "Transaction in progress" });
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_sol", error: "Wallet not connected" });
        if (amountSol <= 0) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_sol", error: "Amount must be positive" });
        setIsSubmittingTransaction(true); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: true });
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          const signature = await transferSol(connection, walletHook, recipientPublicKey, amountSol);
          toast({ title: "SOL Transfer Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "transfer_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
          if(walletHook.publicKey && connection) fetchSolBalanceInternal(walletHook.publicKey, connection);
        } catch (error: any) { toast({ title: "SOL Transfer Failed", description: error.message, variant: "destructive" }); sendToUnity("GameManager", "OnTransactionError", { action: "transfer_sol", error: error.message });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: false }); }
      },
      transferToken: async (mint: string, amount: number, toAddress: string) => {
        if (isSubmittingTransactionRef.current) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: "Transaction in progress" });
        const token = tokensRef.current.find(t => t.id === mint);
        if (!token) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: "Token not found in wallet" });
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: "Wallet not connected" });
        if (amount <= 0) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: "Amount must be positive" });
        setIsSubmittingTransaction(true); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_token", submitting: true, mint });
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          const signature = await transferSplToken(connection, walletHook, token, recipientPublicKey, amount);
          toast({ title: "Token Transfer Initiated", description: `${token.symbol} Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "transfer_token", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { toast({ title: "Token Transfer Failed", description: error.message, variant: "destructive" }); sendToUnity("GameManager", "OnTransactionError", { action: "transfer_token", error: error.message, mint });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_token", submitting: false, mint }); }
      },
      transferNFT: async (mint: string, toAddress: string) => {
        if (isSubmittingTransactionRef.current) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_nft", error: "Transaction in progress" });
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint && (a.type === 'nft' || a.type === 'cnft'));
        if (!asset) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_nft", error: "NFT/cNFT not found" });
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) return sendToUnity("GameManager", "OnTransactionError", { action: "transfer_nft", error: "Wallet not connected" });
        setIsSubmittingTransaction(true); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_nft", submitting: true, mint });
        let signature;
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          if (asset.type === 'nft') signature = await transferNft(connection, walletHook, asset as Nft, recipientPublicKey);
          else if (asset.type === 'cnft') signature = await transferCNft(connection, walletHook, asset as CNft, recipientPublicKey, rpcUrlRef.current);
          else throw new Error("Asset not transferable NFT/cNFT.");
          toast({ title: "NFT Transfer Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "transfer_nft", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { toast({ title: "NFT Transfer Failed", description: error.message, variant: "destructive" }); sendToUnity("GameManager", "OnTransactionError", { action: "transfer_nft", error: error.message, mint });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "transfer_nft", submitting: false, mint }); }
      },
      burnSOL: async (amountSol: number) => {
        if (isSubmittingTransactionRef.current) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: "Transaction in progress" });
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: "Wallet not connected" });
        if (amountSol <= 0) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: "Amount must be positive" });
        setIsSubmittingTransaction(true); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: true });
        try {
          const signature = await burnSol(connection, walletHook, amountSol);
          toast({ title: "SOL Burn Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "burn_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
          if(walletHook.publicKey && connection) fetchSolBalanceInternal(walletHook.publicKey, connection);
        } catch (error: any) { toast({ title: "SOL Burn Failed", description: error.message, variant: "destructive" }); sendToUnity("GameManager", "OnTransactionError", { action: "burn_sol", error: error.message });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: false }); }
      },
      burnNFT: async (mint: string, amount?: number) => {
        if (isSubmittingTransactionRef.current) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: "Transaction in progress" });
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint);
        if (!asset) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: "Asset not found" });
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) return sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: "Wallet not connected" });
        setIsSubmittingTransaction(true); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: true, mint });
        let signature;
        try {
          if (asset.type === 'nft') signature = await burnNft(connection, walletHook, asset as Nft);
          else if (asset.type === 'cnft') signature = await burnCNft(connection, walletHook, asset as CNft, rpcUrlRef.current);
          else if (asset.type === 'token') {
             if (typeof amount !== 'number' || amount <= 0) { sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: "Invalid amount for token burn.", mint }); setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: false, mint }); return; }
             signature = await burnSplToken(connection, walletHook, asset as SplToken, amount);
          } else throw new Error("Asset type not burnable.");
          toast({ title: "Asset Burn Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "burn_asset", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { toast({ title: "Asset Burn Failed", description: error.message, variant: "destructive" }); sendToUnity("GameManager", "OnTransactionError", { action: "burn_asset", error: error.message, mint });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: false, mint }); }
      },
      mintNFT: async (name: string, symbol: string, metadataUri: string) => {
        if (isSubmittingTransactionRef.current) return sendToUnity("GameManager", "OnTransactionError", { action: "mint_nft", error: "Transaction in progress" });
        if (!walletHook.publicKey || !walletHook.sendTransaction || !walletHook.signTransaction || !connection) return sendToUnity("GameManager", "OnTransactionError", { action: "mint_nft", error: "Wallet not connected/sign issue" });
        if (currentNetworkRef.current === 'mainnet-beta') { toast({ title: "Minting Disabled", description: "NFT minting disabled on Mainnet.", variant: "destructive" }); sendToUnity("GameManager", "OnTransactionError", { action: "mint_nft", error: "Minting disabled on Mainnet" }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "mint_nft", submitting: true });
        try {
          const signature = await mintStandardNft(connection, walletHook, metadataUri, name, symbol);
          toast({ title: "NFT Mint Successful!", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a>});
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "mint_nft", signature, name, symbol, metadataUri, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { console.error("NFT Minting failed:", error); toast({ title: "NFT Mint Failed", description: error.message, variant: "destructive" }); sendToUnity("GameManager", "OnTransactionError", { action: "mint_nft", error: error.message });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "mint_nft", submitting: false }); }
      },
      swapTokens: async () => {
        const msg = "Token swapping is not yet implemented.";
        toast({ title: "Feature Unavailable", description: msg }); sendToUnity("GameManager", "OnTransactionError", { action: "swap_tokens", error: msg });
      },
      depositFunds: async (tokenMintOrSol: string, amount: number) => {
        if (isSubmittingTransactionRef.current) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Transaction in progress" });
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Wallet not connected" });
        if (!CUSTODIAL_WALLET_ADDRESS) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Custodial address not set" });
        if (amount <= 0) return sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Amount must be positive" });
        setIsSubmittingTransaction(true); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: true, tokenMint: tokenMintOrSol });
        try {
          let signature;
          if (tokenMintOrSol.toUpperCase() === "SOL") signature = await depositSol(connection, walletHook, amount, CUSTODIAL_WALLET_ADDRESS);
          else {
            const token = tokensRef.current.find(t => t.id === tokenMintOrSol);
            if (!token) { sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: "Token not found.", tokenMint: tokenMintOrSol }); setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: false, tokenMint: tokenMintOrSol }); return; }
            signature = await depositSplToken(connection, walletHook, token, amount, CUSTODIAL_WALLET_ADDRESS);
          }
          toast({ title: "Deposit Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameManager", "OnTransactionSubmitted", { action: "deposit_funds", signature, tokenMint: tokenMintOrSol, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { toast({ title: "Deposit Failed", description: error.message, variant: "destructive" }); sendToUnity("GameManager", "OnTransactionError", { action: "deposit_funds", error: error.message, tokenMint: tokenMintOrSol });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: false, tokenMint: tokenMintOrSol }); }
      },
      withdrawFunds: async (tokenMintOrSol: string, grossAmount: number) => {
        if (isSubmittingTransactionRef.current) return sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: "Transaction in progress", action: "withdraw_funds", tokenMint: tokenMintOrSol });
        if (!walletHook.publicKey) return sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: "Wallet not connected", action: "withdraw_funds", tokenMint: tokenMintOrSol });
        if (grossAmount <= 0) return sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: "Amount must be positive", action: "withdraw_funds", tokenMint: tokenMintOrSol });
        setIsSubmittingTransaction(true); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: true, tokenMint: tokenMintOrSol });
        try {
          let result: WithdrawalResponse;
          if (tokenMintOrSol.toUpperCase() === "SOL") result = await initiateWithdrawalRequest(walletHook.publicKey.toBase58(), grossAmount, currentNetworkRef.current);
          else {
            const token = allFetchedAssetsRef.current.find(a => a.id === tokenMintOrSol && a.type === 'token') as SplToken | undefined;
            if (!token) { sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: `Token details not available.`, action: "withdraw_funds", tokenMint: tokenMintOrSol }); setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); return; }
             result = await initiateWithdrawalRequest(walletHook.publicKey.toBase58(), grossAmount, currentNetworkRef.current, token);
          }
          if (result.success) toast({ title: "Withdrawal Processed", description: result.signature ? `Sig: ${result.signature}` : result.message, action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> : undefined });
          else toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
          sendToUnity("GameManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetworkRef.current) : undefined });
        } catch (error: any) { toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" }); sendToUnity("GameManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint: tokenMintOrSol });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); }
      },
      setNetwork: (network: SupportedSolanaNetwork) => {
        setCurrentNetwork(network);
        sendToUnity("GameManager", "OnNetworkChanged", { network });
      },
      getCurrentNetwork: () => {
        sendToUnity("GameManager", "OnCurrentNetworkReceived", { network: currentNetworkRef.current });
        return currentNetworkRef.current;
      },
    };

    (window as any).unityBridge = bridge;

    return () => {
      console.log("[UnityBridge] Cleaning up window.unityBridge only (from bridge definition effect)");
      delete (window as any).unityBridge;
    };
  }, [
    walletHook, // Main wallet object from useWallet()
    connection, // From useConnection()
    // Specific functions from walletHook (these are stable if walletHook itself is stable)
    connectWalletAdapter, 
    disconnectWalletAdapter, 
    select, 
    availableWallets,
    // Other stable hooks/functions
    setCurrentNetwork,
    toast,
    sendToUnity, // Memoized based on unityInstance
    // Memoized internal helpers
    fetchSolBalanceInternal,
    debouncedLoadUserAssets,
    // Reactive value used directly in some bridge functions or for explorer URLs
    // (though currentNetworkRef.current is used inside, currentNetwork here makes sense for getCurrentNetwork)
    currentNetwork 
  ]);


  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-[100] w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-16 shrink-0">
        <div className="container flex h-full items-center justify-between px-4 md:px-6 mx-auto">
          <NetworkSwitcher />
          <ConnectWalletButton />
        </div>
      </header>

      <main className="flex-1 w-full relative overflow-hidden p-0 m-0">
        {isUnityLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-50">
             <div className="w-60 h-60 mb-4">
                <img
                     src={`/Build/${UNITY_GAME_BUILD_BASE_NAME}_Logo.png`}
                     alt="Game Logo"
                     className="w-full h-full object-contain"
                     data-ai-hint="phoenix fire"
                     onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/240x240.png'; (e.target as HTMLImageElement).alt = 'Game Logo Placeholder'; }}
                />
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
        <canvas
            ref={canvasRef}
            id="unity-canvas"
            className={`w-full h-full block ${isUnityLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}
            style={{ background: 'transparent' }}
            tabIndex={-1}
        ></canvas>
      </main>
    </div>
  );
}
    
