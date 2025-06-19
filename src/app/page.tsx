
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
  const { wallets: availableWallets, select, wallet: currentWalletAdapterDetails } = walletHook; 
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

  // WalletEffect: Effect to send wallet connection status to Unity and load assets
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
      console.log(`[Page RUW WalletEffect] Wallet IS connected (PK: ${currentPkString}).`);
      if (isLoaded) { 
        sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: currentPkString });
      }
      if (!isLoadingAssets && !isSubmittingTransactionRef.current) {
        console.log("[Page RUW WalletEffect] Wallet connected, triggering asset load directly from React.");
        debouncedLoadUserAssets();
      }
    } else { 
      if (prevConnectedForUnityRef.current === true && !connected) {
        console.log(`[Page RUW WalletEffect] Wallet transitioned to disconnected. Sending OnWalletDisconnected. PrevConnected: ${prevConnectedForUnityRef.current}, NowConnected: ${connected}`);
        if (isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletDisconnected", {});
      } else if (prevConnectedForUnityRef.current === undefined && !connected && isLoaded) {
        // console.log("[Page RUW WalletEffect] Initial check found wallet disconnected and Unity loaded. Sending OnWalletDisconnected.");
        // This case might be too aggressive if Unity is just loading up.
        // Better to rely on the transition from true to false for disconnect.
      }
    }
    prevConnectedForUnityRef.current = connected;
    prevPublicKeyForUnityRef.current = currentPkString;
  }, [walletHookRef.current.connected, walletHookRef.current.publicKey, isLoaded, sendToUnityGame, debouncedLoadUserAssets, isLoadingAssets, isClientMounted]);
  

  // Effect to reload page on wallet disconnect
  const prevConnectedStateForRefreshRef = useRef<boolean>(walletHook.connected); 
  useEffect(() => {
    const { connected } = walletHookRef.current;
    if (prevConnectedStateForRefreshRef.current === true && !connected) {
      console.log("[Page RUW DisconnectRefreshEffect] Wallet has transitioned from connected to disconnected. Reloading page.");
      window.location.reload();
    }
    prevConnectedStateForRefreshRef.current = connected;
  }, [walletHook.connected]);


  // Effect to handle auto-connection after modal closes with a selection
  const previousModalVisibilityRef = useRef(walletModal.visible);
  const previousSelectedWalletNameRef = useRef<string | null>(null);

  useEffect(() => {
      const { wallet, connected, connecting, connect: walletConnectAdapter, select: selectWallet } = walletHookRef.current;
      const currentSelectedWalletName = wallet?.adapter.name || null;

      if (previousModalVisibilityRef.current && !walletModal.visible) { 
          console.log(`[Page RUW ModalCloseEffect] Modal closed. Previously selected: ${previousSelectedWalletNameRef.current}, Current selected in hook: ${currentSelectedWalletName}. Connected: ${connected}, Connecting: ${connecting}`);
          // Check if a wallet was actually selected from the modal
          // The `wallet` in the hook updates slightly after the modal closes and a selection is made.
          // We need to ensure we try to connect to the *actually chosen* wallet.
          // The `select` function from useWallet updates the adapter, then we connect.
          // However, `useWalletModal` handles the selection part. The `wallet` in `useWallet` should reflect the choice.

          if (currentSelectedWalletName && !connected && !connecting) {
              console.log(`[Page RUW ModalCloseEffect] Modal closed, new wallet ${currentSelectedWalletName} appears selected. Attempting to connect.`);
              walletConnectAdapter?.().catch((error: any) => {
                  console.error(`[Page RUW ModalCloseEffect] Auto-connection failed for ${currentSelectedWalletName}:`, error);
                  toast({ title: `Failed to connect ${currentSelectedWalletName}`, description: error.message, variant: "destructive" });
                  if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "auto_connect_after_modal_select" });
              });
          } else if (!currentSelectedWalletName && !connected && !connecting) {
            console.log("[Page RUW ModalCloseEffect] Modal closed, but no wallet is currently selected in the hook. User might have closed modal without choosing.");
          }
      }
      previousModalVisibilityRef.current = walletModal.visible;
      if (currentSelectedWalletName) { // Update ref if a wallet is selected
          previousSelectedWalletNameRef.current = currentSelectedWalletName;
      } else if (!connected) { // Clear ref if disconnected and no wallet selected
          previousSelectedWalletNameRef.current = null;
      }
  }, [walletModal.visible, walletHook.wallet, walletHook.connected, walletHook.connecting, walletHook.connect, toast, sendToUnityGame, isLoaded, walletHook.select]);


  // Effect to manage global JS functions for Unity bridge and react-unity-webgl listeners
  useEffect(() => {
    console.log("[Page RUW BridgeEffect] Setting up global handlers and react-unity-webgl event listeners. RUW isLoaded:", isLoaded);
    
    window.handleConnectWalletRequest = async (walletNameFromUnity?: string) => {
      const { select: selectWalletFn, wallet, connect: walletConnectAdapter, connected, connecting } = walletHookRef.current;

      if (connected) {
        console.log("[Page RUW Global] ConnectWalletRequest: Already connected. PK:", walletHookRef.current.publicKey?.toBase58());
        if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: walletHookRef.current.publicKey?.toBase58() });
        return;
      }

      if (connecting) {
        console.warn("[Page RUW Global] ConnectWalletRequest: Wallet connection already in progress.");
        if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: "Connection in progress.", action: "connect_wallet_in_progress" });
        return;
      }

      if (walletNameFromUnity) {
        const targetAdapter = availableWallets.find(w => w.adapter.name === walletNameFromUnity)?.adapter;
        if (targetAdapter) {
          if (targetAdapter.readyState === WalletReadyState.Installed || targetAdapter.readyState === WalletReadyState.Loadable) {
            console.log(`[Page RUW Global] ConnectWalletRequest: Wallet specified by Unity: ${walletNameFromUnity}. Selecting and attempting to connect.`);
            if (wallet?.adapter.name !== targetAdapter.name) {
              selectWalletFn(targetAdapter.name as WalletName);
              // Give a brief moment for the selection to propagate in the hook
              await new Promise(resolve => setTimeout(resolve, 150)); 
            }
            
            // Re-check the hook's state after selection attempt
            const newlySelectedWalletHook = walletHookRef.current; 
            if (newlySelectedWalletHook.wallet?.adapter.name === targetAdapter.name && !newlySelectedWalletHook.connected && !newlySelectedWalletHook.connecting) {
              newlySelectedWalletHook.connect?.().catch(error => {
                console.error(`[Page RUW Global] ConnectWalletRequest: Connection failed for ${targetAdapter.name}:`, error);
                toast({ title: `Failed to connect ${targetAdapter.name}`, description: error.message, variant: "destructive" });
                if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, details: error.name, action: `connect_wallet_${targetAdapter.name}` });
              });
            } else if (newlySelectedWalletHook.connected) { 
               if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: newlySelectedWalletHook.publicKey?.toBase58() });
            } else {
               console.warn(`[Page RUW Global] ConnectWalletRequest: Selected ${targetAdapter.name} but state not ready for connect. Current selected: ${newlySelectedWalletHook.wallet?.adapter.name}, Connected: ${newlySelectedWalletHook.connected}, Connecting: ${newlySelectedWalletHook.connecting}`);
            }
            return;
          } else {
            console.warn(`[Page RUW Global] ConnectWalletRequest: Wallet ${walletNameFromUnity} specified by Unity is not ready. State: ${targetAdapter.readyState}. Opening modal.`);
            if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: `${walletNameFromUnity} not ready. Opening modal.`, action: "connect_wallet_not_ready_modal_fallback" });
            selectWalletFn(null); 
            walletModal.setVisible(true);
            return;
          }
        } else {
          console.warn(`[Page RUW Global] ConnectWalletRequest: Wallet ${walletNameFromUnity} specified by Unity not found. Opening modal.`);
          if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: `Wallet ${walletNameFromUnity} not found. Opening modal.`, action: "connect_wallet_not_found_modal_fallback" });
          selectWalletFn(null);
          walletModal.setVisible(true);
          return;
        }
      } else { // No specific wallet from Unity - user initiated a generic connect from Unity
          const currentSelectedWalletAdapter = walletHookRef.current.wallet?.adapter;
          if (currentSelectedWalletAdapter && (currentSelectedWalletAdapter.readyState === WalletReadyState.Installed || currentSelectedWalletAdapter.readyState === WalletReadyState.Loadable) && !connected && !connecting) {
            console.log(`[Page RUW Global] ConnectWalletRequest: No specific wallet from Unity, but ${currentSelectedWalletAdapter.name} is selected and ready. Attempting to connect.`);
            walletConnectAdapter?.().catch(error => {
                console.error(`[Page RUW Global] ConnectWalletRequest: Connection failed for ${currentSelectedWalletAdapter.name}:`, error);
                toast({ title: `Failed to connect ${currentSelectedWalletAdapter.name}`, description: error.message, variant: "destructive" });
                if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: `connect_wallet_${currentSelectedWalletAdapter.name}` });
            });
          } else { // No ready pre-selected wallet or already connected/connecting. Open modal.
             console.log("[Page RUW Global] ConnectWalletRequest: No specific wallet from Unity, and no ready pre-selected wallet (or already handled). Clearing selection and opening wallet modal.");
             selectWalletFn(null); 
             walletModal.setVisible(true);
             if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletSelectionNeeded", { message: `Please select a wallet.` });
          }
      }
    };
        
    window.handleIsWalletConnectedRequest = () => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleIsWalletConnectedRequest: Unity/Client not ready."); return false; }
      const currentlyConnected = walletHookRef.current.connected;
      const pk = walletHookRef.current.publicKey?.toBase58() || null;
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionStatus", { isConnected: currentlyConnected, publicKey: pk });
      return currentlyConnected;
    };

    window.handleGetPublicKeyRequest = () => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleGetPublicKeyRequest: Unity/Client not ready."); return null; }
      const pk = walletHookRef.current.publicKey?.toBase58() || null;
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnPublicKeyReceived", { publicKey: pk });
      return pk;
    };

    window.handleDisconnectWalletRequest = async () => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleDisconnectWalletRequest: Unity/Client not ready."); return; }
      try {
        await walletHookRef.current.disconnect();
      } catch (error: any) {
        if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "disconnect_wallet" });
        toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
      }
    };

    window.handleGetAvailableWalletsRequest = () => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleGetAvailableWalletsRequest: Unity/Client not ready."); return []; }
      const available = availableWallets.map(w => ({ name: w.adapter.name, icon: w.adapter.icon, readyState: w.adapter.readyState }));
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnAvailableWalletsReceived", { wallets: available });
      return available;
    };

    window.handleSelectWalletRequest = async (walletName: string) => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleSelectWalletRequest: Unity/Client not ready."); return; }
      const { select: reactSelectWallet } = walletHookRef.current; 
      try {
        const targetWallet = availableWallets.find(w => w.adapter.name === walletName);
        if (!targetWallet) { throw new Error(`Wallet ${walletName} not available.`); }
        reactSelectWallet(walletName as WalletName); 
        console.log(`[Page RUW Global] Wallet selected via handleSelectWalletRequest: ${walletName}. Connect if needed.`);
        if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletSelectAttempted", { walletName });
      } catch (error: any) {
        if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "select_wallet_exception" });
        toast({ title: "Wallet Selection Error", description: error.message, variant: "destructive" });
      }
    };
    
    window.handleGetUserNFTsRequest = async () => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleGetUserNFTsRequest: Unity/Client not ready."); if(isLoaded) sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { error: "Unity/Client not ready", nfts: [], cnfts: [] }); return; }
      if (!walletHookRef.current.publicKey || !connection) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { error: "Wallet not connected", nfts: [], cnfts: [] }); return; }
      setIsLoadingAssets(true); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
      try {
        const { nfts: fetchedNfts, cnfts: fetchedCnfts, heliusWarning } = await fetchAssetsForOwner(walletHookRef.current.publicKey.toBase58(), rpcUrlRef.current, connection, walletHookRef.current);
        if (heliusWarning && isLoaded) sendToUnityGame("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
        setNfts(fetchedNfts); setCnfts(fetchedCnfts);
        if (isLoaded) sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { nfts: nftsRef.current, cnfts: cnftsRef.current });
      } catch (e:any) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { error: e.message, nfts:[], cnfts:[]}); }
      finally { setIsLoadingAssets(false); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
    };

    window.handleGetUserTokensRequest = async () => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleGetUserTokensRequest: Unity/Client not ready."); if(isLoaded) sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { error: "Unity/Client not ready", tokens: [], solBalance: 0 }); return; }
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
    };

    window.handleGetSolBalanceRequest = async () => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleGetSolBalanceRequest: Unity/Client not ready."); return 0; }
      return fetchSolBalanceInternal(); 
    };

    const performTransaction = async (actionName: string, mint: string | null, transactionFn: () => Promise<string>, reloadAssets: boolean = true) => {
      if (!isLoaded && !isClientMounted) { console.warn(`[Page RUW Global] performTransaction (${actionName}): Unity/Client not ready.`); if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: "Unity/Client not ready", mint }); return; }
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
    };
    
    window.handleTransferSOLRequest = (amountSol: number, toAddress: string) => {
        if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleTransferSOLRequest: Unity/Client not ready."); return; }
        if (amountSol <= 0) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Amount must be positive" }); return; }
        const recipientPublicKey = new PublicKey(toAddress);
        performTransaction("transfer_sol", null, () => transferSol(connection, walletHookRef.current, recipientPublicKey, amountSol), false);
    };

    window.handleTransferTokenRequest = (mint: string, amount: number, toAddress: string) => {
        if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleTransferTokenRequest: Unity/Client not ready."); return; }
        const token = tokensRef.current.find(t => t.id === mint);
        if (!token) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Token not found", mint }); return; }
        if (amount <= 0) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Amount must be positive", mint }); return; }
        const recipientPublicKey = new PublicKey(toAddress);
        performTransaction("transfer_token", mint, () => transferSplToken(connection, walletHookRef.current, token, recipientPublicKey, amount));
    };

    window.handleTransferNFTRequest = (mint: string, toAddress: string) => {
        if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleTransferNFTRequest: Unity/Client not ready."); return; }
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint && (a.type === 'nft' || a.type === 'cnft'));
        if (!asset) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "Asset not found", mint }); return; }
        const recipientPublicKey = new PublicKey(toAddress);
        if (asset.type === 'nft') performTransaction("transfer_nft", mint, () => transferNft(connection, walletHookRef.current, asset as Nft, recipientPublicKey));
        else if (asset.type === 'cnft') performTransaction("transfer_nft", mint, () => transferCNft(connection, walletHookRef.current, asset as CNft, recipientPublicKey, rpcUrlRef.current));
    };

     window.handleBurnSOLRequest = (amountSol: number) => {
        if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleBurnSOLRequest: Unity/Client not ready."); return; }
        if (amountSol <= 0) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Amount must be positive" }); return; }
        performTransaction("burn_sol", null, () => burnSol(connection, walletHookRef.current, amountSol), false);
    };

    window.handleBurnAssetRequest = (mint: string, amount?: number) => {
        if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleBurnAssetRequest: Unity/Client not ready."); return; }
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint);
        if (!asset) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Asset not found", mint }); return; }
        if (asset.type === 'nft') performTransaction("burn_asset", mint, () => burnNft(connection, walletHookRef.current, asset as Nft));
        else if (asset.type === 'cnft') performTransaction("burn_asset", mint, () => burnCNft(connection, walletHookRef.current, asset as CNft, rpcUrlRef.current));
        else if (asset.type === 'token') {
            if (typeof amount !== 'number' || amount <= 0) { if(isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Invalid amount for token burn", mint }); return; }
            performTransaction("burn_asset", mint, () => burnSplToken(connection, walletHookRef.current, asset as SplToken, amount));
        }
    };

    window.handleMintNFTRequest = (name: string, symbol: string, metadataUri: string) => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleMintNFTRequest: Unity/Client not ready."); return; }
      if (currentNetworkRef.current === 'mainnet-beta') {
        toast({ title: "Minting Disabled", description: "NFT minting disabled on Mainnet.", variant: "destructive" });
        if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Minting disabled on Mainnet" }); return;
      }
      performTransaction("mint_nft", name, () => mintStandardNft(connection, walletHookRef.current, metadataUri, name, symbol));
    };

    window.handleSwapTokensRequest = () => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleSwapTokensRequest: Unity/Client not ready."); return; }
      const msg = "Token swapping is not yet implemented.";
      toast({ title: "Feature Unavailable", description: msg }); if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "swap_tokens", error: msg });
    };

    window.handleDepositFundsRequest = (tokenMintOrSol: string, amount: number) => {
        if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleDepositFundsRequest: Unity/Client not ready."); return; }
        if (!CUSTODIAL_WALLET_ADDRESS) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Custodial address not set", tokenMint: tokenMintOrSol }); return; }
        if (amount <= 0) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Amount must be positive", tokenMint: tokenMintOrSol }); return; }
        if (tokenMintOrSol.toUpperCase() === "SOL") {
            performTransaction("deposit_funds", "SOL", () => depositSol(connection, walletHookRef.current, amount, CUSTODIAL_WALLET_ADDRESS), false);
        } else {
            const token = tokensRef.current.find(t => t.id === tokenMintOrSol);
            if (!token) { if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Token not found for deposit", tokenMint: tokenMintOrSol }); return; }
            performTransaction("deposit_funds", tokenMintOrSol, () => depositSplToken(connection, walletHookRef.current, token, amount, CUSTODIAL_WALLET_ADDRESS));
        }
    };

    window.handleWithdrawFundsRequest = async (tokenMintOrSol: string, grossAmount: number) => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleWithdrawFundsRequest: Unity/Client not ready."); if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Unity/Client not ready", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
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
    };

    window.handleSetNetworkRequest = (network: SupportedSolanaNetwork) => {
        if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleSetNetworkRequest: Unity/Client not ready."); return; }
        setCurrentNetwork(network); 
        if (isLoaded) sendToUnityGame("GameBridgeManager", "OnNetworkChanged", { network });
    };
    
    window.handleGetCurrentNetworkRequest = () => {
        if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Global] handleGetCurrentNetworkRequest: Unity/Client not ready."); return currentNetworkRef.current; } 
        if (isLoaded) sendToUnityGame("GameBridgeManager", "OnCurrentNetworkReceived", { network: currentNetworkRef.current });
        return currentNetworkRef.current;
    };
    
    if (isClientMounted && isLoaded) {
        console.log("[Page RUW BridgeEffect] RUW isLoaded is true & client mounted. Signaling 'OnUnityReady' to GameBridgeManager C# (which means JS bridge is up).");
        sendToUnityGame("GameBridgeManager", "OnUnityReady", {});
    } else {
        console.log(`[Page RUW BridgeEffect] RUW isLoaded: ${isLoaded}, ClientMounted: ${isClientMounted}. Global handlers will be defined, but bridge calls might be skipped until Unity is ready and client is mounted.`);
    }
    
    console.log("[Page RUW BridgeEffect] Global Request Handlers DEFINED.");
    const activeHandlers = Object.keys(window).filter(key => key.startsWith("handle") && key.endsWith("Request"));
    activeHandlers.forEach(handlerKey => console.log(`[Page RUW BridgeEffect]   - ${handlerKey} is active.`));

    const handleGameBridgeManagerReady = () => {
      if (!isLoaded && !isClientMounted) { console.warn("[Page RUW Listener] Received 'OnGameBridgeManagerReady' from Unity, but RUW isLoaded/ClientMounted is false. This is unusual."); return; }
      console.log("[Page RUW Listener] Received 'OnGameBridgeManagerReady' from Unity. Wallet status check will follow if already connected.");
    };
    addEventListener("OnGameBridgeManagerReady", handleGameBridgeManagerReady);


    const handleUnityError = (error: Error) => { // Use correct Error type
      console.error("[Page RUW UnityErrorListener] Unity Engine Error:", error.message, error.name, error.stack);
      toast({
        title: "Unity Engine Error",
        description: `Name: ${error.name}. Message: ${error.message}. Check console for stack trace.`,
        variant: "destructive",
        duration: 10000,
      });
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnUnityLoadError", { error: error.message, name: error.name });
    };
    addEventListener("error", handleUnityError);

    const handleUnityLoaded = () => {
        console.log("[Page RUW Listener] ReactUnityWebGL 'loaded' event received. Signaling 'OnUnityReady' to GameBridgeManager.");
        if(isClientMounted) sendToUnityGame("GameBridgeManager", "OnUnityReady", {});
        const { connected: currentlyConnected, publicKey: currentPublicKey } = walletHookRef.current;
        if (isClientMounted && currentlyConnected && currentPublicKey) {
            console.log("[Page RUW Listener 'loaded' event] Unity is loaded, wallet connected. Re-sending OnWalletConnected.");
            sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: currentPublicKey.toBase58() });
        }
    };
    addEventListener("loaded", handleUnityLoaded);


    return () => {
      console.log("[Page RUW BridgeEffect Cleanup] Cleaning up global request handlers and react-unity-webgl event listeners.");
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
          console.log(`[Page RUW BridgeEffect Cleanup]   - ${String(key)} REMOVED.`);
        }
      });
      removeEventListener("OnGameBridgeManagerReady", handleGameBridgeManagerReady);
      removeEventListener("error", handleUnityError);
      removeEventListener("loaded", handleUnityLoaded);
    };
  }, [
      isLoaded, connection, walletModal, availableWallets, select, setCurrentNetwork, 
      sendToUnityGame, toast, fetchSolBalanceInternal, debouncedLoadUserAssets, 
      addEventListener, removeEventListener, sendMessage, walletHook.connect, isClientMounted 
  ]);

  // Effect to handle page reload when switching between connected wallets
  // This logic has been intentionally removed as per user request in a previous step.
  // If re-keying/restarting Unity without full page reload is desired for wallet switch,
  // a different effect managing `unityInstanceKey` would be here.

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

    