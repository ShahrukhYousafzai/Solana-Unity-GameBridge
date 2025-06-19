
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { type WalletName, WalletReadyState, type WalletAdapter } from "@solana/wallet-adapter-base";
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
import { 
  CUSTODIAL_WALLET_ADDRESS, 
  SOL_DECIMALS, 
  UNITY_COMPANY_NAME,
  UNITY_PRODUCT_NAME,
  UNITY_PRODUCT_VERSION
} from "@/config";
import { Skeleton } from "@/components/ui/skeleton";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Unity, useUnityContext } from "react-unity-webgl";

const ConnectWalletButton = dynamic(
  () => import("@/components/ConnectWalletButton").then((mod) => mod.ConnectWalletButton),
  {
    ssr: false,
    loading: () => <Skeleton className="h-10 w-32 rounded-md" />
  }
);

declare global {
  interface Window {
    handleConnectWalletRequest?: (walletName?: string) => void;
    handleIsWalletConnectedRequest?: () => boolean;
    handleGetPublicKeyRequest?: () => string | null;
    handleDisconnectWalletRequest?: () => void;
    handleGetAvailableWalletsRequest?: () => any[];
    handleSelectWalletRequest?: (walletName: string) => void;
    handleGetUserNFTsRequest?: () => void;
    handleGetUserTokensRequest?: () => void;
    handleGetSolBalanceRequest?: () => Promise<number>;
    handleTransferSOLRequest?: (amountSol: number, toAddress: string) => void;
    handleTransferTokenRequest?: (mint: string, amount: number, toAddress: string) => void;
    handleTransferNFTRequest?: (mint: string, toAddress: string) => void;
    handleBurnSOLRequest?: (amountSol: number) => void;
    handleBurnAssetRequest?: (mint: string, amount?: number) => void;
    handleMintNFTRequest?: (name: string, symbol: string, metadataUri: string) => void;
    handleSwapTokensRequest?: () => void; // Placeholder
    handleDepositFundsRequest?: (tokenMintOrSol: string, amount: number) => void;
    handleWithdrawFundsRequest?: (tokenMintOrSol: string, grossAmount: number) => void;
    handleSetNetworkRequest?: (network: SupportedSolanaNetwork) => void;
    handleGetCurrentNetworkRequest?: () => SupportedSolanaNetwork;
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
  const { wallets: availableWallets, select, wallet: currentWalletAdapterDetails, connect: walletConnect } = walletHook; 
  const { toast } = useToast();
  const { currentNetwork, setCurrentNetwork, rpcUrl } = useNetwork();
  const walletModal = useWalletModal();
  
  const walletHookRef = useRef(walletHook); 
  useEffect(() => { walletHookRef.current = walletHook; }, [walletHook]);

  const gameProductNameOrDefault = UNITY_PRODUCT_NAME || "MyGame";
  const gameCompanyNameOrDefault = UNITY_COMPANY_NAME || "DefaultCompany";
  const gameProductVersionOrDefault = UNITY_PRODUCT_VERSION || "1.0";

  const { unityProvider, isLoaded, loadingProgression, sendMessage, addEventListener, removeEventListener, UNSAFE__detachAndUnloadImmediate: detachAndUnload } = useUnityContext({
    loaderUrl: `/Build/${gameProductNameOrDefault}.loader.js`,
    dataUrl: `/Build/${gameProductNameOrDefault}.data`,
    frameworkUrl: `/Build/${gameProductNameOrDefault}.framework.js`,
    codeUrl: `/Build/${gameProductNameOrDefault}.wasm`,
    companyName: gameCompanyNameOrDefault,
    productName: gameProductNameOrDefault,
    productVersion: gameProductVersionOrDefault,
  });

  const [nfts, setNfts] = useState<Nft[]>([]);
  const [cnfts, setCnfts] = useState<CNft[]>([]);
  const [tokens, setTokens] = useState<SplToken[]>([]);
  const [_solBalance, _setSolBalance] = useState<number>(0); 
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);
  const [currentDevicePixelRatio, setCurrentDevicePixelRatio] = useState<number | undefined>(undefined);
  const [isClientMounted, setIsClientMounted] = useState(false);


  const nftsRef = useRef(nfts);
  const cnftsRef = useRef(cnfts);
  const tokensRef = useRef(tokens);
  const solBalanceRef = useRef(_solBalance);
  const allFetchedAssetsRef = useRef<Asset[]>([]);
  const isSubmittingTransactionRef = useRef(isSubmittingTransaction);
  const rpcUrlRef = useRef(rpcUrl);
  const currentNetworkRef = useRef(currentNetwork);
  
  useEffect(() => { nftsRef.current = nfts; }, [nfts]);
  useEffect(() => { cnftsRef.current = cnfts; }, [cnfts]);
  useEffect(() => { tokensRef.current = tokens; }, [tokens]);
  useEffect(() => { solBalanceRef.current = _solBalance; }, [_solBalance]);
  useEffect(() => { allFetchedAssetsRef.current = [...nftsRef.current, ...cnftsRef.current, ...tokensRef.current]; }, [nfts, cnfts, tokens]);
  useEffect(() => { isSubmittingTransactionRef.current = isSubmittingTransaction; }, [isSubmittingTransaction]);
  useEffect(() => { rpcUrlRef.current = rpcUrl; }, [rpcUrl]);
  useEffect(() => { currentNetworkRef.current = currentNetwork; }, [currentNetwork]);

 useEffect(() => {
    setIsClientMounted(true);
    if (typeof window !== 'undefined') {
      setCurrentDevicePixelRatio(window.devicePixelRatio);
    }
  }, []);

  const sendToUnityGame = useCallback((gameObjectName: string, methodName: string, message: any) => {
    if (isLoaded && sendMessage) { 
      const replacer = (key: string, value: any) => (typeof value === 'bigint' ? value.toString() : value);
      const msgStr = typeof message === 'object' ? JSON.stringify(message, replacer) : String(message);
      try {
        sendMessage(gameObjectName, methodName, msgStr);
        console.log(`[Page RUW] Sent to Unity: ${gameObjectName}.${methodName}`, typeof message === 'string' ? message : JSON.stringify(message, null, 2).substring(0,200) + "...");
      } catch (e) {
        console.error(`[Page RUW] Error sending message to Unity: ${gameObjectName}.${methodName}`, e, "Message was:", message);
      }
    } else {
      console.warn(`[Page RUW] sendToUnityGame: Unity not loaded or sendMessage not available. Cannot send. isLoaded: ${isLoaded}, sendMessage: ${!!sendMessage}. Target: ${gameObjectName}.${methodName}`);
    }
  }, [isLoaded, sendMessage]);


  const fetchSolBalanceInternal = useCallback(async (): Promise<number> => {
    const currentPk = walletHookRef.current.publicKey;
    if (currentPk && connection) {
      try {
        const balance = await connection.getBalance(currentPk);
        const sol = balance / LAMPORTS_PER_SOL;
        _setSolBalance(sol);
        sendToUnityGame("GameBridgeManager", "OnSolBalanceUpdated", { solBalance: sol });
        return sol;
      } catch (error: any) {
        console.error("[Page RUW] Failed to fetch SOL balance:", error);
        toast({ title: "Error Fetching SOL Balance", description: error.message, variant: "destructive" });
        sendToUnityGame("GameBridgeManager", "OnSolBalanceUpdateFailed", { error: error.message });
        return 0;
      }
    }
    return 0;
  }, [sendToUnityGame, toast, connection]); 

  const resetLocalAssets = useCallback(() => {
    setNfts([]);
    setCnfts([]);
    setTokens([]);
    _setSolBalance(0);
  }, []);

  const loadUserAssetsInternal = useCallback(async () => {
    const currentPk = walletHookRef.current.publicKey;
    const currentRpc = rpcUrlRef.current; 

    if (!currentPk || !currentRpc || !connection ) {
      if (isLoaded) {
        sendToUnityGame("GameBridgeManager", "OnAssetsLoaded", { nfts: [], cnfts: [], tokens: [], solBalance: 0 });
      }
      resetLocalAssets();
      return;
    }
    setIsLoadingAssets(true);
    if (isLoaded) sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
    try {
      const [fetchedSol, { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, heliusWarning }] = await Promise.all([
        fetchSolBalanceInternal(), 
        fetchAssetsForOwner(currentPk.toBase58(), currentRpc, connection, walletHookRef.current)
      ]);

      if (heliusWarning) {
        const isApiKeyError = heliusWarning.toLowerCase().includes("access forbidden") || heliusWarning.toLowerCase().includes("api key");
        toast({ title: "API Warning", description: heliusWarning, variant: isApiKeyError ? "destructive" : "default", duration: 7000 });
        if (isLoaded) sendToUnityGame("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: isApiKeyError });
      }

      setNfts(fetchedNfts); setCnfts(fetchedCnfts); setTokens(fetchedTokens);
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnAssetsLoaded", { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, solBalance: fetchedSol });

      if (!heliusWarning) {
         toast({ title: "Asset Scan Complete", description: `Found ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs, ${fetchedTokens.length} Tokens, and ${fetchedSol.toFixed(SOL_DECIMALS)} SOL on ${currentNetworkRef.current}.` });
      }
    } catch (error: any) {
      console.error("[Page RUW] Failed to load assets:", error);
      toast({ title: "Error Loading Assets", description: error.message, variant: "destructive" });
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnAssetsLoadFailed", { error: error.message });
      resetLocalAssets();
    } finally {
      setIsLoadingAssets(false);
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false });
    }
  }, [sendToUnityGame, toast, fetchSolBalanceInternal, connection, resetLocalAssets, isLoaded]); 

  const debouncedLoadUserAssets = useMemo(() => debounce(loadUserAssetsInternal, 500), [loadUserAssetsInternal]);

  // WalletEffect: Effect to send wallet connection status to Unity
  const prevConnectedForUnityRef = useRef<boolean | undefined>(undefined);
  const prevPublicKeyForUnityRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const { connected, publicKey } = walletHookRef.current;
    const currentPkString = publicKey?.toBase58();
  
    if (!isClientMounted) { 
      console.log("[Page RUW WalletEffect] Client not mounted. Skipping wallet status messages.");
      return;
    }
  
    if (connected && currentPkString) {
      console.log(`[Page RUW WalletEffect] Wallet IS connected (PK: ${currentPkString}). Sending OnWalletConnected.`);
      if (isLoaded) { 
        sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: currentPkString });
      }
      // Asset loading is now handled by a separate effect
    } else { 
      if (prevConnectedForUnityRef.current === true && !connected) {
        console.log(`[Page RUW WalletEffect] Wallet transitioned to disconnected. Sending OnWalletDisconnected. PrevConnected: ${prevConnectedForUnityRef.current}, NowConnected: ${connected}`);
        if (isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletDisconnected", {});
      } else if (prevConnectedForUnityRef.current === undefined && !connected && isLoaded && isClientMounted) {
         console.log("[Page RUW WalletEffect] Initial check: Wallet disconnected and Unity loaded. Sending OnWalletDisconnected.");
         sendToUnityGame("GameBridgeManager", "OnWalletDisconnected", {});
      }
    }
    prevConnectedForUnityRef.current = connected;
    prevPublicKeyForUnityRef.current = currentPkString;
  }, [walletHookRef.current.connected, walletHookRef.current.publicKey, isLoaded, sendToUnityGame, isClientMounted]);
  
  // Effect to load assets when wallet is connected
  useEffect(() => {
    if (walletHook.connected && walletHook.publicKey && !isLoadingAssets && !isSubmittingTransactionRef.current) {
      console.log("[Page RUW AssetEffect] Wallet connected, not loading/submitting. Triggering asset load.");
      debouncedLoadUserAssets();
    }
  }, [walletHook.connected, walletHook.publicKey, isLoadingAssets, isSubmittingTransaction, debouncedLoadUserAssets]);


  // Effect to reload page on wallet disconnect
  const prevConnectedStateForRefreshRef = useRef<boolean>(walletHook.connected);
  const disconnectReloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const { connected } = walletHookRef.current;

    if (disconnectReloadTimeoutRef.current) {
      clearTimeout(disconnectReloadTimeoutRef.current);
      disconnectReloadTimeoutRef.current = null;
    }

    if (prevConnectedStateForRefreshRef.current === true && !connected) {
      console.log("[Page RUW DisconnectRefreshEffect] Wallet has transitioned from connected to disconnected. Scheduling page reload.");
      disconnectReloadTimeoutRef.current = setTimeout(() => {
        console.log("[Page RUW DisconnectRefreshEffect] Executing scheduled reload due to persistent disconnection.");
        window.location.reload();
      }, 500); // Slightly increased timeout
    }
    
    prevConnectedStateForRefreshRef.current = connected;
  }, [walletHook.connected]); // Only depends on walletHook.connected


  // Effect to handle auto-connection after modal closes with a selection
  const previousModalVisibilityRef = useRef(walletModal.visible);
  const previousSelectedWalletNameRef = useRef<string | null>(null);

  useEffect(() => {
      const { wallet, connected, connecting, connect: walletConnectAdapterHook } = walletHookRef.current;
      const currentSelectedWalletName = wallet?.adapter.name || null;

      if (previousModalVisibilityRef.current && !walletModal.visible) { 
          console.log(`[Page RUW ModalCloseEffect] Modal closed. Previously selected: ${previousSelectedWalletNameRef.current}, Current selected in hook: ${currentSelectedWalletName}. Connected: ${connected}, Connecting: ${connecting}`);
          
          if (currentSelectedWalletName && !connected && !connecting) {
              console.log(`[Page RUW ModalCloseEffect] Modal closed, new wallet ${currentSelectedWalletName} appears selected. Attempting to connect.`);
              walletConnectAdapterHook?.().catch((error: any) => {
                  console.error(`[Page RUW ModalCloseEffect] Auto-connection failed for ${currentSelectedWalletName}:`, error);
                  toast({ title: `Failed to connect ${currentSelectedWalletName}`, description: error.message, variant: "destructive" });
                  if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "auto_connect_after_modal_select" });
              });
          } else if (!currentSelectedWalletName && !connected && !connecting) {
            console.log("[Page RUW ModalCloseEffect] Modal closed, but no wallet is currently selected in the hook. User might have closed modal without choosing.");
          }
      }
      previousModalVisibilityRef.current = walletModal.visible;
      if (currentSelectedWalletName) { 
          previousSelectedWalletNameRef.current = currentSelectedWalletName;
      } else if (!connected) { 
          previousSelectedWalletNameRef.current = null;
      }
  }, [walletModal.visible, walletHook.wallet, walletHook.connected, walletHook.connecting, walletConnect, toast, sendToUnityGame, isLoaded, select]);

  // --- Memoized Global Handler Definitions ---
  const memoizedHandleConnectWalletRequest = useCallback(async (walletNameFromUnity?: string) => {
    const { select: selectWalletFromHook, wallet, connect: walletConnectAdapter, connected, connecting } = walletHookRef.current;
    const currentAvailableWallets = walletHookRef.current.wallets; 

    if (connected) {
      console.log("[Page RUW GlobalCB] ConnectWalletRequest: Already connected. PK:", walletHookRef.current.publicKey?.toBase58());
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: walletHookRef.current.publicKey?.toBase58() });
      return;
    }
    if (connecting) {
      console.warn("[Page RUW GlobalCB] ConnectWalletRequest: Wallet connection already in progress.");
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: "Connection in progress.", action: "connect_wallet_in_progress" });
      return;
    }

    if (walletNameFromUnity) {
      const targetAdapter = currentAvailableWallets.find(w => w.adapter.name === walletNameFromUnity)?.adapter;
      if (targetAdapter) {
        if (targetAdapter.readyState === WalletReadyState.Installed || targetAdapter.readyState === WalletReadyState.Loadable) {
          console.log(`[Page RUW GlobalCB] ConnectWalletRequest: Wallet specified by Unity: ${walletNameFromUnity}. Selecting and attempting to connect.`);
          if (wallet?.adapter.name !== targetAdapter.name) {
            selectWalletFromHook(targetAdapter.name as WalletName);
            await new Promise(resolve => setTimeout(resolve, 150)); 
          }
          const newlySelectedWalletHook = walletHookRef.current;
          if (newlySelectedWalletHook.wallet?.adapter.name === targetAdapter.name && !newlySelectedWalletHook.connected && !newlySelectedWalletHook.connecting) {
            newlySelectedWalletHook.connect?.().catch(error => {
              console.error(`[Page RUW GlobalCB] ConnectWalletRequest: Connection failed for ${targetAdapter.name}:`, error);
              toast({ title: `Failed to connect ${targetAdapter.name}`, description: error.message, variant: "destructive" });
              if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, details: error.name, action: `connect_wallet_${targetAdapter.name}` });
            });
          } 
          return;
        } else {
          console.warn(`[Page RUW GlobalCB] ConnectWalletRequest: Wallet ${walletNameFromUnity} specified by Unity is not ready. State: ${targetAdapter.readyState}. Opening modal.`);
          if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: `${walletNameFromUnity} not ready. Opening modal.`, action: "connect_wallet_not_ready_modal_fallback" });
          selectWalletFromHook(null); 
          walletModal.setVisible(true); return;
        }
      } else {
        console.warn(`[Page RUW GlobalCB] ConnectWalletRequest: Wallet ${walletNameFromUnity} specified by Unity not found. Opening modal.`);
        if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: `Wallet ${walletNameFromUnity} not found. Opening modal.`, action: "connect_wallet_not_found_modal_fallback" });
        selectWalletFromHook(null); walletModal.setVisible(true); return;
      }
    } else {
        const currentSelectedWalletAdapter = walletHookRef.current.wallet?.adapter;
        if (currentSelectedWalletAdapter && (currentSelectedWalletAdapter.readyState === WalletReadyState.Installed || currentSelectedWalletAdapter.readyState === WalletReadyState.Loadable) && !connected && !connecting) {
          console.log(`[Page RUW GlobalCB] ConnectWalletRequest: No specific wallet from Unity, but ${currentSelectedWalletAdapter.name} is selected and ready. Attempting to connect.`);
          walletConnectAdapter?.().catch(error => {
              console.error(`[Page RUW GlobalCB] ConnectWalletRequest: Connection failed for ${currentSelectedWalletAdapter.name}:`, error);
              toast({ title: `Failed to connect ${currentSelectedWalletAdapter.name}`, description: error.message, variant: "destructive" });
              if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: `connect_wallet_${currentSelectedWalletAdapter.name}` });
          });
        } else { 
           console.log("[Page RUW GlobalCB] ConnectWalletRequest: No specific wallet from Unity, and no ready pre-selected wallet. Clearing selection and opening wallet modal.");
           selectWalletFromHook(null); 
           walletModal.setVisible(true);
           if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletSelectionNeeded", { message: `Please select a wallet.` });
        }
    }
  }, [isLoaded, sendToUnityGame, toast, walletModal, select, walletConnect]); 

  const memoizedHandleIsWalletConnectedRequest = useCallback(() => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleIsWalletConnectedRequest: Unity/Client not ready."); return false; }
    const currentlyConnected = walletHookRef.current.connected;
    const pk = walletHookRef.current.publicKey?.toBase58() || null;
    if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionStatus", { isConnected: currentlyConnected, publicKey: pk });
    return currentlyConnected;
  }, [isClientMounted, isLoaded, sendToUnityGame]);

  const memoizedHandleGetPublicKeyRequest = useCallback(() => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleGetPublicKeyRequest: Unity/Client not ready."); return null; }
    const pk = walletHookRef.current.publicKey?.toBase58() || null;
    if(isLoaded) sendToUnityGame("GameBridgeManager", "OnPublicKeyReceived", { publicKey: pk });
    return pk;
  }, [isClientMounted, isLoaded, sendToUnityGame]);

  const memoizedHandleDisconnectWalletRequest = useCallback(async () => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleDisconnectWalletRequest: Unity/Client not ready."); return; }
    try {
      await walletHookRef.current.disconnect();
    } catch (error: any) {
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "disconnect_wallet" });
      toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
    }
  }, [isClientMounted, isLoaded, sendToUnityGame, toast]);

  const memoizedHandleGetAvailableWalletsRequest = useCallback(() => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleGetAvailableWalletsRequest: Unity/Client not ready."); return []; }
    const currentAvailableWallets = walletHookRef.current.wallets;
    const available = currentAvailableWallets.map(w => ({ name: w.adapter.name, icon: w.adapter.icon, readyState: w.adapter.readyState }));
    if(isLoaded) sendToUnityGame("GameBridgeManager", "OnAvailableWalletsReceived", { wallets: available });
    return available;
  }, [isClientMounted, isLoaded, sendToUnityGame]);

  const memoizedHandleSelectWalletRequest = useCallback(async (walletName: string) => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleSelectWalletRequest: Unity/Client not ready."); return; }
    const { select: reactSelectWallet, wallets: currentWallets } = walletHookRef.current; 
    try {
      const targetWallet = currentWallets.find(w => w.adapter.name === walletName);
      if (!targetWallet) { throw new Error(`Wallet ${walletName} not available.`); }
      reactSelectWallet(walletName as WalletName); 
      console.log(`[Page RUW GlobalCB] Wallet selected via handleSelectWalletRequest: ${walletName}. Connect if needed.`);
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletSelectAttempted", { walletName });
    } catch (error: any) {
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "select_wallet_exception" });
      toast({ title: "Wallet Selection Error", description: error.message, variant: "destructive" });
    }
  }, [isClientMounted, isLoaded, sendToUnityGame, toast, select]);

  const memoizedHandleGetUserNFTsRequest = useCallback(async () => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleGetUserNFTsRequest: Unity/Client not ready."); if(isLoaded) sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { error: "Unity/Client not ready", nfts: [], cnfts: [] }); return; }
    if (!walletHookRef.current.publicKey || !connection) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { error: "Wallet not connected", nfts: [], cnfts: [] }); return; }
    setIsLoadingAssets(true); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
    try {
      const { nfts: fetchedNfts, cnfts: fetchedCnfts, heliusWarning } = await fetchAssetsForOwner(walletHookRef.current.publicKey.toBase58(), rpcUrlRef.current, connection, walletHookRef.current);
      if (heliusWarning && isLoaded) sendToUnityGame("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
      setNfts(fetchedNfts); setCnfts(fetchedCnfts);
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { nfts: nftsRef.current, cnfts: cnftsRef.current });
    } catch (e:any) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { error: e.message, nfts:[], cnfts:[]}); }
    finally { setIsLoadingAssets(false); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
  }, [isClientMounted, isLoaded, sendToUnityGame, connection]); // Removed fetchAssetsForOwner

  const memoizedHandleGetUserTokensRequest = useCallback(async () => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleGetUserTokensRequest: Unity/Client not ready."); if(isLoaded) sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { error: "Unity/Client not ready", tokens: [], solBalance: 0 }); return; }
    if (!walletHookRef.current.publicKey || !connection) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { error: "Wallet not connected", tokens: [], solBalance: 0 }); return; }
    setIsLoadingAssets(true); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
    try {
      const [fetchedSol, { tokens: fetchedTokensFromHelius, heliusWarning }] = await Promise.all([
          fetchSolBalanceInternal(), 
          fetchAssetsForOwner(walletHookRef.current.publicKey.toBase58(), rpcUrlRef.current, connection, walletHookRef.current)
      ]);
      if (heliusWarning && isLoaded) sendToUnityGame("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
      setTokens(fetchedTokensFromHelius.filter(a => a.type === 'token') as SplToken[]);
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { tokens: tokensRef.current, solBalance: solBalanceRef.current });
    } catch (e:any) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { error: e.message, tokens:[], solBalance: 0}); }
    finally { setIsLoadingAssets(false); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
  }, [isClientMounted, isLoaded, sendToUnityGame, connection, fetchSolBalanceInternal]); // Removed fetchAssetsForOwner
  
  const memoizedHandleGetSolBalanceRequest = useCallback(async () => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleGetSolBalanceRequest: Unity/Client not ready."); return 0; }
    return fetchSolBalanceInternal(); 
  }, [isClientMounted, isLoaded, fetchSolBalanceInternal]);

  const performTransaction = useCallback(async (actionName: string, mint: string | null, transactionFn: () => Promise<string>, reloadAssets: boolean = true) => {
    if (!isLoaded && !isClientMounted) { console.warn(`[Page RUW GlobalCB] performTransaction (${actionName}): Unity/Client not ready.`); if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: "Unity/Client not ready", mint }); return; }
    if (isSubmittingTransactionRef.current) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: "Transaction in progress", mint }); return; }
    if (!walletHookRef.current.publicKey || !walletHookRef.current.sendTransaction || !connection) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: "Wallet not connected", mint }); return; }
    setIsSubmittingTransaction(true); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: actionName, submitting: true, mint });
    try {
      const signature = await transactionFn();
      toast({ title: `${actionName.replace(/_/g, ' ')} Initiated`, description: `Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionSubmitted", { action: actionName, signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
      if (reloadAssets ) { 
          debouncedLoadUserAssets(); 
      } else if (actionName === 'transfer_sol' || actionName === 'burn_sol' || actionName === 'deposit_sol') {
          fetchSolBalanceInternal(); 
      }
    } catch (error: any) { toast({ title: `${actionName.replace(/_/g, ' ')} Failed`, description: error.message, variant: "destructive" }); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: error.message, mint });
    } finally { setIsSubmittingTransaction(false); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: actionName, submitting: false, mint }); }
  }, [isClientMounted, isLoaded, sendToUnityGame, connection, toast, debouncedLoadUserAssets, fetchSolBalanceInternal]);

  const memoizedHandleTransferSOLRequest = useCallback((amountSol: number, toAddress: string) => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleTransferSOLRequest: Unity/Client not ready."); return; }
      if (amountSol <= 0) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Amount must be positive" }); return; }
      const recipientPublicKey = new PublicKey(toAddress);
      performTransaction("transfer_sol", null, () => transferSol(connection, walletHookRef.current, recipientPublicKey, amountSol), false);
  }, [isClientMounted, isLoaded, sendToUnityGame, connection, performTransaction]);

  const memoizedHandleTransferTokenRequest = useCallback((mint: string, amount: number, toAddress: string) => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleTransferTokenRequest: Unity/Client not ready."); return; }
      const token = tokensRef.current.find(t => t.id === mint);
      if (!token) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Token not found", mint }); return; }
      if (amount <= 0) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Amount must be positive", mint }); return; }
      const recipientPublicKey = new PublicKey(toAddress);
      performTransaction("transfer_token", mint, () => transferSplToken(connection, walletHookRef.current, token, recipientPublicKey, amount));
  }, [isClientMounted, isLoaded, sendToUnityGame, connection, performTransaction]);

  const memoizedHandleTransferNFTRequest = useCallback((mint: string, toAddress: string) => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleTransferNFTRequest: Unity/Client not ready."); return; }
      const asset = allFetchedAssetsRef.current.find(a => a.id === mint && (a.type === 'nft' || a.type === 'cnft'));
      if (!asset) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "Asset not found", mint }); return; }
      const recipientPublicKey = new PublicKey(toAddress);
      if (asset.type === 'nft') performTransaction("transfer_nft", mint, () => transferNft(connection, walletHookRef.current, asset as Nft, recipientPublicKey));
      else if (asset.type === 'cnft') performTransaction("transfer_nft", mint, () => transferCNft(connection, walletHookRef.current, asset as CNft, recipientPublicKey, rpcUrlRef.current));
  }, [isClientMounted, isLoaded, sendToUnityGame, connection, performTransaction]);

   const memoizedHandleBurnSOLRequest = useCallback((amountSol: number) => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleBurnSOLRequest: Unity/Client not ready."); return; }
      if (amountSol <= 0) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Amount must be positive" }); return; }
      performTransaction("burn_sol", null, () => burnSol(connection, walletHookRef.current, amountSol), false);
  }, [isClientMounted, isLoaded, sendToUnityGame, connection, performTransaction]);

  const memoizedHandleBurnAssetRequest = useCallback((mint: string, amount?: number) => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleBurnAssetRequest: Unity/Client not ready."); return; }
      const asset = allFetchedAssetsRef.current.find(a => a.id === mint);
      if (!asset) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Asset not found", mint }); return; }
      if (asset.type === 'nft') performTransaction("burn_asset", mint, () => burnNft(connection, walletHookRef.current, asset as Nft));
      else if (asset.type === 'cnft') performTransaction("burn_asset", mint, () => burnCNft(connection, walletHookRef.current, asset as CNft, rpcUrlRef.current));
      else if (asset.type === 'token') {
          if (typeof amount !== 'number' || amount <= 0) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Invalid amount for token burn", mint }); return; }
          performTransaction("burn_asset", mint, () => burnSplToken(connection, walletHookRef.current, asset as SplToken, amount));
      }
  }, [isClientMounted, isLoaded, sendToUnityGame, connection, performTransaction]);

  const memoizedHandleMintNFTRequest = useCallback((name: string, symbol: string, metadataUri: string) => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleMintNFTRequest: Unity/Client not ready."); return; }
    if (currentNetworkRef.current === 'mainnet-beta') {
      toast({ title: "Minting Disabled", description: "NFT minting disabled on Mainnet.", variant: "destructive" });
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Minting disabled on Mainnet" }); return;
    }
    performTransaction("mint_nft", name, () => mintStandardNft(connection, walletHookRef.current, metadataUri, name, symbol));
  }, [isClientMounted, isLoaded, sendToUnityGame, toast, connection, performTransaction]);

  const memoizedHandleSwapTokensRequest = useCallback(() => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleSwapTokensRequest: Unity/Client not ready."); return; }
    const msg = "Token swapping is not yet implemented.";
    toast({ title: "Feature Unavailable", description: msg }); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "swap_tokens", error: msg });
  }, [isClientMounted, isLoaded, sendToUnityGame, toast]);

  const memoizedHandleDepositFundsRequest = useCallback((tokenMintOrSol: string, amount: number) => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleDepositFundsRequest: Unity/Client not ready."); return; }
      if (!CUSTODIAL_WALLET_ADDRESS) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Custodial address not set", tokenMint: tokenMintOrSol }); return; }
      if (amount <= 0) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Amount must be positive", tokenMint: tokenMintOrSol }); return; }
      if (tokenMintOrSol.toUpperCase() === "SOL") {
          performTransaction("deposit_funds", "SOL", () => depositSol(connection, walletHookRef.current, amount, CUSTODIAL_WALLET_ADDRESS), false);
      } else {
          const token = tokensRef.current.find(t => t.id === tokenMintOrSol);
          if (!token) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Token not found for deposit", tokenMint: tokenMintOrSol }); return; }
          performTransaction("deposit_funds", tokenMintOrSol, () => depositSplToken(connection, walletHookRef.current, token, amount, CUSTODIAL_WALLET_ADDRESS));
      }
  }, [isClientMounted, isLoaded, sendToUnityGame, connection, performTransaction]);

  const memoizedHandleWithdrawFundsRequest = useCallback(async (tokenMintOrSol: string, grossAmount: number) => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleWithdrawFundsRequest: Unity/Client not ready."); if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Unity/Client not ready", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
    if (isSubmittingTransactionRef.current) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Transaction in progress", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
    if (!walletHookRef.current.publicKey) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Wallet not connected", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
    if (grossAmount <= 0) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Amount must be positive", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
    setIsSubmittingTransaction(true); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: true, tokenMint: tokenMintOrSol });
    try {
      let result: WithdrawalResponse;
      if (tokenMintOrSol.toUpperCase() === "SOL") result = await initiateWithdrawalRequest(walletHookRef.current.publicKey.toBase58(), grossAmount, currentNetworkRef.current);
      else {
        const token = allFetchedAssetsRef.current.find(a => a.id === tokenMintOrSol && a.type === 'token') as SplToken | undefined;
        if (!token) { throw new Error("Token details for withdrawal not found."); }
        result = await initiateWithdrawalRequest(walletHookRef.current.publicKey.toBase58(), grossAmount, currentNetworkRef.current, token);
      }
      if (result.success) {
        toast({ title: "Withdrawal Processed", description: result.signature ? `Sig: ${result.signature.substring(0,10)}...` : result.message, action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> : undefined });
        fetchSolBalanceInternal(); 
      } else {
        toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
      }
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetworkRef.current) : undefined });
    } catch (error: any) { toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" }); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint: tokenMintOrSol });
    } finally { setIsSubmittingTransaction(false); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); }
  }, [isClientMounted, isLoaded, sendToUnityGame, toast, fetchSolBalanceInternal]);
  
  const memoizedHandleSetNetworkRequest = useCallback((network: SupportedSolanaNetwork) => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleSetNetworkRequest: Unity/Client not ready."); return; }
      setCurrentNetwork(network); 
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnNetworkChanged", { network });
  }, [isClientMounted, isLoaded, sendToUnityGame, setCurrentNetwork]);
  
  const memoizedHandleGetCurrentNetworkRequest = useCallback(() => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW GlobalCB] handleGetCurrentNetworkRequest: Unity/Client not ready."); return currentNetworkRef.current; } 
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnCurrentNetworkReceived", { network: currentNetworkRef.current });
      return currentNetworkRef.current;
  }, [isClientMounted, isLoaded, sendToUnityGame]);

  // --- Memoized Unity Event Listeners ---
  const memoizedHandleGameBridgeManagerReady = useCallback(() => {
    if (!isLoaded && !isClientMounted) { console.warn("[Page RUW ListenerCB] Received 'OnGameBridgeManagerReady' from Unity, but RUW isLoaded/ClientMounted is false."); return; }
    console.log("[Page RUW ListenerCB] Received 'OnGameBridgeManagerReady' from Unity.");
  }, [isClientMounted, isLoaded]);

  const memoizedHandleUnityError = useCallback((error: Error | string) => { 
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorName = typeof error === 'string' ? 'UnityError' : error.name;
    const errorStack = typeof error === 'string' ? undefined : error.stack;

    console.error("[Page RUW UnityErrorListenerCB] Unity Engine Error:", errorMessage, errorName, errorStack);
    toast({
      title: "Unity Engine Error",
      description: `Name: ${errorName}. Message: ${errorMessage}. Check console for stack trace.`,
      variant: "destructive",
      duration: 10000,
    });
    if(isLoaded) sendToUnityGame("GameBridgeManager", "OnUnityLoadError", { error: errorMessage, name: errorName });
  }, [isLoaded, sendToUnityGame, toast]);

  const memoizedHandleUnityLoaded = useCallback(() => {
      console.log("[Page RUW ListenerCB] ReactUnityWebGL 'loaded' event received. Signaling 'OnUnityReady' to GameBridgeManager.");
      if(isClientMounted) sendToUnityGame("GameBridgeManager", "OnUnityReady", {});
      const { connected: currentlyConnected, publicKey: currentPublicKey } = walletHookRef.current;
      if (isClientMounted && currentlyConnected && currentPublicKey) {
          console.log("[Page RUW ListenerCB 'loaded' event] Unity is loaded, wallet connected. Re-sending OnWalletConnected.");
          sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: currentPublicKey.toBase58() });
      }
  }, [isClientMounted, sendToUnityGame]);


  // Effect to manage global JS functions for Unity bridge and react-unity-webgl listeners
  useEffect(() => {
    if (!isClientMounted) {
      console.log("[Page RUW BridgeEffect] Client not mounted. Skipping bridge setup.");
      return;
    }

    if (isLoaded) {
      console.log("[Page RUW BridgeEffect] Unity is loaded. Setting up global handlers and listeners.");
      window.handleConnectWalletRequest = memoizedHandleConnectWalletRequest;
      window.handleIsWalletConnectedRequest = memoizedHandleIsWalletConnectedRequest;
      window.handleGetPublicKeyRequest = memoizedHandleGetPublicKeyRequest;
      window.handleDisconnectWalletRequest = memoizedHandleDisconnectWalletRequest;
      window.handleGetAvailableWalletsRequest = memoizedHandleGetAvailableWalletsRequest;
      window.handleSelectWalletRequest = memoizedHandleSelectWalletRequest;
      window.handleGetUserNFTsRequest = memoizedHandleGetUserNFTsRequest;
      window.handleGetUserTokensRequest = memoizedHandleGetUserTokensRequest;
      window.handleGetSolBalanceRequest = memoizedHandleGetSolBalanceRequest;
      window.handleTransferSOLRequest = memoizedHandleTransferSOLRequest;
      window.handleTransferTokenRequest = memoizedHandleTransferTokenRequest;
      window.handleTransferNFTRequest = memoizedHandleTransferNFTRequest;
      window.handleBurnSOLRequest = memoizedHandleBurnSOLRequest;
      window.handleBurnAssetRequest = memoizedHandleBurnAssetRequest;
      window.handleMintNFTRequest = memoizedHandleMintNFTRequest;
      window.handleSwapTokensRequest = memoizedHandleSwapTokensRequest;
      window.handleDepositFundsRequest = memoizedHandleDepositFundsRequest;
      window.handleWithdrawFundsRequest = memoizedHandleWithdrawFundsRequest;
      window.handleSetNetworkRequest = memoizedHandleSetNetworkRequest;
      window.handleGetCurrentNetworkRequest = memoizedHandleGetCurrentNetworkRequest;

      console.log("[Page RUW BridgeEffect] Global Request Handlers DEFINED.");
      
      addEventListener("OnGameBridgeManagerReady", memoizedHandleGameBridgeManagerReady);
      addEventListener("error", memoizedHandleUnityError); // Changed from "unityerror"
      addEventListener("loaded", memoizedHandleUnityLoaded); 
      
    } else {
      console.log("[Page RUW BridgeEffect] Unity not loaded yet. Global handlers and listeners will be set up once it is.");
    }
    
    return () => {
      console.log("[Page RUW BridgeEffect Cleanup] Cleaning up global request handlers and react-unity-webgl event listeners (if they were set).");
      const handlersToClean: (keyof Window)[] = [
        "handleConnectWalletRequest", "handleIsWalletConnectedRequest", "handleGetPublicKeyRequest",
        "handleDisconnectWalletRequest", "handleGetAvailableWalletsRequest", "handleSelectWalletRequest",
        "handleGetUserNFTsRequest", "handleGetUserTokensRequest", "handleGetSolBalanceRequest",
        "handleTransferSOLRequest", "handleTransferTokenRequest", "handleTransferNFTRequest",
        "handleBurnSOLRequest", "handleBurnAssetRequest", "handleMintNFTRequest", "handleSwapTokensRequest",
        "handleDepositFundsRequest", "handleWithdrawFundsRequest", "handleSetNetworkRequest", "handleGetCurrentNetworkRequest"
      ];
      handlersToClean.forEach(key => {
        if (window[key]) {
          delete window[key];
        }
      });
      removeEventListener("OnGameBridgeManagerReady", memoizedHandleGameBridgeManagerReady);
      removeEventListener("error", memoizedHandleUnityError);
      removeEventListener("loaded", memoizedHandleUnityLoaded);
    };
  }, [
      isClientMounted, isLoaded, addEventListener, removeEventListener,
      memoizedHandleConnectWalletRequest, memoizedHandleIsWalletConnectedRequest, memoizedHandleGetPublicKeyRequest,
      memoizedHandleDisconnectWalletRequest, memoizedHandleGetAvailableWalletsRequest, memoizedHandleSelectWalletRequest,
      memoizedHandleGetUserNFTsRequest, memoizedHandleGetUserTokensRequest, memoizedHandleGetSolBalanceRequest,
      memoizedHandleTransferSOLRequest, memoizedHandleTransferTokenRequest, memoizedHandleTransferNFTRequest,
      memoizedHandleBurnSOLRequest, memoizedHandleBurnAssetRequest, memoizedHandleMintNFTRequest,
      memoizedHandleSwapTokensRequest, memoizedHandleDepositFundsRequest, memoizedHandleWithdrawFundsRequest,
      memoizedHandleSetNetworkRequest, memoizedHandleGetCurrentNetworkRequest,
      memoizedHandleGameBridgeManagerReady, memoizedHandleUnityError, memoizedHandleUnityLoaded
  ]);


  useEffect(() => {
    return () => {
      if (isLoaded && detachAndUnload) { 
        console.log("[Page RUW UnmountEffect] Detaching and unloading Unity instance.");
        detachAndUnload().catch(error => {
          console.error("[Page RUW UnmountEffect] Error detaching and unloading Unity instance:", error);
        });
      }
    };
  }, [isLoaded, detachAndUnload]); 


  const loadingPercentage = Math.round(loadingProgression * 100);

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-[100] w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-16 shrink-0">
        <div className="container flex h-full items-center justify-between px-4 md:px-6 mx-auto">
          <div className="flex-1 flex justify-start">
            <NetworkSwitcher />
          </div>
          <div className="flex-1 flex justify-center">
            {isClientMounted && (
              <Image
                src="/Logo.png"
                alt={`${gameProductNameOrDefault} Logo`}
                width={40} 
                height={40} 
                className="object-contain"
                data-ai-hint="game logo"
                priority
                onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/40x40.png'; (e.target as HTMLImageElement).alt = 'Game Logo Placeholder'; }}
              />
            )}
          </div>
          <div className="flex-1 flex justify-end">
            <ConnectWalletButton />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full relative overflow-hidden p-0 m-0">
        {!isClientMounted || !unityProvider ? ( 
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-50">
                 <svg className="animate-spin h-12 w-12 text-primary mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-lg text-foreground">Initializing Game Engine...</p>
            </div>
        ) : !isLoaded ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-50">
             <div className="w-60 h-60 mb-4">
                <Image
                     src="/Logo.png"
                     alt="Game Logo"
                     width={240}
                     height={240}
                     className="object-contain"
                     data-ai-hint="phoenix fire"
                     priority
                     onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/240x240.png'; (e.target as HTMLImageElement).alt = 'Game Logo Placeholder'; }}
                />
             </div>
             <p className="text-lg text-foreground mt-4">
                Loading Game: {loadingPercentage}%
             </p>
             <div className="w-1/2 max-w-md mt-2 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-150" style={{ width: `${loadingPercentage}%`}}></div>
             </div>
          </div>
        ) : null}
        {isClientMounted && unityProvider && ( 
            <Unity
                id="react-unity-webgl-canvas" 
                unityProvider={unityProvider}
                className={`w-full h-full block ${!isLoaded ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}
                style={{ background: 'transparent' }}
                devicePixelRatio={currentDevicePixelRatio} 
                suppressHydrationWarning 
            />
        )}
      </main>
    </div>
  );
}
    

    