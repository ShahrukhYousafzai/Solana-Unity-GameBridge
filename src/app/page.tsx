
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
import { CUSTODIAL_WALLET_ADDRESS, SOL_DECIMALS, UNITY_GAME_BUILD_BASE_NAME } from "@/config";
import { Skeleton } from "@/components/ui/skeleton";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";


const ConnectWalletButton = dynamic(
  () => import("@/components/ConnectWalletButton").then((mod) => mod.ConnectWalletButton),
  {
    ssr: false,
    loading: () => <Skeleton className="h-10 w-32 rounded-md" />
  }
);

interface IframeWindow extends Window {
  unityInstance?: { // Unity's default loader often sets it on the window
    SendMessage: (gameObjectName: string, methodName: string, message: string | number | undefined) => void;
    Quit?: () => Promise<void>;
  };
  // We are no longer defining initUnityInIframe here
}

declare global {
  interface Window {
    unityBridge?: any; 
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
  
  const [isIframeLoading, setIsIframeLoading] = useState(true); // Tracks if the iframe src has loaded
  const [isUnityInstanceReady, setIsUnityInstanceReady] = useState(false); // Tracks if unityInstance is available in iframe

  const nftsRef = useRef(nfts);
  const cnftsRef = useRef(cnfts);
  const tokensRef = useRef(tokens);
  const solBalanceRef = useRef(_solBalance);
  const allFetchedAssetsRef = useRef<Asset[]>([]);
  const isSubmittingTransactionRef = useRef(isSubmittingTransaction);
  const rpcUrlRef = useRef(rpcUrl);
  const currentNetworkRef = useRef(currentNetwork);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const unityInstanceOnIframeRef = useRef<IframeWindow["unityInstance"] | null>(null);


  useEffect(() => { nftsRef.current = nfts; }, [nfts]);
  useEffect(() => { cnftsRef.current = cnfts; }, [cnfts]);
  useEffect(() => { tokensRef.current = tokens; }, [tokens]);
  useEffect(() => { solBalanceRef.current = _solBalance; }, [_solBalance]);
  useEffect(() => { allFetchedAssetsRef.current = [...nftsRef.current, ...cnftsRef.current, ...tokensRef.current]; }, [nfts, cnfts, tokens]);
  useEffect(() => { isSubmittingTransactionRef.current = isSubmittingTransaction; }, [isSubmittingTransaction]);
  useEffect(() => { rpcUrlRef.current = rpcUrl; }, [rpcUrl]);
  useEffect(() => { currentNetworkRef.current = currentNetwork; }, [currentNetwork]);


  const sendToUnity = useCallback((gameObjectName: string, methodName: string, message: any) => {
    if (unityInstanceOnIframeRef.current && typeof unityInstanceOnIframeRef.current.SendMessage === 'function') {
      const replacer = (key: string, value: any) => (typeof value === 'bigint' ? value.toString() : value);
      const msgStr = typeof message === 'object' ? JSON.stringify(message, replacer) : String(message);
      unityInstanceOnIframeRef.current.SendMessage(gameObjectName, methodName, msgStr);
      console.log(`[ParentPage] Sent to Unity in iframe: ${gameObjectName}.${methodName}`, message);
    } else {
      console.warn(`[ParentPage] sendToUnity: Unity instance or SendMessage not available on iframe. Cannot send. Unity Ready: ${isUnityInstanceReady}`);
    }
  }, [isUnityInstanceReady]);


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
    if (connected && publicKey && rpcUrlRef.current && connection && walletHook && isUnityInstanceReady) {
      sendToUnity("GameBridgeManager", "OnWalletConnected", { publicKey: publicKey.toBase58() });
      debouncedLoadUserAssets(publicKey, rpcUrlRef.current, connection, walletHook);
    } else if (!connected && isUnityInstanceReady) {
      sendToUnity("GameBridgeManager", "OnWalletDisconnected", {});
      setNfts([]); setCnfts([]); setTokens([]); _setSolBalance(0);
    }
  }, [connected, publicKey, connection, walletHook, debouncedLoadUserAssets, sendToUnity, rpcUrl, isUnityInstanceReady]);


  const buildUnityBridge = useCallback(() => {
    return {
      connectWallet: async () => {
        console.log("[ParentPage Bridge] bridge.connectWallet CALLED. walletHook.wallet:", walletHook.wallet, "walletHook.connected:", walletHook.connected);
        if (walletHook.connected) {
            sendToUnity("GameBridgeManager", "OnWalletConnected", { publicKey: walletHook.publicKey?.toBase58() });
            return;
        }
        if (!walletHook.wallet) {
            console.warn("[ParentPage Bridge] connectWallet: No wallet type selected. Opening wallet selection modal.");
            setTimeout(() => walletModal.setVisible(true), 0);
            return;
        }
        const adapterState = walletHook.wallet.adapter.readyState;
        if (adapterState !== WalletReadyState.Installed && adapterState !== WalletReadyState.Loadable) {
           const notReadyMsg = `Wallet ${walletHook.wallet.adapter.name} is not ready (State: ${adapterState}). Please ensure it's installed or try another.`;
           setTimeout(() => walletModal.setVisible(true), 0); 
           sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: notReadyMsg, action: "connect_wallet_not_ready"});
           toast({ title: "Wallet Not Ready", description: notReadyMsg, variant: "default" });
           return;
        }
        try {
          await connectWalletAdapter();
        } catch (error: any) {
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
        try {
          await disconnectWalletAdapter();
          sendToUnity("GameBridgeManager", "OnWalletDisconnected", {});
        } catch (error: any) {
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

  // Effect to set up the bridge on the parent window
  useEffect(() => {
    console.log("[ParentPage] Effect: Defining/Updating window.unityBridge and callConnectWalletFromUnity.");
    const bridge = buildUnityBridge();
    window.unityBridge = bridge;

    if (!window.callConnectWalletFromUnity) {
        window.callConnectWalletFromUnity = () => {
        console.log("[ParentPage Global] callConnectWalletFromUnity() called by Unity via jslib.");
        if (window.unityBridge && typeof window.unityBridge.connectWallet === 'function') {
            window.unityBridge.connectWallet();
        } else {
            console.error("[ParentPage Global] window.unityBridge.connectWallet not found/not a function.");
            sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: "ParentPage Bridge connectWallet not ready." });
        }
        };
        console.log("[ParentPage] Global function 'callConnectWalletFromUnity' DEFINED on window.");
    } else {
        console.log("[ParentPage] Global function 'callConnectWalletFromUnity' ALREADY EXISTS on window.");
    }
    
    return () => {
      console.log("[ParentPage] Effect: Cleanup window.unityBridge and callConnectWalletFromUnity.");
      delete window.unityBridge;
      delete window.callConnectWalletFromUnity;
    };
  }, [buildUnityBridge, sendToUnity]);


  const handleIframeLoad = useCallback(() => {
    console.log("[ParentPage] Iframe loaded (/unity.html). Attempting to locate unityInstance.");
    setIsIframeLoading(false); // Iframe src has loaded

    const checkForUnityInstance = () => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        const iframeContentWindow = iframeRef.current.contentWindow as IframeWindow;
        if (iframeContentWindow.unityInstance && typeof iframeContentWindow.unityInstance.SendMessage === 'function') {
          console.log("[ParentPage] unityInstance found in iframe. Unity is ready.");
          unityInstanceOnIframeRef.current = iframeContentWindow.unityInstance;
          setIsUnityInstanceReady(true);
          // Inform Unity that the parent page bridge is ready and Unity itself is now considered "ready" by the parent.
          sendToUnity("GameBridgeManager", "OnUnityReady", {});
          return; // Stop checking
        }
      }
      // If not found, try again shortly
      console.log("[ParentPage] unityInstance not yet available in iframe. Retrying...");
      setTimeout(checkForUnityInstance, 500);
    };

    setTimeout(checkForUnityInstance, 500); // Initial check after a short delay
  }, [sendToUnity]);

  // Effect for iframe lifecycle and cleanup (Quit Unity)
  useEffect(() => {
    console.log('[ParentPage] Top-level useEffect for iframe/Unity lifecycle runs.');
    // This effect runs once on mount and cleans up on unmount
    // The iframe loading and subsequent unityInstance check is handled by handleIframeLoad callback

    return () => {
      console.log("[ParentPage] HomePage unmounting. Attempting to quit Unity instance in iframe.");
      if (unityInstanceOnIframeRef.current && typeof unityInstanceOnIframeRef.current.Quit === 'function') {
        unityInstanceOnIframeRef.current.Quit().then(() => {
          console.log("[ParentPage] Unity instance in iframe quit successfully.");
        }).catch((err: any) => {
          console.error("[ParentPage] Error quitting Unity instance in iframe:", err);
        });
      } else {
        console.warn("[ParentPage] No Unity instance or Quit function found on iframe to call on unmount.");
      }
      unityInstanceOnIframeRef.current = null;
      setIsUnityInstanceReady(false);
      setIsIframeLoading(true); // Reset for potential remount
    };
  }, []);

  const gameBaseNameOrDefault = UNITY_GAME_BUILD_BASE_NAME || "MyGame";
  if (!UNITY_GAME_BUILD_BASE_NAME) {
      console.warn(`[ParentPage] UNITY_GAME_BUILD_BASE_NAME is not set in config, logo might default. Ensure NEXT_PUBLIC_UNITY_GAME_BUILD_BASE_NAME env var is set if you have a custom logo name.`);
  }


  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-[100] w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-16 shrink-0">
        <div className="container flex h-full items-center justify-between px-4 md:px-6 mx-auto">
          <NetworkSwitcher />
          <ConnectWalletButton />
        </div>
      </header>

      <main className="flex-1 w-full relative overflow-hidden p-0 m-0">
        {(isIframeLoading || !isUnityInstanceReady) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-50">
             <div className="w-60 h-60 mb-4">
                <img
                     src={`/Build/${gameBaseNameOrDefault}_Logo.png`}
                     alt="Game Logo"
                     className="w-full h-full object-contain"
                     data-ai-hint="phoenix fire"
                     onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/240x240.png'; (e.target as HTMLImageElement).alt = 'Game Logo Placeholder'; }}
                />
             </div>
            <div className="w-3/4 max-w-md h-5 bg-muted rounded-full overflow-hidden relative shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-150 rounded-full"
                style={{ width: `${isIframeLoading ? 0 : (isUnityInstanceReady ? 100 : 50 )}%`}} // Simplified progress
              ></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-xs font-bold text-primary-foreground drop-shadow-sm">
                    {isIframeLoading ? "Initializing..." : (!isUnityInstanceReady ? "Loading Game..." : "Ready")}
                </p>
              </div>
            </div>
             <p className="text-lg text-foreground mt-4">{isIframeLoading ? "Loading Host..." : (!isUnityInstanceReady ? "Loading Game..." : "Game Ready")}</p>
             <p className="text-sm text-muted-foreground mt-2">
                Game is embedded from <code>/unity.html</code>. Ensure this file is your Unity build's <code>index.html</code> (renamed)
                and <code>/public/Build/</code> contains Unity's <code>Build</code> folder contents.
             </p>
             <p className="text-xs text-muted-foreground mt-1">If stuck, check browser console (F12) for errors in both parent and iframe (right-click game > Inspect).</p>
          </div>
        )}
        <iframe
            ref={iframeRef}
            src="/unity.html" // Points to the renamed Unity index.html in /public
            className={`w-full h-full border-0 ${(isIframeLoading || !isUnityInstanceReady) ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}
            title="Unity Game"
            onLoad={handleIframeLoad}
            sandbox="allow-scripts allow-same-origin allow-pointer-lock" 
        ></iframe>
      </main>
    </div>
  );
}

