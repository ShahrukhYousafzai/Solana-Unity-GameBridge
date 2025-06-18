
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { type WalletName, WalletReadyState } from "@solana/wallet-adapter-base";
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
import { useWalletModal } from "@solana/wallet-adapter-react-ui";


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
  Module?: {
    canvas?: HTMLCanvasElement;
    // Add other Module properties if needed, e.g., setCanvasSize
  };
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
    callConnectWalletFromUnity?: () => void;
  }
}

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
  const walletHook = useWallet();
  const { publicKey, sendTransaction, connected, connect: connectWalletAdapter, disconnect: disconnectWalletAdapter, select, signTransaction, wallets: availableWallets } = walletHook;
  const { toast } = useToast();
  const { currentNetwork, setCurrentNetwork, rpcUrl } = useNetwork();
  const walletModal = useWalletModal();

  const [nfts, setNfts] = useState<Nft[]>([]);
  const [cnfts, setCnfts] = useState<CNft[]>([]);
  const [tokens, setTokens] = useState<SplToken[]>([]);
  const [_solBalance, _setSolBalance] = useState<number>(0);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);

  const nftsRef = useRef(nfts);
  const cnftsRef = useRef(cnfts);
  const tokensRef = useRef(tokens);
  const solBalanceRef = useRef(_solBalance);
  const allFetchedAssetsRef = useRef<Asset[]>([]);
  const isSubmittingTransactionRef = useRef(isSubmittingTransaction);
  const rpcUrlRef = useRef(rpcUrl);
  const currentNetworkRef = useRef(currentNetwork);

  const unityInstanceRef = useRef<UnityInstance | null>(null);
  const isCreatingUnityRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isUnityLoading, setIsUnityLoading] = useState(true);
  const [unityLoadingProgress, setUnityLoadingProgress] = useState(0);

  useEffect(() => { nftsRef.current = nfts; }, [nfts]);
  useEffect(() => { cnftsRef.current = cnfts; }, [cnfts]);
  useEffect(() => { tokensRef.current = tokens; }, [tokens]);
  useEffect(() => { solBalanceRef.current = _solBalance; }, [_solBalance]);
  useEffect(() => { allFetchedAssetsRef.current = [...nftsRef.current, ...cnftsRef.current, ...tokensRef.current]; }, [nfts, cnfts, tokens]);
  useEffect(() => { isSubmittingTransactionRef.current = isSubmittingTransaction; }, [isSubmittingTransaction]);
  useEffect(() => { rpcUrlRef.current = rpcUrl; }, [rpcUrl]);
  useEffect(() => { currentNetworkRef.current = currentNetwork; }, [currentNetwork]);

  const sendToUnity = useCallback((gameObjectName: string, methodName: string, message: any) => {
    const currentInstance = unityInstanceRef.current;
    const replacer = (key: string, value: any) => (typeof value === 'bigint' ? value.toString() : value);
    const msgStr = typeof message === 'object' ? JSON.stringify(message, replacer) : String(message);

    if (currentInstance?.SendMessage) {
      console.log(`[UnityBridge] Sending via unityInstanceRef: ${gameObjectName}.${methodName}`, message);
      currentInstance.SendMessage(gameObjectName, methodName, msgStr);
    } else if (window.UnityGame?.SendMessage) {
      console.log(`[UnityBridge] Sending via window.UnityGame (fallback): ${gameObjectName}.${methodName}`, message);
      window.UnityGame.SendMessage(gameObjectName, methodName, msgStr);
    } else {
      console.warn(`[UnityBridge] Unity instance (ref or global) not found. Message for ${gameObjectName}.${methodName} not sent. Current instance ref is:`, currentInstanceRef.current, "Message:", message);
    }
  }, []);

  const fetchSolBalanceInternal = useCallback(async (
    currentPk: PublicKey | null,
    currentConn: Connection
  ): Promise<number> => {
    if (currentPk && currentConn) {
      try {
        const balance = await currentConn.getBalance(currentPk);
        const sol = balance / LAMPORTS_PER_SOL;
        _setSolBalance(sol);
        sendToUnity("GameBridgeManager", "OnSolBalanceUpdated", { solBalance: sol });
        return sol;
      } catch (error: any) {
        console.error("Failed to fetch SOL balance:", error);
        toast({ title: "Error Fetching SOL Balance", description: error.message, variant: "destructive" });
        sendToUnity("GameBridgeManager", "OnSolBalanceUpdateFailed", { error: error.message });
        return 0;
      }
    }
    return 0;
  }, [sendToUnity, toast]);

  const loadUserAssetsInternal = useCallback(async (
    currentPk: PublicKey | null,
    currentRpcFromRef: string,
    currentConn: Connection,
    currentWalletCtx: WalletContextState
  ) => {
    if (!currentPk || !currentRpcFromRef || !currentConn || !currentWalletCtx.publicKey) {
      setNfts([]); setCnfts([]); setTokens([]); _setSolBalance(0);
      sendToUnity("GameBridgeManager", "OnAssetsLoaded", { nfts: [], cnfts: [], tokens: [], solBalance: 0 });
      return;
    }
    setIsLoadingAssets(true);
    sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
    try {
      const validWalletContext = currentWalletCtx.publicKey ? currentWalletCtx : walletHook;
      const [fetchedSol, { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, heliusWarning }] = await Promise.all([
        fetchSolBalanceInternal(currentPk, currentConn),
        fetchAssetsForOwner(currentPk.toBase58(), currentRpcFromRef, currentConn, validWalletContext)
      ]);

      if (heliusWarning) {
        const isApiKeyError = heliusWarning.toLowerCase().includes("access forbidden") || heliusWarning.toLowerCase().includes("api key");
        toast({ title: "API Warning", description: heliusWarning, variant: isApiKeyError ? "destructive" : "default", duration: 7000 });
        sendToUnity("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: isApiKeyError });
      }

      setNfts(fetchedNfts); setCnfts(fetchedCnfts); setTokens(fetchedTokens);
      sendToUnity("GameBridgeManager", "OnAssetsLoaded", { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, solBalance: fetchedSol });

      if (!heliusWarning) {
         toast({ title: "Asset Scan Complete", description: `Found ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs, ${fetchedTokens.length} Tokens, and ${fetchedSol.toFixed(SOL_DECIMALS)} SOL on ${currentNetworkRef.current}.` });
      }
    } catch (error: any) {
      console.error("Failed to load assets:", error);
      toast({ title: "Error Loading Assets", description: error.message, variant: "destructive" });
      sendToUnity("GameBridgeManager", "OnAssetsLoadFailed", { error: error.message });
      setNfts([]); setCnfts([]); setTokens([]); _setSolBalance(0);
    } finally {
      setIsLoadingAssets(false);
      sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false });
    }
  }, [sendToUnity, toast, fetchSolBalanceInternal, walletHook]);

  const debouncedLoadUserAssets = useMemo(() => debounce(loadUserAssetsInternal, 500), [loadUserAssetsInternal]);

  useEffect(() => {
    if (connected && publicKey && rpcUrlRef.current && connection && walletHook) {
      sendToUnity("GameBridgeManager", "OnWalletConnected", { publicKey: publicKey.toBase58() });
      debouncedLoadUserAssets(publicKey, rpcUrlRef.current, connection, walletHook);
    } else {
      sendToUnity("GameBridgeManager", "OnWalletDisconnected", {});
      setNfts([]); setCnfts([]); setTokens([]); _setSolBalance(0);
    }
  }, [connected, publicKey, connection, walletHook, debouncedLoadUserAssets, sendToUnity, rpcUrl]);


  const buildUnityBridge = useCallback(() => {
    console.log("[UnityBridge] buildUnityBridge CALLED. walletHook available:", !!walletHook);
    return {
      connectWallet: async () => {
        console.log("[UnityBridge] bridge.connectWallet CALLED. walletHook.wallet:", walletHook.wallet, "walletHook.connected:", walletHook.connected);
        if (walletHook.connected) {
            console.log("[UnityBridge] connectWallet: Already connected.");
            sendToUnity("GameBridgeManager", "OnWalletConnected", { publicKey: walletHook.publicKey?.toBase58() });
            return;
        }
        if (!walletHook.wallet) {
            console.warn("[UnityBridge] connectWallet: No wallet type selected. Opening wallet selection modal.");
            setTimeout(() => walletModal.setVisible(true), 0);
            return;
        }
        
        const adapterState = walletHook.wallet.adapter.readyState;
        if (adapterState !== WalletReadyState.Installed && adapterState !== WalletReadyState.Loadable) {
           const notReadyMsg = `Wallet ${walletHook.wallet.adapter.name} is not ready (State: ${adapterState}). Please ensure it's installed or try another.`;
           console.warn(`[UnityBridge] connectWallet: ${notReadyMsg}`);
           setTimeout(() => walletModal.setVisible(true), 0); 
           sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: notReadyMsg, action: "connect_wallet_not_ready"});
           toast({ title: "Wallet Not Ready", description: notReadyMsg, variant: "default" });
           return;
        }

        try {
          console.log("[UnityBridge] connectWallet: Wallet selected and ready, attempting walletHook.connect(). Adapter:", walletHook.wallet.adapter.name);
          await connectWalletAdapter();
          console.log("[UnityBridge] connectWallet: walletHook.connect() promise resolved.");
        } catch (error: any) {
          console.error("[UnityBridge] connectWallet error during connect attempt:", error);
          sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: error.message, details: error.name, action: "connect_wallet_attempt" });
          toast({ title: "Wallet Connection Error", description: `${error.name}: ${error.message}`, variant: "destructive" });
        }
      },
      isWalletConnected: () => {
        const currentlyConnected = walletHook.connected;
        const pk = walletHook.publicKey?.toBase58() || null;
        sendToUnity("GameBridgeManager", "OnWalletConnectionStatus", { isConnected: currentlyConnected, publicKey: pk });
        return currentlyConnected;
      },
      getPublicKey: () => {
        const pk = walletHook.publicKey?.toBase58() || null;
        sendToUnity("GameBridgeManager", "OnPublicKeyReceived", { publicKey: pk });
        return pk;
      },
      disconnectWallet: async () => {
        console.log("[UnityBridge] bridge.disconnectWallet CALLED.");
        try {
          await disconnectWalletAdapter();
          console.log("[UnityBridge] disconnectWalletAdapter promise resolved.");
          sendToUnity("GameBridgeManager", "OnWalletDisconnected", {});
        } catch (error: any) {
          console.error("[UnityBridge] disconnectWallet error:", error);
          sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "disconnect_wallet" });
          toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
        }
      },
      getAvailableWallets: () => {
        const available = availableWallets.map(w => ({ name: w.adapter.name, icon: w.adapter.icon, readyState: w.adapter.readyState }));
        sendToUnity("GameBridgeManager", "OnAvailableWalletsReceived", { wallets: available });
        return available;
      },
      selectWallet: async (walletName: string) => {
        try {
          const targetWallet = availableWallets.find(w => w.adapter.name === walletName);
          if (!targetWallet) {
            const err = `Wallet ${walletName} not available or not installed.`;
            toast({ title: "Wallet Selection Error", description: err, variant: "destructive" });
            sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: err, action: "select_wallet" });
            return;
          }
          select(walletName as WalletName);
          sendToUnity("GameBridgeManager", "OnWalletSelectAttempted", { walletName });
        } catch (error: any) {
          console.error("[UnityBridge] selectWallet error:", error);
          sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "select_wallet" });
          toast({ title: "Wallet Selection Error", description: error.message, variant: "destructive" });
        }
      },
      getUserNFTs: async () => {
        if (!walletHook.publicKey || !connection) { sendToUnity("GameBridgeManager", "OnUserNFTsRequested", { error: "Wallet not connected", nfts: [], cnfts: [] }); return; }
        setIsLoadingAssets(true); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
        try {
            const { nfts: fetchedNfts, cnfts: fetchedCnfts, heliusWarning } = await fetchAssetsForOwner(walletHook.publicKey.toBase58(), rpcUrlRef.current, connection, walletHook);
            if (heliusWarning) sendToUnity("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            setNfts(fetchedNfts); setCnfts(fetchedCnfts);
            sendToUnity("GameBridgeManager", "OnUserNFTsRequested", { nfts: nftsRef.current, cnfts: cnftsRef.current });
        } catch (e:any) { sendToUnity("GameBridgeManager", "OnUserNFTsRequested", { error: e.message, nfts:[], cnfts:[]});
        } finally { setIsLoadingAssets(false); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
      },
      getUserTokens: async () => {
         if (!walletHook.publicKey || !connection) { sendToUnity("GameBridgeManager", "OnUserTokensRequested", { error: "Wallet not connected", tokens: [], solBalance: 0 }); return; }
        setIsLoadingAssets(true); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
        try {
            const [fetchedSol, { tokens: fetchedTokensFromHelius, heliusWarning }] = await Promise.all([
                fetchSolBalanceInternal(walletHook.publicKey, connection),
                fetchAssetsForOwner(walletHook.publicKey.toBase58(), rpcUrlRef.current, connection, walletHook)
            ]);
            if (heliusWarning) sendToUnity("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            setTokens(fetchedTokensFromHelius.filter(a => a.type === 'token') as SplToken[]);
            sendToUnity("GameBridgeManager", "OnUserTokensRequested", { tokens: tokensRef.current, solBalance: solBalanceRef.current });
        } catch (e:any) { sendToUnity("GameBridgeManager", "OnUserTokensRequested", { error: e.message, tokens:[], solBalance: 0});
        } finally { setIsLoadingAssets(false); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
      },
      getSolBalance: async () => {
        if (!walletHook.publicKey || !connection) { sendToUnity("GameBridgeManager", "OnSolBalanceUpdateFailed", { error: "Wallet not connected" }); return 0; }
        return fetchSolBalanceInternal(walletHook.publicKey, connection);
      },
      transferSOL: async (amountSol: number, toAddress: string) => {
        if (isSubmittingTransactionRef.current) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Transaction in progress" }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Wallet not connected" }); return; }
        if (amountSol <= 0) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Amount must be positive" }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: true });
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          const signature = await transferSol(connection, walletHook, recipientPublicKey, amountSol);
          toast({ title: "SOL Transfer Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "transfer_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
          if(walletHook.publicKey && connection) fetchSolBalanceInternal(walletHook.publicKey, connection);
        } catch (error: any) { toast({ title: "SOL Transfer Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: error.message });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: false }); }
      },
      transferToken: async (mint: string, amount: number, toAddress: string) => {
        if (isSubmittingTransactionRef.current) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Transaction in progress" }); return; }
        const token = tokensRef.current.find(t => t.id === mint);
        if (!token) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Token not found in wallet" }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Wallet not connected" }); return; }
        if (amount <= 0) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Amount must be positive" }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_token", submitting: true, mint });
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          const signature = await transferSplToken(connection, walletHook, token, recipientPublicKey, amount);
          toast({ title: "Token Transfer Initiated", description: `${token.symbol} Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "transfer_token", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { toast({ title: "Token Transfer Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: error.message, mint });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_token", submitting: false, mint }); }
      },
      transferNFT: async (mint: string, toAddress: string) => {
        if (isSubmittingTransactionRef.current) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "Transaction in progress" }); return; }
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint && (a.type === 'nft' || a.type === 'cnft'));
        if (!asset) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "NFT/cNFT not found" }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "Wallet not connected" }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_nft", submitting: true, mint });
        let signature;
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          if (asset.type === 'nft') signature = await transferNft(connection, walletHook, asset as Nft, recipientPublicKey);
          else if (asset.type === 'cnft') signature = await transferCNft(connection, walletHook, asset as CNft, recipientPublicKey, rpcUrlRef.current);
          else throw new Error("Asset not transferable NFT/cNFT.");
          toast({ title: "NFT Transfer Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "transfer_nft", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { toast({ title: "NFT Transfer Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: error.message, mint });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_nft", submitting: false, mint }); }
      },
      burnSOL: async (amountSol: number) => {
        if (isSubmittingTransactionRef.current) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Transaction in progress" }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Wallet not connected" }); return; }
        if (amountSol <= 0) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Amount must be positive" }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: true });
        try {
          const signature = await burnSol(connection, walletHook, amountSol);
          toast({ title: "SOL Burn Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "burn_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
          if(walletHook.publicKey && connection) fetchSolBalanceInternal(walletHook.publicKey, connection);
        } catch (error: any) { toast({ title: "SOL Burn Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: error.message });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: false }); }
      },
      burnNFT: async (mint: string, amount?: number) => {
        if (isSubmittingTransactionRef.current) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Transaction in progress" }); return; }
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint);
        if (!asset) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Asset not found" }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Wallet not connected" }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: true, mint });
        let signature;
        try {
          if (asset.type === 'nft') signature = await burnNft(connection, walletHook, asset as Nft);
          else if (asset.type === 'cnft') signature = await burnCNft(connection, walletHook, asset as CNft, rpcUrlRef.current);
          else if (asset.type === 'token') {
             if (typeof amount !== 'number' || amount <= 0) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Invalid amount for token burn.", mint }); setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: false, mint }); return; }
             signature = await burnSplToken(connection, walletHook, asset as SplToken, amount);
          } else throw new Error("Asset type not burnable.");
          toast({ title: "Asset Burn Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "burn_asset", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { toast({ title: "Asset Burn Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: error.message, mint });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: false, mint }); }
      },
      mintNFT: async (name: string, symbol: string, metadataUri: string) => {
        if (isSubmittingTransactionRef.current) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Transaction in progress" }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !walletHook.signTransaction || !connection) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Wallet not connected/sign issue" }); return; }
        if (currentNetworkRef.current === 'mainnet-beta') { toast({ title: "Minting Disabled", description: "NFT minting disabled on Mainnet.", variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Minting disabled on Mainnet" }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "mint_nft", submitting: true });
        try {
          const signature = await mintStandardNft(connection, walletHook, metadataUri, name, symbol);
          toast({ title: "NFT Mint Successful!", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a>});
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "mint_nft", signature, name, symbol, metadataUri, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { console.error("NFT Minting failed:", error); toast({ title: "NFT Mint Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: error.message });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "mint_nft", submitting: false }); }
      },
      swapTokens: async () => {
        const msg = "Token swapping is not yet implemented.";
        toast({ title: "Feature Unavailable", description: msg }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "swap_tokens", error: msg });
      },
      depositFunds: async (tokenMintOrSol: string, amount: number) => {
        if (isSubmittingTransactionRef.current) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Transaction in progress" }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Wallet not connected" }); return; }
        if (!CUSTODIAL_WALLET_ADDRESS) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Custodial address not set" }); return; }
        if (amount <= 0) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Amount must be positive" }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: true, tokenMint: tokenMintOrSol });
        try {
          let signature;
          if (tokenMintOrSol.toUpperCase() === "SOL") signature = await depositSol(connection, walletHook, amount, CUSTODIAL_WALLET_ADDRESS);
          else {
            const token = tokensRef.current.find(t => t.id === tokenMintOrSol);
            if (!token) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Token not found.", tokenMint: tokenMintOrSol }); setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: false, tokenMint: tokenMintOrSol }); return; }
            signature = await depositSplToken(connection, walletHook, token, amount, CUSTODIAL_WALLET_ADDRESS);
          }
          toast({ title: "Deposit Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "deposit_funds", signature, tokenMint: tokenMintOrSol, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { toast({ title: "Deposit Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: error.message, tokenMint: tokenMintOrSol });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: false, tokenMint: tokenMintOrSol }); }
      },
      withdrawFunds: async (tokenMintOrSol: string, grossAmount: number) => {
        if (isSubmittingTransactionRef.current) { sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Transaction in progress", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
        if (!walletHook.publicKey) { sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Wallet not connected", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
        if (grossAmount <= 0) { sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Amount must be positive", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: true, tokenMint: tokenMintOrSol });
        try {
          let result: WithdrawalResponse;
          if (tokenMintOrSol.toUpperCase() === "SOL") result = await initiateWithdrawalRequest(walletHook.publicKey.toBase58(), grossAmount, currentNetworkRef.current);
          else {
            const token = allFetchedAssetsRef.current.find(a => a.id === tokenMintOrSol && a.type === 'token') as SplToken | undefined;
            if (!token) { sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: `Token details not available for withdrawal.`, action: "withdraw_funds", tokenMint: tokenMintOrSol }); setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); return; }
             result = await initiateWithdrawalRequest(walletHook.publicKey.toBase58(), grossAmount, currentNetworkRef.current, token);
          }
          if (result.success) toast({ title: "Withdrawal Processed", description: result.signature ? `Sig: ${result.signature}` : result.message, action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> : undefined });
          else toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
          sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetworkRef.current) : undefined });
        } catch (error: any) { toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint: tokenMintOrSol });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); }
      },
      setNetwork: (network: SupportedSolanaNetwork) => {
        setCurrentNetwork(network);
        sendToUnity("GameBridgeManager", "OnNetworkChanged", { network });
      },
      getCurrentNetwork: () => {
        sendToUnity("GameBridgeManager", "OnCurrentNetworkReceived", { network: currentNetworkRef.current });
        return currentNetworkRef.current;
      },
    };
  }, [
    walletHook, connection, walletModal, connectWalletAdapter, disconnectWalletAdapter, select, availableWallets,
    sendToUnity, toast, fetchSolBalanceInternal, debouncedLoadUserAssets, setCurrentNetwork,
  ]);


  useEffect(() => {
    let criticalErrorTimerId: NodeJS.Timeout | null = null;
    let localUnityInstance: UnityInstance | null = null;

    console.log("[UnityBridge] Main lifecycle effect started for Unity initialization.");

    const aggressiveCleanup = () => {
      console.log("[UnityBridge] Performing aggressive cleanup of potential lingering instances...");
      if (unityInstanceRef.current) {
          console.warn("[UnityBridge] Lingering unityInstanceRef.current found. Attempting to quit.");
          try { unityInstanceRef.current.Quit?.(); } catch(e) { console.warn("Error quitting ref instance during aggressive cleanup", e); }
          unityInstanceRef.current = null;
      }
      if (window.unityInstance) {
        console.warn("[UnityBridge] Lingering window.unityInstance found. Attempting to quit.");
        try { window.unityInstance.Quit?.(); } catch (e) { console.warn("[UnityBridge] Error quitting lingering window.unityInstance:", e); }
        window.unityInstance = undefined;
      }
      if ((window as any).unityBridge) {
        console.warn("[UnityBridge] Lingering window.unityBridge found. Deleting.");
        delete (window as any).unityBridge;
      }
      if (window.callConnectWalletFromUnity) {
        console.warn("[UnityBridge] Lingering global callConnectWalletFromUnity found. Deleting.");
        delete window.callConnectWalletFromUnity;
      }
    };

    const createUnity = async () => {
      aggressiveCleanup(); // Call cleanup at the start of creation attempt

      if (isCreatingUnityRef.current || !canvasRef.current) {
        console.log(`[UnityBridge] CreateUnity skipped: already creating (${isCreatingUnityRef.current}) or canvas not ready (${!canvasRef.current})`);
        return;
      }
      isCreatingUnityRef.current = true;
      setIsUnityLoading(true);
      setUnityLoadingProgress(0);

      console.log(`[UnityBridge] Attempting to create Unity instance. Configured base name: "${UNITY_GAME_BUILD_BASE_NAME}"`);
      if (UNITY_GAME_BUILD_BASE_NAME === "MyGame" || !UNITY_GAME_BUILD_BASE_NAME) {
        console.warn(`[UnityBridge] UNITY_GAME_BUILD_BASE_NAME is default or empty ("${UNITY_GAME_BUILD_BASE_NAME}"). Ensure NEXT_PUBLIC_UNITY_GAME_BUILD_BASE_NAME env var is set correctly.`);
      }
      const unityConfig = {
        dataUrl: `/Build/${UNITY_GAME_BUILD_BASE_NAME}.data`,
        frameworkUrl: `/Build/${UNITY_GAME_BUILD_BASE_NAME}.framework.js`,
        codeUrl: `/Build/${UNITY_GAME_BUILD_BASE_NAME}.wasm`,
      };
      console.log("[UnityBridge] Using Unity config:", JSON.stringify(unityConfig, null, 2));
      console.log("[UnityBridge] Canvas element for Unity:", canvasRef.current);

      try {
        console.log("[UnityBridge] Calling window.createUnityInstance...");
        const instance = await window.createUnityInstance(
          canvasRef.current,
          unityConfig,
          (progress) => { setUnityLoadingProgress(progress * 100); }
        );
        console.log("[UnityBridge] Unity instance CREATED successfully via window.createUnityInstance.");
        localUnityInstance = instance;
        unityInstanceRef.current = instance;
        window.unityInstance = instance; // Also assign to global for potential direct access by jslib

        console.log("[UnityBridge] About to define window.unityBridge.");
        const bridge = buildUnityBridge(); // buildUnityBridge uses useCallback and its own dependencies
        (window as any).unityBridge = bridge;
        console.log("[UnityBridge] window.unityBridge DEFINED. Bridge object:", bridge);

        (window as any).callConnectWalletFromUnity = () => {
          console.log("[Global Scope] callConnectWalletFromUnity() called by Unity.");
          if (window.unityBridge && typeof window.unityBridge.connectWallet === 'function') {
            console.log("[Global Scope] Forwarding call to window.unityBridge.connectWallet().");
            window.unityBridge.connectWallet();
          } else {
            console.error("[Global Scope] window.unityBridge or window.unityBridge.connectWallet not found or not a function when called by Unity.");
            if (unityInstanceRef.current?.SendMessage) {
                try {
                    const errorPayload = { error: "UnityBridge connectWallet not ready on web.", bridgeExists: !!window.unityBridge, connectWalletExists: typeof window.unityBridge?.connectWallet === 'function' };
                    unityInstanceRef.current.SendMessage("GameBridgeManager", "OnWalletConnectionError", JSON.stringify(errorPayload));
                } catch (e) { console.error("[Global Scope] Error sending message back to Unity about bridge readiness:", e); }
            }
          }
        };
        console.log("[UnityBridge] Global function 'callConnectWalletFromUnity' DEFINED on window.");
        sendToUnity("GameBridgeManager", "OnUnityReady", {}); // Inform Unity the bridge is ready

      } catch (error: any) {
        console.error("[UnityBridge] CRITICAL ERROR creating Unity instance:", error.message, error.stack, error);
        sendToUnity("GameBridgeManager", "OnUnityLoadError", { error: error.message || "Unknown error during Unity instance creation." });
        toast({
          title: "Unity Game Load Error!",
          description: `Failed to load game: ${error.message || 'Unknown error'}. Please check the browser console (F12) for more details, especially for 404 errors related to game files. Ensure 'Name Files As Hashes' is OFF in Unity's WebGL build settings and UNITY_GAME_BUILD_BASE_NAME matches.`,
          variant: "destructive",
          duration: 30000
        });
      } finally {
        setIsUnityLoading(false);
        isCreatingUnityRef.current = false;
        console.log("[UnityBridge] CreateUnity finally block. isUnityLoading:", false, "isCreatingUnityRef:", false);
      }
    };

    if (!canvasRef.current) {
      console.warn("[UnityBridge] Canvas ref not available yet for Unity init in main effect. Will wait for canvas.");
      return; // useEffect will re-run when canvasRef.current is set
    }

    if (typeof window.createUnityInstance !== 'function') {
      console.error(`[UnityBridge] CRITICAL: window.createUnityInstance function is NOT FOUND. This means the Unity loader script ('${UNITY_GAME_BUILD_BASE_NAME}.loader.js') likely failed to load or is incorrect.`);
      criticalErrorTimerId = setTimeout(() => { // Give it a few seconds to potentially load
        if (typeof window.createUnityInstance !== 'function') {
            setIsUnityLoading(false); // Stop loading UI
            sendToUnity("GameBridgeManager", "OnUnityLoadError", { error: "Unity loader script (createUnityInstance) not found on window after delay."});
            toast({
                title: "Game Loader Script Missing!",
                description: `Essential Unity loader ('${UNITY_GAME_BUILD_BASE_NAME}.loader.js') not found on 'window.createUnityInstance'. \n1. Verify UNITY_GAME_BUILD_BASE_NAME in .env (current: "${UNITY_GAME_BUILD_BASE_NAME}"). \n2. Ensure loader is in /public/Build/ & correctly named '${UNITY_GAME_BUILD_BASE_NAME}.loader.js'. \n3. "Name Files As Hashes" MUST BE OFF in Unity Build Settings. \n4. Check Network tab for 404s & Console for prior errors.`,
                variant: "destructive",
                duration: 60000 // Longer duration for critical error
            });
        }
      }, 5000); // 5 seconds delay
      return () => { if (criticalErrorTimerId) clearTimeout(criticalErrorTimerId); };
    }

    createUnity(); // Call the async function to create Unity

    return () => {
      console.log("[UnityBridge] Main lifecycle effect UNMOUNT cleanup running.");
      if (criticalErrorTimerId) clearTimeout(criticalErrorTimerId);

      const instanceToQuit = localUnityInstance || unityInstanceRef.current; // Prioritize instance from this effect's scope
      if (instanceToQuit) {
        console.log("[UnityBridge] Attempting to quit Unity instance (from main effect cleanup).");
        try {
          const currentCanvas = canvasRef.current; 
          if (currentCanvas && instanceToQuit.Module?.canvas === currentCanvas) { // Check if canvas still belongs to this instance
             const gl = currentCanvas.getContext("webgl") || currentCanvas.getContext("experimental-webgl");
             if (gl && gl.getExtension("WEBGL_lose_context")) {
                console.log("[UnityBridge] Actively losing WebGL context for current instance on unmount.");
                gl.getExtension("WEBGL_lose_context")!.loseContext();
             } else {
                console.warn("[UnityBridge] WEBGL_lose_context extension not available or canvas mismatch on unmount.");
             }
          }
          // Non-blocking Quit attempt
          instanceToQuit.Quit?.()
            .then(() => console.log("[UnityBridge] Unity instance (from main effect cleanup) successfully quit."))
            .catch(e => console.warn("[UnityBridge] Error during Unity instance Quit() promise (from main effect cleanup):", e));
        } catch (e) {
          console.warn("[UnityBridge] Synchronous error during Unity instance cleanup (from main effect cleanup):", e);
        }
      } else {
        console.log("[UnityBridge] No Unity instance found to quit during main effect cleanup.");
      }
      
      unityInstanceRef.current = null;
      window.unityInstance = undefined;

      if ((window as any).unityBridge) {
        console.log("[UnityBridge] Deleting window.unityBridge from window (main effect cleanup).");
        delete (window as any).unityBridge;
      }
      if (window.callConnectWalletFromUnity) {
        console.log("[UnityBridge] Deleting global function 'callConnectWalletFromUnity' from window (main effect cleanup).");
        delete window.callConnectWalletFromUnity;
      }
      isCreatingUnityRef.current = false;
      setIsUnityLoading(true); // Reset loading state for potential remount
      setUnityLoadingProgress(0);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildUnityBridge]); // buildUnityBridge is stable due to its own useCallback
  // Note: Removed canvasRef.current from dependencies as it's a ref and doesn't trigger re-runs.
  // The effect already checks for canvasRef.current internally.

  // WebGL Context Loss/Restore Handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    const handleWebGLContextLost = (event: Event) => {
      event.preventDefault(); // Important to prevent default browser handling
      console.error("[WebGL] Context Lost! Informing Unity via GameBridgeManager.OnWebGLContextLost");
      sendToUnity("GameBridgeManager", "OnWebGLContextLost", {});
      // Consider additional UI changes here, like showing a "Reload Game" button.
    };
    const handleWebGLContextRestored = () => {
      console.log("[WebGL] Context Restored. Attempting to inform Unity via GameBridgeManager.OnWebGLContextRestored");
      sendToUnity("GameBridgeManager", "OnWebGLContextRestored", {});
      // Unity might need to re-initialize shaders, textures, etc.
      // This often requires a game reload or specific handling within Unity.
    };

    if (canvas) {
      canvas.addEventListener('webglcontextlost', handleWebGLContextLost, false);
      canvas.addEventListener('webglcontextrestored', handleWebGLContextRestored, false);
      console.log("[WebGL] WebGL context event listeners attached to canvas.");
    } else {
      console.warn("[WebGL] Canvas ref not available to attach WebGL context listeners.");
    }
    return () => {
      if (canvas) {
        canvas.removeEventListener('webglcontextlost', handleWebGLContextLost);
        canvas.removeEventListener('webglcontextrestored', handleWebGLContextRestored);
        console.log("[WebGL] WebGL context event listeners removed from canvas.");
      }
    };
  }, [sendToUnity]); // sendToUnity is stable


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
             <p className="text-sm text-muted-foreground mt-2">If stuck, check browser console (F12) for errors.</p>
          </div>
        )}
        <canvas
            ref={canvasRef}
            id="unity-canvas"
            className={`w-full h-full block ${isUnityLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}
            style={{ background: 'transparent' }} // Ensure Unity game background is also transparent or matches if needed
            tabIndex={-1} // Ensure canvas can't be tabbed to unless explicitly managed
        ></canvas>
      </main>
    </div>
  );
}

    
