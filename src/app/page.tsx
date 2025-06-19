
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

interface IframeUnityWindow extends Window {
  unityInstance?: {
    SendMessage: (gameObjectName: string, methodName: string, message: string | number | undefined) => void;
    Quit?: () => Promise<void>;
    SetFullscreen?: (fullscreen: 0 | 1) => void;
  };
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
  
  const [isIframeLoading, setIsIframeLoading] = useState(true); 
  const [isUnityInstanceReadyInParent, setIsUnityInstanceReadyInParent] = useState(false); 

  const nftsRef = useRef(nfts);
  const cnftsRef = useRef(cnfts);
  const tokensRef = useRef(tokens);
  const solBalanceRef = useRef(_solBalance);
  const allFetchedAssetsRef = useRef<Asset[]>([]);
  const isSubmittingTransactionRef = useRef(isSubmittingTransaction);
  const rpcUrlRef = useRef(rpcUrl);
  const currentNetworkRef = useRef(currentNetwork);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const unityInstanceOnIframeRef = useRef<IframeUnityWindow["unityInstance"] | null>(null);
  const unityQuitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const checkForUnityInstanceIntervalId = useRef<NodeJS.Timeout | null>(null);


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
      try {
        unityInstanceOnIframeRef.current.SendMessage(gameObjectName, methodName, msgStr);
        console.log(`[ParentPage] Sent to Unity in iframe: ${gameObjectName}.${methodName}`, message);
      } catch (e) {
        console.error(`[ParentPage] Error sending message to Unity in iframe: ${gameObjectName}.${methodName}`, e, "Message was:", message, "Unity instance ref:", unityInstanceOnIframeRef.current);
      }
    } else {
      console.warn(`[ParentPage] sendToUnity: Unity instance (SendMessage) not available on iframe or parent not ready. Cannot send. isUnityInstanceReadyInParent: ${isUnityInstanceReadyInParent}. unityInstanceOnIframeRef.current:`, unityInstanceOnIframeRef.current);
    }
  }, [isUnityInstanceReadyInParent]);


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
        console.error("[ParentPage] Failed to fetch SOL balance:", error);
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
      console.error("[ParentPage] Failed to load assets:", error);
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
    if (!isUnityInstanceReadyInParent) {
      console.log("[ParentPage WalletEffect] Unity instance not ready IN PARENT, skipping asset load/wallet status update to Unity.");
      return;
    }
    if (connected && publicKey && rpcUrlRef.current && connection && walletHook) {
      console.log("[ParentPage WalletEffect] Wallet connected AND Unity ready. Sending OnWalletConnected to Unity and loading assets.");
      sendToUnity("GameBridgeManager", "OnWalletConnected", { publicKey: publicKey.toBase58() });
      debouncedLoadUserAssets(publicKey, rpcUrlRef.current, connection, walletHook);
    } else if (!connected) {
      console.log("[ParentPage WalletEffect] Wallet disconnected AND Unity ready. Sending OnWalletDisconnected to Unity.");
      sendToUnity("GameBridgeManager", "OnWalletDisconnected", {}); 
      setNfts([]); setCnfts([]); setTokens([]); _setSolBalance(0);
    }
  }, [connected, publicKey, connection, walletHook, debouncedLoadUserAssets, sendToUnity, isUnityInstanceReadyInParent]);

  const buildUnityBridge = useCallback(() => {
    console.log("[ParentPage] buildUnityBridge CALLED. Wallet connected:", walletHook.connected, "PK:", walletHook.publicKey?.toBase58()?.substring(0,6));
    return {
      connectWallet: async () => {
        console.log("[ParentPage Bridge] bridge.connectWallet CALLED. walletHook.wallet:", walletHook.wallet?.adapter.name, "walletHook.connected:", walletHook.connected);
        if (walletHook.connected && walletHook.publicKey) {
            console.log("[ParentPage Bridge] connectWallet: Already connected. Sending OnWalletConnected.");
            sendToUnity("GameBridgeManager", "OnWalletConnected", { publicKey: walletHook.publicKey.toBase58() });
            return;
        }
        if (!walletHook.wallet) {
            console.warn("[ParentPage Bridge] connectWallet: No wallet type selected. Opening wallet selection modal.");
            setTimeout(() => walletModal.setVisible(true), 0); 
            sendToUnity("GameBridgeManager", "OnWalletSelectionNeeded", {message: "Please select a wallet using the Connect Wallet button."});
            return;
        }
        const adapterState = walletHook.wallet.adapter.readyState;
        if (adapterState !== WalletReadyState.Installed && adapterState !== WalletReadyState.Loadable) {
           const notReadyMsg = `Wallet ${walletHook.wallet.adapter.name} is not ready (State: ${adapterState}). Please ensure it's installed or try another.`;
           console.warn(`[ParentPage Bridge] connectWallet: ${notReadyMsg}`);
           setTimeout(() => walletModal.setVisible(true), 0); 
           sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: notReadyMsg, action: "connect_wallet_not_ready"});
           toast({ title: "Wallet Not Ready", description: notReadyMsg, variant: "default" });
           return;
        }
        try {
          console.log("[ParentPage Bridge] Attempting wallet connection via adapter...");
          await connectWalletAdapter(); 
          console.log("[ParentPage Bridge] connectWalletAdapter call completed.");
        } catch (error: any) {
          console.error("[ParentPage Bridge] Error during connectWalletAdapter:", error);
          sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: error.message, details: error.name, action: "connect_wallet_attempt" });
          toast({ title: "Wallet Connection Error", description: `${error.name}: ${error.message}`, variant: "destructive" });
        }
      },
      isWalletConnected: () => {
        const currentlyConnected = walletHook.connected;
        const pk = walletHook.publicKey?.toBase58() || null;
        console.log(`[ParentPage Bridge] isWalletConnected called. Result: ${currentlyConnected}, PK: ${pk ? pk.substring(0,6) : 'N/A'}`);
        sendToUnity("GameBridgeManager", "OnWalletConnectionStatus", { isConnected: currentlyConnected, publicKey: pk });
        return currentlyConnected;
      },
      getPublicKey: () => {
        const pk = walletHook.publicKey?.toBase58() || null;
        console.log(`[ParentPage Bridge] getPublicKey called. Result: ${pk ? pk.substring(0,6) : 'N/A'}`);
        sendToUnity("GameBridgeManager", "OnPublicKeyReceived", { publicKey: pk });
        return pk;
      },
      disconnectWallet: async () => {
        console.log("[ParentPage Bridge] bridge.disconnectWallet CALLED.");
        try {
          await disconnectWalletAdapter();
          console.log("[ParentPage Bridge] disconnectWalletAdapter call completed.");
        } catch (error: any) {
          console.error("[ParentPage Bridge] Error during disconnectWalletAdapter:", error);
          sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "disconnect_wallet" });
          toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
        }
      },
      getAvailableWallets: () => {
        const available = availableWallets.map(w => ({ name: w.adapter.name, icon: w.adapter.icon, readyState: w.adapter.readyState }));
        console.log("[ParentPage Bridge] getAvailableWallets called. Found:", available);
        sendToUnity("GameBridgeManager", "OnAvailableWalletsReceived", { wallets: available });
        return available;
      },
      selectWallet: async (walletName: string) => {
        console.log(`[ParentPage Bridge] bridge.selectWallet CALLED with: ${walletName}`);
        try {
          const targetWallet = availableWallets.find(w => w.adapter.name === walletName);
          if (!targetWallet) {
            const err = `Wallet ${walletName} not available or not installed.`;
            console.warn(`[ParentPage Bridge] selectWallet: ${err}`);
            toast({ title: "Wallet Selection Error", description: err, variant: "destructive" });
            sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: err, action: "select_wallet_not_found_or_ready" });
            return;
          }
          select(walletName as WalletName); 
          console.log(`[ParentPage Bridge] Wallet selected: ${walletName}. Adapter state: ${targetWallet.adapter.readyState}`);
          sendToUnity("GameBridgeManager", "OnWalletSelectAttempted", { walletName });
        } catch (error: any) {
          console.error("[ParentPage Bridge] Error during selectWallet:", error);
          sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "select_wallet_exception" });
          toast({ title: "Wallet Selection Error", description: error.message, variant: "destructive" });
        }
      },
      getUserNFTs: async () => {
        console.log("[ParentPage Bridge] bridge.getUserNFTs CALLED.");
        if (!walletHook.publicKey || !connection) { 
            console.warn("[ParentPage Bridge] getUserNFTs: Wallet not connected or connection not available.");
            sendToUnity("GameBridgeManager", "OnUserNFTsRequested", { error: "Wallet not connected", nfts: [], cnfts: [] }); 
            return; 
        }
        setIsLoadingAssets(true); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
        try {
            const { nfts: fetchedNfts, cnfts: fetchedCnfts, heliusWarning } = await fetchAssetsForOwner(walletHook.publicKey.toBase58(), rpcUrlRef.current, connection, walletHook);
            if (heliusWarning) sendToUnity("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            setNfts(fetchedNfts); setCnfts(fetchedCnfts);
            sendToUnity("GameBridgeManager", "OnUserNFTsRequested", { nfts: nftsRef.current, cnfts: cnftsRef.current });
            console.log(`[ParentPage Bridge] getUserNFTs: Fetched ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs.`);
        } catch (e:any) { 
            console.error("[ParentPage Bridge] Error in getUserNFTs:", e);
            sendToUnity("GameBridgeManager", "OnUserNFTsRequested", { error: e.message, nfts:[], cnfts:[]});
        } finally { setIsLoadingAssets(false); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
      },
      getUserTokens: async () => {
         console.log("[ParentPage Bridge] bridge.getUserTokens CALLED.");
         if (!walletHook.publicKey || !connection) { 
             console.warn("[ParentPage Bridge] getUserTokens: Wallet not connected or connection not available.");
             sendToUnity("GameBridgeManager", "OnUserTokensRequested", { error: "Wallet not connected", tokens: [], solBalance: 0 }); return; 
        }
        setIsLoadingAssets(true); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
        try {
            const [fetchedSol, { tokens: fetchedTokensFromHelius, heliusWarning }] = await Promise.all([
                fetchSolBalanceInternal(walletHook.publicKey, connection),
                fetchAssetsForOwner(walletHook.publicKey.toBase58(), rpcUrlRef.current, connection, walletHook)
            ]);
            if (heliusWarning) sendToUnity("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            setTokens(fetchedTokensFromHelius.filter(a => a.type === 'token') as SplToken[]);
            sendToUnity("GameBridgeManager", "OnUserTokensRequested", { tokens: tokensRef.current, solBalance: solBalanceRef.current });
            console.log(`[ParentPage Bridge] getUserTokens: Fetched ${tokensRef.current.length} tokens, SOL: ${solBalanceRef.current}.`);
        } catch (e:any) { 
            console.error("[ParentPage Bridge] Error in getUserTokens:", e);
            sendToUnity("GameBridgeManager", "OnUserTokensRequested", { error: e.message, tokens:[], solBalance: 0});
        } finally { setIsLoadingAssets(false); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
      },
      getSolBalance: async () => {
        console.log("[ParentPage Bridge] bridge.getSolBalance CALLED.");
        if (!walletHook.publicKey || !connection) { 
            console.warn("[ParentPage Bridge] getSolBalance: Wallet not connected or connection not available.");
            sendToUnity("GameBridgeManager", "OnSolBalanceUpdateFailed", { error: "Wallet not connected" }); 
            return 0; 
        }
        return fetchSolBalanceInternal(walletHook.publicKey, connection);
      },
      transferSOL: async (amountSol: number, toAddress: string) => {
        console.log(`[ParentPage Bridge] bridge.transferSOL CALLED. Amount: ${amountSol}, To: ${toAddress.substring(0,6)}`);
        if (isSubmittingTransactionRef.current) { console.warn("[ParentPage Bridge] transferSOL: Transaction already in progress."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Transaction in progress" }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { console.warn("[ParentPage Bridge] transferSOL: Wallet not connected."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Wallet not connected" }); return; }
        if (amountSol <= 0) { console.warn("[ParentPage Bridge] transferSOL: Amount must be positive."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Amount must be positive" }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: true });
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          const signature = await transferSol(connection, walletHook, recipientPublicKey, amountSol);
          toast({ title: "SOL Transfer Initiated", description: `Signature: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "transfer_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
          if(walletHook.publicKey && connection) fetchSolBalanceInternal(walletHook.publicKey, connection);
        } catch (error: any) { console.error("[ParentPage Bridge] Error in transferSOL:", error); toast({ title: "SOL Transfer Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: error.message });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: false }); }
      },
      transferToken: async (mint: string, amount: number, toAddress: string) => {
        console.log(`[ParentPage Bridge] bridge.transferToken CALLED. Mint: ${mint.substring(0,6)}, Amount: ${amount}, To: ${toAddress.substring(0,6)}`);
        if (isSubmittingTransactionRef.current) { console.warn("[ParentPage Bridge] transferToken: Transaction already in progress."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Transaction in progress", mint }); return; }
        const token = tokensRef.current.find(t => t.id === mint);
        if (!token) { console.warn(`[ParentPage Bridge] transferToken: Token ${mint.substring(0,6)} not found in wallet.`); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Token not found in wallet", mint }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { console.warn("[ParentPage Bridge] transferToken: Wallet not connected."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Wallet not connected", mint }); return; }
        if (amount <= 0) { console.warn("[ParentPage Bridge] transferToken: Amount must be positive."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Amount must be positive", mint }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_token", submitting: true, mint });
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          const signature = await transferSplToken(connection, walletHook, token, recipientPublicKey, amount);
          toast({ title: "Token Transfer Initiated", description: `${token.symbol} Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "transfer_token", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { console.error("[ParentPage Bridge] Error in transferToken:", error); toast({ title: "Token Transfer Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: error.message, mint });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_token", submitting: false, mint }); }
      },
      transferNFT: async (mint: string, toAddress: string) => {
        console.log(`[ParentPage Bridge] bridge.transferNFT CALLED. Mint: ${mint.substring(0,6)}, To: ${toAddress.substring(0,6)}`);
        if (isSubmittingTransactionRef.current) { console.warn("[ParentPage Bridge] transferNFT: Transaction already in progress."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "Transaction in progress", mint }); return; }
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint && (a.type === 'nft' || a.type === 'cnft'));
        if (!asset) { console.warn(`[ParentPage Bridge] transferNFT: Asset ${mint.substring(0,6)} not found.`); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "NFT/cNFT not found", mint }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { console.warn("[ParentPage Bridge] transferNFT: Wallet not connected."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "Wallet not connected", mint }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_nft", submitting: true, mint });
        let signature;
        try {
          const recipientPublicKey = new PublicKey(toAddress);
          if (asset.type === 'nft') signature = await transferNft(connection, walletHook, asset as Nft, recipientPublicKey);
          else if (asset.type === 'cnft') signature = await transferCNft(connection, walletHook, asset as CNft, recipientPublicKey, rpcUrlRef.current);
          else throw new Error("Asset not transferable as NFT/cNFT.");
          toast({ title: "NFT Transfer Initiated", description: `Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "transfer_nft", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { console.error("[ParentPage Bridge] Error in transferNFT:", error); toast({ title: "NFT Transfer Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: error.message, mint });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "transfer_nft", submitting: false, mint }); }
      },
      burnSOL: async (amountSol: number) => {
        console.log(`[ParentPage Bridge] bridge.burnSOL CALLED. Amount: ${amountSol}`);
        if (isSubmittingTransactionRef.current) { console.warn("[ParentPage Bridge] burnSOL: Transaction already in progress."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Transaction in progress" }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { console.warn("[ParentPage Bridge] burnSOL: Wallet not connected."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Wallet not connected" }); return; }
        if (amountSol <= 0) { console.warn("[ParentPage Bridge] burnSOL: Amount must be positive."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Amount must be positive" }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: true });
        try {
          const signature = await burnSol(connection, walletHook, amountSol);
          toast({ title: "SOL Burn Initiated", description: `Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "burn_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
          if(walletHook.publicKey && connection) fetchSolBalanceInternal(walletHook.publicKey, connection);
        } catch (error: any) { console.error("[ParentPage Bridge] Error in burnSOL:", error); toast({ title: "SOL Burn Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: error.message });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: false }); }
      },
      burnNFT: async (mint: string, amount?: number) => { 
        console.log(`[ParentPage Bridge] bridge.burnNFT (asset) CALLED. Mint: ${mint.substring(0,6)}, Amount: ${amount}`);
        if (isSubmittingTransactionRef.current) { console.warn("[ParentPage Bridge] burnNFT: Transaction already in progress."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Transaction in progress", mint }); return; }
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint);
        if (!asset) { console.warn(`[ParentPage Bridge] burnNFT: Asset ${mint.substring(0,6)} not found.`); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Asset not found", mint }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { console.warn("[ParentPage Bridge] burnNFT: Wallet not connected."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Wallet not connected", mint }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: true, mint });
        let signature;
        try {
          if (asset.type === 'nft') signature = await burnNft(connection, walletHook, asset as Nft);
          else if (asset.type === 'cnft') signature = await burnCNft(connection, walletHook, asset as CNft, rpcUrlRef.current);
          else if (asset.type === 'token') {
             if (typeof amount !== 'number' || amount <= 0) { 
                 console.warn("[ParentPage Bridge] burnNFT: Invalid amount for token burn."); 
                 sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Invalid amount for token burn.", mint }); 
                 setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: false, mint }); 
                 return; 
             }
             signature = await burnSplToken(connection, walletHook, asset as SplToken, amount);
          } else throw new Error("Asset type not burnable.");
          toast({ title: "Asset Burn Initiated", description: `Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "burn_asset", signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { console.error("[ParentPage Bridge] Error in burnNFT:", error); toast({ title: "Asset Burn Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: error.message, mint });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: false, mint }); }
      },
      mintNFT: async (name: string, symbol: string, metadataUri: string) => {
        console.log(`[ParentPage Bridge] bridge.mintNFT CALLED. Name: ${name}, Symbol: ${symbol}`);
        if (isSubmittingTransactionRef.current) { console.warn("[ParentPage Bridge] mintNFT: Transaction already in progress."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Transaction in progress" }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !walletHook.signTransaction || !connection) { console.warn("[ParentPage Bridge] mintNFT: Wallet not connected or sign issue."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Wallet not connected/sign issue" }); return; }
        if (currentNetworkRef.current === 'mainnet-beta') { 
            toast({ title: "Minting Disabled", description: "NFT minting disabled on Mainnet.", variant: "destructive" }); 
            sendToUnity("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Minting disabled on Mainnet" }); return; 
        }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "mint_nft", submitting: true, name, symbol, metadataUri });
        try {
          const signature = await mintStandardNft(connection, walletHook, metadataUri, name, symbol);
          toast({ title: "NFT Mint Successful!", description: `Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a>});
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "mint_nft", signature, name, symbol, metadataUri, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { console.error("[ParentPage Bridge] Error in mintNFT:", error); toast({ title: "NFT Mint Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: error.message, name, symbol, metadataUri });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "mint_nft", submitting: false, name, symbol, metadataUri }); }
      },
      swapTokens: async () => {
        const msg = "Token swapping is not yet implemented.";
        console.warn(`[ParentPage Bridge] bridge.swapTokens CALLED. ${msg}`);
        toast({ title: "Feature Unavailable", description: msg }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "swap_tokens", error: msg });
      },
      depositFunds: async (tokenMintOrSol: string, amount: number) => {
        console.log(`[ParentPage Bridge] bridge.depositFunds CALLED. Asset: ${tokenMintOrSol === "SOL" ? "SOL" : tokenMintOrSol.substring(0,6)}, Amount: ${amount}`);
        if (isSubmittingTransactionRef.current) { console.warn("[ParentPage Bridge] depositFunds: Transaction already in progress."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Transaction in progress", tokenMint: tokenMintOrSol }); return; }
        if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { console.warn("[ParentPage Bridge] depositFunds: Wallet not connected."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Wallet not connected", tokenMint: tokenMintOrSol }); return; }
        if (!CUSTODIAL_WALLET_ADDRESS) { console.warn("[ParentPage Bridge] depositFunds: Custodial address not set."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Custodial address not set", tokenMint: tokenMintOrSol }); return; }
        if (amount <= 0) { console.warn("[ParentPage Bridge] depositFunds: Amount must be positive."); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Amount must be positive", tokenMint: tokenMintOrSol }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: true, tokenMint: tokenMintOrSol });
        try {
          let signature;
          if (tokenMintOrSol.toUpperCase() === "SOL") signature = await depositSol(connection, walletHook, amount, CUSTODIAL_WALLET_ADDRESS);
          else {
            const token = tokensRef.current.find(t => t.id === tokenMintOrSol);
            if (!token) { 
                console.warn(`[ParentPage Bridge] depositFunds: Token ${tokenMintOrSol.substring(0,6)} not found for deposit.`); 
                sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Token not found for deposit.", tokenMint: tokenMintOrSol }); 
                setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: false, tokenMint: tokenMintOrSol }); return; }
            signature = await depositSplToken(connection, walletHook, token, amount, CUSTODIAL_WALLET_ADDRESS);
          }
          toast({ title: "Deposit Initiated", description: `Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
          sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: "deposit_funds", signature, tokenMint: tokenMintOrSol, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
           if (walletHook.publicKey && rpcUrlRef.current && connection && walletHook) debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } catch (error: any) { console.error("[ParentPage Bridge] Error in depositFunds:", error); toast({ title: "Deposit Failed", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: error.message, tokenMint: tokenMintOrSol });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "deposit_funds", submitting: false, tokenMint: tokenMintOrSol }); }
      },
      withdrawFunds: async (tokenMintOrSol: string, grossAmount: number) => {
        console.log(`[ParentPage Bridge] bridge.withdrawFunds CALLED. Asset: ${tokenMintOrSol === "SOL" ? "SOL" : tokenMintOrSol.substring(0,6)}, Gross Amount: ${grossAmount}`);
        if (isSubmittingTransactionRef.current) { console.warn("[ParentPage Bridge] withdrawFunds: Transaction already in progress."); sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Transaction in progress", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
        if (!walletHook.publicKey) { console.warn("[ParentPage Bridge] withdrawFunds: Wallet not connected."); sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Wallet not connected", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
        if (grossAmount <= 0) { console.warn("[ParentPage Bridge] withdrawFunds: Amount must be positive."); sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Amount must be positive", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
        setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: true, tokenMint: tokenMintOrSol });
        try {
          let result: WithdrawalResponse;
          if (tokenMintOrSol.toUpperCase() === "SOL") result = await initiateWithdrawalRequest(walletHook.publicKey.toBase58(), grossAmount, currentNetworkRef.current);
          else {
            const token = allFetchedAssetsRef.current.find(a => a.id === tokenMintOrSol && a.type === 'token') as SplToken | undefined;
            if (!token) { 
                console.warn(`[ParentPage Bridge] withdrawFunds: Token details for ${tokenMintOrSol.substring(0,6)} not available for withdrawal.`);
                sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: `Token details not available for withdrawal.`, action: "withdraw_funds", tokenMint: tokenMintOrSol }); 
                setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); 
                return; 
            }
             result = await initiateWithdrawalRequest(walletHook.publicKey.toBase58(), grossAmount, currentNetworkRef.current, token);
          }
          if (result.success) toast({ title: "Withdrawal Processed", description: result.signature ? `Sig: ${result.signature.substring(0,10)}...` : result.message, action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> : undefined });
          else toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
          sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetworkRef.current) : undefined });
        } catch (error: any) { console.error("[ParentPage Bridge] Error in withdrawFunds:", error); toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint: tokenMintOrSol });
        } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); }
      },
      setNetwork: (network: SupportedSolanaNetwork) => {
        console.log(`[ParentPage Bridge] bridge.setNetwork CALLED. Network: ${network}`);
        setCurrentNetwork(network); 
        sendToUnity("GameBridgeManager", "OnNetworkChanged", { network });
      },
      getCurrentNetwork: () => {
        console.log(`[ParentPage Bridge] bridge.getCurrentNetwork CALLED. Returning: ${currentNetworkRef.current}`);
        sendToUnity("GameBridgeManager", "OnCurrentNetworkReceived", { network: currentNetworkRef.current });
        return currentNetworkRef.current;
      },
    };
  }, [
    walletHook, connection, walletModal, connectWalletAdapter, disconnectWalletAdapter, select, availableWallets,
    sendToUnity, toast, fetchSolBalanceInternal, debouncedLoadUserAssets, setCurrentNetwork, 
  ]);

  // Effect for Unity instance lifecycle (Quit on parent unmount)
  useEffect(() => {
    console.log('[ParentPage] HomePage component mounted. Iframe will be rendered.');
    
    return () => {
      console.log("[ParentPage] HomePage unmounting. Attempting to quit Unity instance in iframe.");
      if (checkForUnityInstanceIntervalId.current) {
        clearInterval(checkForUnityInstanceIntervalId.current);
        checkForUnityInstanceIntervalId.current = null;
        console.log("[ParentPage] Cleared polling interval for unityInstance.");
      }
      if (unityInstanceOnIframeRef.current && typeof unityInstanceOnIframeRef.current.Quit === 'function') {
        if (unityQuitTimerRef.current) clearTimeout(unityQuitTimerRef.current);
        unityQuitTimerRef.current = setTimeout(() => {
          if (unityInstanceOnIframeRef.current && typeof unityInstanceOnIframeRef.current.Quit === 'function') {
            console.log("[ParentPage] Executing delayed Quit for Unity instance in iframe.");
            unityInstanceOnIframeRef.current.Quit().then(() => {
              console.log("[ParentPage] Unity instance in iframe quit successfully after delay.");
            }).catch((err: any) => {
              console.error("[ParentPage] Error quitting Unity instance in iframe after delay:", err);
            });
            unityInstanceOnIframeRef.current = null; 
          }
        }, 250); 
      } else {
        console.warn("[ParentPage] No Unity instance or Quit function found on iframe to call on unmount.");
      }
      setIsUnityInstanceReadyInParent(false); 
      setIsIframeLoading(true); 
      if ((window as any).unityBridge) {
        console.log("[ParentPage] Deleting window.unityBridge on unmount.");
        delete (window as any).unityBridge;
      }
      if ((window as any).callConnectWalletFromUnity) {
        console.log("[ParentPage] Deleting window.callConnectWalletFromUnity on unmount.");
        delete (window as any).callConnectWalletFromUnity;
      }
    };
  }, []); 

  // Effect to manage the window.unityBridge and global helper functions
  useEffect(() => {
    console.log("[ParentPage Bridge Management Effect] Triggered. isUnityInstanceReadyInParent:", isUnityInstanceReadyInParent);
    if (isUnityInstanceReadyInParent) {
      console.log("[ParentPage] Unity instance IS ready IN PARENT. DEFINING/UPDATING window.unityBridge now.");
      const bridge = buildUnityBridge();
      (window as any).unityBridge = bridge; 
      console.log("[ParentPage] window.unityBridge DEFINED on parent window. Keys:", Object.keys((window as any).unityBridge).join(", "));

      if (!(window as any).callConnectWalletFromUnity) {
        (window as any).callConnectWalletFromUnity = () => {
          console.log("[ParentPage Global] callConnectWalletFromUnity() INVOKED on parent.");
          if ((window as any).unityBridge && typeof (window as any).unityBridge.connectWallet === 'function') {
            (window as any).unityBridge.connectWallet();
          } else {
            console.error("[ParentPage Global ERROR] window.unityBridge.connectWallet not available. window.unityBridge:", (window as any).unityBridge);
            sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: "Parent Bridge connectWallet not ready." });
          }
        };
        console.log("[ParentPage] Global 'callConnectWalletFromUnity' DEFINED on parent.");
      }
    } else {
      console.log("[ParentPage] Unity instance NOT ready IN PARENT. Deferring bridge definition or bridge already cleaned up.");
      if ((window as any).unityBridge) {
        console.log("[ParentPage] Deleting existing window.unityBridge as Unity is no longer ready.");
        delete (window as any).unityBridge;
      }
      if ((window as any).callConnectWalletFromUnity) {
        console.log("[ParentPage] Deleting existing window.callConnectWalletFromUnity as Unity is no longer ready.");
        delete (window as any).callConnectWalletFromUnity;
      }
    }
  }, [isUnityInstanceReadyInParent, buildUnityBridge, sendToUnity]);


  const handleIframeLoad = useCallback(() => {
    console.log("[ParentPage] Iframe loaded src: /index.html. Starting to poll for unityInstance in iframe's contentWindow.");
    setIsIframeLoading(false); 

    let attempts = 0;
    const intervalTime = 500; 
    const logInterval = 10; // Log every 5 seconds (10 attempts * 500ms)

    if (checkForUnityInstanceIntervalId.current) {
        clearInterval(checkForUnityInstanceIntervalId.current);
    }

    const checkForUnityInstance = () => {
      attempts++;
      if (iframeRef.current && iframeRef.current.contentWindow) {
        const iframeContentWindow = iframeRef.current.contentWindow as IframeUnityWindow;
        
        if (iframeContentWindow.unityInstance && typeof iframeContentWindow.unityInstance.SendMessage === 'function') {
          if (checkForUnityInstanceIntervalId.current) {
            clearInterval(checkForUnityInstanceIntervalId.current);
            checkForUnityInstanceIntervalId.current = null;
          }
          console.log(`[ParentPage SUCC] unityInstance FOUND in iframe after ${attempts} attempts (approx ${attempts * intervalTime / 1000}s). Setting isUnityInstanceReadyInParent to true. Unity instance keys: ${iframeContentWindow.unityInstance ? Object.keys(iframeContentWindow.unityInstance).join(', ') : 'N/A'}`);
          unityInstanceOnIframeRef.current = iframeContentWindow.unityInstance;
          setIsUnityInstanceReadyInParent(true); 
          
          console.log("[ParentPage] Signaling to Unity (GameBridgeManager.OnUnityReady) that parent page bridge is set up.");
          sendToUnity("GameBridgeManager", "OnUnityReady", {}); 
          return; 
        } else {
            if (attempts === 1 || (attempts % logInterval === 0) ) {
                console.log(`[ParentPage Polling Attempt ${attempts}] unityInstance not yet available in iframe. Retrying... iframeContentWindow exists: ${!!iframeContentWindow}. unityInstance type: ${typeof iframeContentWindow.unityInstance}. SendMessage type: ${typeof iframeContentWindow.unityInstance?.SendMessage}`);
                 if (iframeContentWindow && typeof iframeContentWindow === 'object' && (attempts % (logInterval * 2) === 0 || attempts === 1 )) { 
                    const keys = Object.keys(iframeContentWindow);
                    if (keys.includes("unityInstance")) {
                        console.log(`[ParentPage Polling Attempt ${attempts}] 'unityInstance' key FOUND on iframeContentWindow. Value:`, iframeContentWindow.unityInstance, `Keys of unityInstance: ${iframeContentWindow.unityInstance ? Object.keys(iframeContentWindow.unityInstance).join(', ') : 'N/A'}`);
                    } else {
                        console.warn(`[ParentPage Polling Attempt ${attempts}] 'unityInstance' key NOT found. Available keys on iframe's window (sample): ${keys.slice(0, 20).join(', ')}... Total keys: ${keys.length}`);
                    }
                }
            }
        }
      } else {
        if (attempts === 1 || (attempts % logInterval === 0) ) {
            console.warn(`[ParentPage Polling Attempt ${attempts}] Iframe or contentWindow not available. iframeRef.current: ${!!iframeRef.current}, iframeRef.current.contentWindow: ${!!iframeRef.current?.contentWindow}. Cannot check for unityInstance.`);
        }
      }
    };
    
    checkForUnityInstanceIntervalId.current = setInterval(checkForUnityInstance, intervalTime);

  }, [sendToUnity, toast]); 


  const gameBaseNameOrDefault = UNITY_GAME_BUILD_BASE_NAME || "MyGame";
  if (!process.env.NEXT_PUBLIC_UNITY_GAME_BUILD_BASE_NAME && UNITY_GAME_BUILD_BASE_NAME === "MyGame" ) {
      console.warn(`[ParentPage WARN] UNITY_GAME_BUILD_BASE_NAME is using default "MyGame". Ensure NEXT_PUBLIC_UNITY_GAME_BUILD_BASE_NAME env var is set if you have a custom logo/game name, or if your Unity build files are named differently, especially for the loading logo.`);
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
        {isIframeLoading && (
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
             <p className="text-lg text-foreground mt-4">Initializing Game Environment...</p>
             <svg className="animate-spin h-8 w-8 text-primary mt-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
             </svg>
             <p className="text-sm text-muted-foreground mt-6 px-4 text-center max-w-md">
                Ensure your Unity build's <code>index.html</code> is placed at <code>public/index.html</code> and its <code>Build</code> folder contents are in <code>public/Build/</code>.
             </p>
             <p className="text-xs text-muted-foreground mt-2 px-4 text-center">If stuck, check browser console (F12) for errors in both parent and iframe (right-click game &gt; Inspect iframe).</p>
          </div>
        )}
        <iframe
            id="unity-iframe"
            ref={iframeRef}
            src="/index.html" 
            className={`w-full h-full border-0 ${isIframeLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}
            title="Unity Game"
            onLoad={handleIframeLoad}
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals" 
            allowFullScreen 
        ></iframe>
      </main>
    </div>
  );
}
    
