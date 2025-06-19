
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
  UNITY_GAME_BUILD_BASE_NAME,
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
  const { wallets: availableWallets, select: selectWallet } = walletHook;
  const { toast } = useToast();
  const { currentNetwork, setCurrentNetwork, rpcUrl } = useNetwork();
  const walletModal = useWalletModal();
  
  const walletHookRef = useRef(walletHook); 
  useEffect(() => { walletHookRef.current = walletHook; }, [walletHook]);

  const gameBaseNameOrDefault = UNITY_GAME_BUILD_BASE_NAME || "MyGame";
  const gameCompanyNameOrDefault = UNITY_COMPANY_NAME || "DefaultCompany";
  const gameProductNameOrDefault = UNITY_PRODUCT_NAME || gameBaseNameOrDefault;
  const gameProductVersionOrDefault = UNITY_PRODUCT_VERSION || "1.0";

  const { unityProvider, isLoaded, loadingProgression, sendMessage, addEventListener, removeEventListener, UNSAFE__detachAndUnloadImmediate: detachAndUnload } = useUnityContext({
    loaderUrl: `/Build/${gameBaseNameOrDefault}.loader.js`,
    dataUrl: `/Build/${gameBaseNameOrDefault}.data`,
    frameworkUrl: `/Build/${gameBaseNameOrDefault}.framework.js`,
    codeUrl: `/Build/${gameBaseNameOrDefault}.wasm`,
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
    if (isLoaded) { 
      const replacer = (key: string, value: any) => (typeof value === 'bigint' ? value.toString() : value);
      const msgStr = typeof message === 'object' ? JSON.stringify(message, replacer) : String(message);
      try {
        sendMessage(gameObjectName, methodName, msgStr);
        console.log(`[Page RUW] Sent to Unity: ${gameObjectName}.${methodName}`, typeof message === 'string' ? message : JSON.stringify(message, null, 2).substring(0,200) + "...");
      } catch (e) {
        console.error(`[Page RUW] Error sending message to Unity: ${gameObjectName}.${methodName}`, e, "Message was:", message);
      }
    } else {
      console.warn(`[Page RUW] sendToUnityGame: Unity not loaded or ready. Cannot send. isLoaded: ${isLoaded}.`);
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
      resetLocalAssets();
      sendToUnityGame("GameBridgeManager", "OnAssetsLoaded", { nfts: [], cnfts: [], tokens: [], solBalance: 0 });
      return;
    }
    setIsLoadingAssets(true);
    sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
    try {
      const [fetchedSol, { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, heliusWarning }] = await Promise.all([
        fetchSolBalanceInternal(), 
        fetchAssetsForOwner(currentPk.toBase58(), currentRpc, connection, walletHookRef.current)
      ]);

      if (heliusWarning) {
        const isApiKeyError = heliusWarning.toLowerCase().includes("access forbidden") || heliusWarning.toLowerCase().includes("api key");
        toast({ title: "API Warning", description: heliusWarning, variant: isApiKeyError ? "destructive" : "default", duration: 7000 });
        sendToUnityGame("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: isApiKeyError });
      }

      setNfts(fetchedNfts); setCnfts(fetchedCnfts); setTokens(fetchedTokens);
      sendToUnityGame("GameBridgeManager", "OnAssetsLoaded", { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, solBalance: fetchedSol });

      if (!heliusWarning) {
         toast({ title: "Asset Scan Complete", description: `Found ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs, ${fetchedTokens.length} Tokens, and ${fetchedSol.toFixed(SOL_DECIMALS)} SOL on ${currentNetworkRef.current}.` });
      }
    } catch (error: any) {
      console.error("[Page RUW] Failed to load assets:", error);
      toast({ title: "Error Loading Assets", description: error.message, variant: "destructive" });
      sendToUnityGame("GameBridgeManager", "OnAssetsLoadFailed", { error: error.message });
      resetLocalAssets();
    } finally {
      setIsLoadingAssets(false);
      sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false });
    }
  }, [sendToUnityGame, toast, fetchSolBalanceInternal, connection, resetLocalAssets]); 

  const debouncedLoadUserAssets = useMemo(() => debounce(loadUserAssetsInternal, 500), [loadUserAssetsInternal]);

  // Dedicated useEffect for wallet connection/disconnection events and asset loading
  useEffect(() => {
    const { connected, publicKey } = walletHookRef.current;
    if (isLoaded) { // Only proceed if Unity is also loaded
      if (connected && publicKey) {
        console.log("[Page RUW WalletEventEffect] Wallet connected AND Unity ready. Sending OnWalletConnected to Unity and loading assets.");
        sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: publicKey.toBase58() });
        debouncedLoadUserAssets();
      } else { // Not connected or no public key
        console.log("[Page RUW WalletEventEffect] Wallet disconnected (or no PK) AND Unity ready. Sending OnWalletDisconnected to Unity and resetting assets.");
        sendToUnityGame("GameBridgeManager", "OnWalletDisconnected", {});
        resetLocalAssets();
      }
    } else {
      console.log("[Page RUW WalletEventEffect] Unity not ready (isLoaded is false), skipping asset load/wallet status update to Unity for this render.");
    }
  }, [walletHookRef.current.connected, walletHookRef.current.publicKey, isLoaded, sendToUnityGame, debouncedLoadUserAssets, resetLocalAssets]);


  // useEffect for setting up global handlers and react-unity-webgl event listeners
  useEffect(() => {
    console.log("[Page RUW BridgeEffect] Setting up global handlers and react-unity-webgl event listeners. RUW isLoaded:", isLoaded);

    if (!isLoaded) {
      console.log("[Page RUW BridgeEffect] RUW isLoaded is false. Global handlers will be defined once Unity is ready.");
      // Ensure any stale handlers are cleared if isLoaded becomes false after being true
      const handlersToClean: (keyof Window)[] = [
          "handleConnectWalletRequest", "handleIsWalletConnectedRequest", "handleGetPublicKeyRequest",
          "handleDisconnectWalletRequest", "handleGetAvailableWalletsRequest", "handleSelectWalletRequest",
          "handleGetUserNFTsRequest", "handleGetUserTokensRequest", "handleGetSolBalanceRequest",
          "handleTransferSOLRequest", "handleTransferTokenRequest", "handleTransferNFTRequest",
          "handleBurnSOLRequest", "handleBurnAssetRequest", "handleMintNFTRequest", "handleSwapTokensRequest",
          "handleDepositFundsRequest", "handleWithdrawFundsRequest", "handleSetNetworkRequest", "handleGetCurrentNetworkRequest"
      ];
      handlersToClean.forEach(key => { if (window[key]) { delete window[key]; } });
      return; // Don't set up if Unity isn't loaded
    }
    
    console.log("[Page RUW BridgeEffect] RUW isLoaded is true. Signaling 'OnUnityReady' to GameBridgeManager C# (which means JS bridge is up).");
    sendToUnityGame("GameBridgeManager", "OnUnityReady", {});


    const connectWithTimeout = async (adapter: WalletAdapter, timeoutMs: number = 20000): Promise<void> => {
        console.log(`[Page RUW Global] connectWithTimeout: Attempting to connect with adapter: ${adapter.name}, readyState: ${adapter.readyState}, connecting: ${walletHookRef.current.connecting}, timeout: ${timeoutMs}ms`);
        let timeoutHandle: NodeJS.Timeout;
    
        const connectionPromise = walletHookRef.current.connect(); 
    
        const timeoutPromise = new Promise<void>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            console.error(`[Page RUW Global] connectWithTimeout: Wallet connection timed out after ${timeoutMs}ms for ${adapter.name}.`);
            reject(new Error(`Connection to ${adapter.name} timed out after ${timeoutMs}ms.`));
          }, timeoutMs);
        });
    
        try {
          await Promise.race([connectionPromise, timeoutPromise]);
          clearTimeout(timeoutHandle!); 
          console.log(`[Page RUW Global] connectWithTimeout: Connection attempt for ${adapter.name} completed (either success or quick failure without timeout).`);
        } catch (error) {
          clearTimeout(timeoutHandle!); 
          console.error(`[Page RUW Global] connectWithTimeout: Error during connection attempt for ${adapter.name}:`, error);
          throw error; 
        }
    };


    window.handleConnectWalletRequest = async (walletNameFromUnity?: string) => {
        console.log("[Page RUW Global] window.handleConnectWalletRequest CALLED", { walletNameFromUnity });
      
        // 1. Check if already connected
        if (walletHookRef.current.connected && walletHookRef.current.publicKey) {
          console.log("[Page RUW Global] Already connected. Sending OnWalletConnected. PK:", walletHookRef.current.publicKey.toBase58() );
          sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: walletHookRef.current.publicKey.toBase58() });
          return;
        }
      
        // 2. Handle wallet selection
        let targetWalletName: WalletName | undefined = walletNameFromUnity as WalletName | undefined;
        
        if (targetWalletName) {
          console.log(`[Page RUW Global] Wallet specified by Unity: ${targetWalletName}`);
          const walletExists = availableWallets.some(w => w.adapter.name === targetWalletName);
          
          if (!walletExists) {
            console.warn(`[Page RUW Global] Wallet ${targetWalletName} not found. Opening modal for user selection.`);
            sendToUnityGame("GameBridgeManager", "OnWalletSelectionNeeded", { message: `Wallet ${targetWalletName} not found.` });
            walletModal.setVisible(true);
            return; // Exit: Modal will handle further selection
          }
          
          // Only select if different from current wallet or if no wallet is currently selected
          if (walletHookRef.current.wallet?.adapter.name !== targetWalletName || !walletHookRef.current.wallet) {
            try {
              console.log(`[Page RUW Global] Selecting wallet: ${targetWalletName}`);
              await selectWallet(targetWalletName); 
              // After select, walletHookRef.current.wallet will update due to the useEffect watching walletHook.
              // The connection will be attempted with the newly selected wallet below.
              console.log(`[Page RUW Global] Wallet ${targetWalletName} selected. Current adapter: ${walletHookRef.current.wallet?.adapter.name}`);
            } catch (e: any) {
              console.error(`[Page RUW Global] Error selecting wallet ${targetWalletName}:`, e);
              toast({ title: "Wallet Selection Error", description: e.message, variant: "destructive" });
              sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: `Failed to select ${targetWalletName}: ${e.message}`, action: "select_wallet_on_connect_request" });
              walletModal.setVisible(true); // Fallback to modal
              return; // Exit: Modal will handle further selection
            }
          }
        } else if (!walletHookRef.current.wallet) { // No wallet specified by Unity AND no wallet currently selected
          console.log("[Page RUW Global] No specific wallet requested by Unity and no wallet currently selected. Opening modal.");
          sendToUnityGame("GameBridgeManager", "OnWalletSelectionNeeded", { message: "Please select a wallet." });
          walletModal.setVisible(true);
          return; // Exit: Modal will handle further selection
        }
        // If a wallet is already selected (either from before, or just selected above), proceed.
      
        // 3. Check wallet readiness (using the potentially newly selected adapter)
        const adapter = walletHookRef.current.wallet?.adapter;
        if (!adapter) {
            console.error("[Page RUW Global] No wallet adapter available to connect even after selection logic. This shouldn't happen. Opening modal.");
            sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: "No wallet selected or adapter not found.", action: "connect_wallet_no_adapter" });
            walletModal.setVisible(true);
            return; // Exit
        }

        console.log(`[Page RUW Global] handleConnectWalletRequest: Proceeding with adapter: ${adapter.name}, readyState: ${adapter.readyState}, connecting: ${walletHookRef.current.connecting}`);
        
        if (adapter.readyState !== WalletReadyState.Installed && adapter.readyState !== WalletReadyState.Loadable) {
          const notReadyMsg = `Wallet ${adapter.name} is not ready. State: ${adapter.readyState}. You might need to install it or its browser extension.`;
          console.warn(`[Page RUW Global] ${notReadyMsg}`);
          if (adapter.url) { window.open(adapter.url, "_blank"); } 
          else { walletModal.setVisible(true); } // Fallback if no install URL
          toast({ title: "Wallet Not Ready", description: notReadyMsg, variant: "default", duration: 7000 });
          sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: notReadyMsg, action: "connect_wallet_not_ready"});
          return; // Exit
        }
      
        // 4. Connect with timeout
        try {
          console.log(`[Page RUW Global] Calling connectWithTimeout for adapter: ${adapter.name}`);
          await connectWithTimeout(adapter); 
          // The dedicated useEffect for wallet connection/disconnection will handle sending OnWalletConnected to Unity
          // and loading assets IF walletHookRef.current.connected becomes true.
          if (walletHookRef.current.connected) {
            console.log(`[Page RUW Global] Successfully initiated connection to ${adapter.name}. Wallet state will update and trigger effect.`);
          } else {
             // This case could happen if connectWithTimeout resolves but walletHook.connected is not yet true.
             // The dedicated useEffect should still pick up the change eventually.
             console.warn(`[Page RUW Global] Connection attempt to ${adapter.name} completed via connectWithTimeout, but wallet not immediately in 'connected' state. Waiting for wallet state effect.`);
          }
        } catch (error: any) {
          console.error(`[Page RUW Global] Connection error for ${adapter.name}:`, error);
          toast({ title: "Connection Failed", description: error.message, variant: "destructive" });
          sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, details: error.name, action: "connect_wallet_attempt" });
        }
      };
        
    window.handleIsWalletConnectedRequest = () => {
      const currentlyConnected = walletHookRef.current.connected;
      const pk = walletHookRef.current.publicKey?.toBase58() || null;
      sendToUnityGame("GameBridgeManager", "OnWalletConnectionStatus", { isConnected: currentlyConnected, publicKey: pk });
      return currentlyConnected;
    };

    window.handleGetPublicKeyRequest = () => {
      const pk = walletHookRef.current.publicKey?.toBase58() || null;
      sendToUnityGame("GameBridgeManager", "OnPublicKeyReceived", { publicKey: pk });
      return pk;
    };

    window.handleDisconnectWalletRequest = async () => {
      try {
        await walletHookRef.current.disconnect();
        // The dedicated useEffect will handle sending OnWalletDisconnected
      } catch (error: any) {
        sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "disconnect_wallet" });
        toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
      }
    };

    window.handleGetAvailableWalletsRequest = () => {
      const available = availableWallets.map(w => ({ name: w.adapter.name, icon: w.adapter.icon, readyState: w.adapter.readyState }));
      sendToUnityGame("GameBridgeManager", "OnAvailableWalletsReceived", { wallets: available });
      return available;
    };

    window.handleSelectWalletRequest = async (walletName: string) => {
      try {
        const targetWallet = availableWallets.find(w => w.adapter.name === walletName);
        if (!targetWallet) { throw new Error(`Wallet ${walletName} not available.`); }
        await selectWallet(walletName as WalletName); 
        console.log(`[Page RUW Global] Wallet selected via handleSelectWalletRequest: ${walletName}. Connect if needed.`);
        sendToUnityGame("GameBridgeManager", "OnWalletSelectAttempted", { walletName });
      } catch (error: any) {
        sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "select_wallet_exception" });
        toast({ title: "Wallet Selection Error", description: error.message, variant: "destructive" });
      }
    };
    
    window.handleGetUserNFTsRequest = async () => {
      if (!walletHookRef.current.publicKey || !connection) { sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { error: "Wallet not connected", nfts: [], cnfts: [] }); return; }
      setIsLoadingAssets(true); sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
      try {
        const { nfts: fetchedNfts, cnfts: fetchedCnfts, heliusWarning } = await fetchAssetsForOwner(walletHookRef.current.publicKey.toBase58(), rpcUrlRef.current, connection, walletHookRef.current);
        if (heliusWarning) sendToUnityGame("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
        setNfts(fetchedNfts); setCnfts(fetchedCnfts);
        sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { nfts: nftsRef.current, cnfts: cnftsRef.current });
      } catch (e:any) { sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { error: e.message, nfts:[], cnfts:[]}); }
      finally { setIsLoadingAssets(false); sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
    };

    window.handleGetUserTokensRequest = async () => {
      if (!walletHookRef.current.publicKey || !connection) { sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { error: "Wallet not connected", tokens: [], solBalance: 0 }); return; }
      setIsLoadingAssets(true); sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
      try {
        const [fetchedSol, { tokens: fetchedTokensFromHelius, heliusWarning }] = await Promise.all([
            fetchSolBalanceInternal(), 
            fetchAssetsForOwner(walletHookRef.current.publicKey.toBase58(), rpcUrlRef.current, connection, walletHookRef.current)
        ]);
        if (heliusWarning) sendToUnityGame("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
        setTokens(fetchedTokensFromHelius.filter(a => a.type === 'token') as SplToken[]);
        sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { tokens: tokensRef.current, solBalance: solBalanceRef.current });
      } catch (e:any) { sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { error: e.message, tokens:[], solBalance: 0}); }
      finally { setIsLoadingAssets(false); sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
    };

    window.handleGetSolBalanceRequest = async () => {
      return fetchSolBalanceInternal(); 
    };

    const performTransaction = async (actionName: string, mint: string | null, transactionFn: () => Promise<string>, reloadAssets: boolean = true) => {
      if (isSubmittingTransactionRef.current) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: "Transaction in progress", mint }); return; }
      if (!walletHookRef.current.publicKey || !walletHookRef.current.sendTransaction || !connection) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: "Wallet not connected", mint }); return; }
      setIsSubmittingTransaction(true); sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: actionName, submitting: true, mint });
      try {
        const signature = await transactionFn();
        toast({ title: `${actionName.replace(/_/g, ' ')} Initiated`, description: `Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
        sendToUnityGame("GameBridgeManager", "OnTransactionSubmitted", { action: actionName, signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
        if (reloadAssets ) { 
            debouncedLoadUserAssets(); 
        } else if (actionName === 'transfer_sol' || actionName === 'burn_sol' || actionName === 'deposit_sol') {
            fetchSolBalanceInternal(); 
        }
      } catch (error: any) { toast({ title: `${actionName.replace(/_/g, ' ')} Failed`, description: error.message, variant: "destructive" }); sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: error.message, mint });
      } finally { setIsSubmittingTransaction(false); sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: actionName, submitting: false, mint }); }
    };
    
    window.handleTransferSOLRequest = (amountSol: number, toAddress: string) => {
        if (amountSol <= 0) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Amount must be positive" }); return; }
        const recipientPublicKey = new PublicKey(toAddress);
        performTransaction("transfer_sol", null, () => transferSol(connection, walletHookRef.current, recipientPublicKey, amountSol), false);
    };

    window.handleTransferTokenRequest = (mint: string, amount: number, toAddress: string) => {
        const token = tokensRef.current.find(t => t.id === mint);
        if (!token) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Token not found", mint }); return; }
        if (amount <= 0) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Amount must be positive", mint }); return; }
        const recipientPublicKey = new PublicKey(toAddress);
        performTransaction("transfer_token", mint, () => transferSplToken(connection, walletHookRef.current, token, recipientPublicKey, amount));
    };

    window.handleTransferNFTRequest = (mint: string, toAddress: string) => {
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint && (a.type === 'nft' || a.type === 'cnft'));
        if (!asset) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "Asset not found", mint }); return; }
        const recipientPublicKey = new PublicKey(toAddress);
        if (asset.type === 'nft') performTransaction("transfer_nft", mint, () => transferNft(connection, walletHookRef.current, asset as Nft, recipientPublicKey));
        else if (asset.type === 'cnft') performTransaction("transfer_nft", mint, () => transferCNft(connection, walletHookRef.current, asset as CNft, recipientPublicKey, rpcUrlRef.current));
    };

     window.handleBurnSOLRequest = (amountSol: number) => {
        if (amountSol <= 0) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Amount must be positive" }); return; }
        performTransaction("burn_sol", null, () => burnSol(connection, walletHookRef.current, amountSol), false);
    };

    window.handleBurnAssetRequest = (mint: string, amount?: number) => {
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint);
        if (!asset) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Asset not found", mint }); return; }
        if (asset.type === 'nft') performTransaction("burn_asset", mint, () => burnNft(connection, walletHookRef.current, asset as Nft));
        else if (asset.type === 'cnft') performTransaction("burn_asset", mint, () => burnCNft(connection, walletHookRef.current, asset as CNft, rpcUrlRef.current));
        else if (asset.type === 'token') {
            if (typeof amount !== 'number' || amount <= 0) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Invalid amount for token burn", mint }); return; }
            performTransaction("burn_asset", mint, () => burnSplToken(connection, walletHookRef.current, asset as SplToken, amount));
        }
    };

    window.handleMintNFTRequest = (name: string, symbol: string, metadataUri: string) => {
      if (currentNetworkRef.current === 'mainnet-beta') {
        toast({ title: "Minting Disabled", description: "NFT minting disabled on Mainnet.", variant: "destructive" });
        sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Minting disabled on Mainnet" }); return;
      }
      performTransaction("mint_nft", name, () => mintStandardNft(connection, walletHookRef.current, metadataUri, name, symbol));
    };

    window.handleSwapTokensRequest = () => {
      const msg = "Token swapping is not yet implemented.";
      toast({ title: "Feature Unavailable", description: msg }); sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "swap_tokens", error: msg });
    };

    window.handleDepositFundsRequest = (tokenMintOrSol: string, amount: number) => {
        if (!CUSTODIAL_WALLET_ADDRESS) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Custodial address not set", tokenMint: tokenMintOrSol }); return; }
        if (amount <= 0) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Amount must be positive", tokenMint: tokenMintOrSol }); return; }
        if (tokenMintOrSol.toUpperCase() === "SOL") {
            performTransaction("deposit_funds", "SOL", () => depositSol(connection, walletHookRef.current, amount, CUSTODIAL_WALLET_ADDRESS), false);
        } else {
            const token = tokensRef.current.find(t => t.id === tokenMintOrSol);
            if (!token) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Token not found for deposit", tokenMint: tokenMintOrSol }); return; }
            performTransaction("deposit_funds", tokenMintOrSol, () => depositSplToken(connection, walletHookRef.current, token, amount, CUSTODIAL_WALLET_ADDRESS));
        }
    };

    window.handleWithdrawFundsRequest = async (tokenMintOrSol: string, grossAmount: number) => {
      if (isSubmittingTransactionRef.current) { sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Transaction in progress", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
      if (!walletHookRef.current.publicKey) { sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Wallet not connected", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
      if (grossAmount <= 0) { sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Amount must be positive", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
      setIsSubmittingTransaction(true); sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: true, tokenMint: tokenMintOrSol });
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
        sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetworkRef.current) : undefined });
      } catch (error: any) { toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" }); sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint: tokenMintOrSol });
      } finally { setIsSubmittingTransaction(false); sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); }
    };

    window.handleSetNetworkRequest = (network: SupportedSolanaNetwork) => {
        setCurrentNetwork(network); 
        sendToUnityGame("GameBridgeManager", "OnNetworkChanged", { network });
    };
    
    window.handleGetCurrentNetworkRequest = () => {
        sendToUnityGame("GameBridgeManager", "OnCurrentNetworkReceived", { network: currentNetworkRef.current });
        return currentNetworkRef.current;
    };
    
    console.log("[Page RUW BridgeEffect] Global Request Handlers DEFINED and active.");
    const activeHandlers = Object.keys(window).filter(key => key.startsWith("handle") && key.endsWith("Request"));
    activeHandlers.forEach(handlerKey => console.log(`[Page RUW BridgeEffect]   - ${handlerKey} is active.`));

    const handleGameBridgeManagerReady = () => {
      console.log("[Page RUW Listener] Received 'OnGameBridgeManagerReady' from Unity.");
    };
    addEventListener("OnGameBridgeManagerReady", handleGameBridgeManagerReady);


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
      // detachAndUnload is no longer called here
    };
  }, [
      isLoaded, connection, walletModal, availableWallets, selectWallet, 
      setCurrentNetwork, sendToUnityGame, toast, 
      fetchSolBalanceInternal, debouncedLoadUserAssets, 
      addEventListener, removeEventListener 
      // detachAndUnload is NOT a dependency here anymore
  ]);

  // Separate useEffect for handling Unity instance detachment on component unmount
  useEffect(() => {
    // This cleanup function will run when the component unmounts,
    // or if isLoaded/detachAndUnload references change (which is rare for detachAndUnload).
    return () => {
      if (isLoaded && detachAndUnload) {
        console.log("[Page RUW UnmountEffect] Detaching and unloading Unity instance.");
        detachAndUnload().catch(error => {
          console.error("[Page RUW UnmountEffect] Error detaching and unloading Unity instance:", error);
        });
      }
    };
  }, [isLoaded, detachAndUnload]); // Dependencies ensure this is stable and primarily for unmount


  const loadingPercentage = Math.round(loadingProgression * 100);

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-[100] w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-16 shrink-0">
        <div className="container flex h-full items-center justify-between px-4 md:px-6 mx-auto">
          <NetworkSwitcher />
          <ConnectWalletButton />
        </div>
      </header>

      <main className="flex-1 w-full relative overflow-hidden p-0 m-0">
        {!isClientMounted ? (
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
                     src={`/Build/${gameBaseNameOrDefault}_Logo.png`} 
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
             {loadingPercentage < 1 && (
                <p className="text-sm text-muted-foreground mt-6 px-4 text-center max-w-md">
                    Ensure your Unity build files (e.g., <code>{gameBaseNameOrDefault}.loader.js</code>, <code>.data</code>, <code>.wasm</code>) are in the <code>public/Build/</code> directory.
                </p>
             )}
              <p className="text-xs text-muted-foreground mt-2 px-4 text-center">If stuck, check browser console (F12) for errors.</p>
          </div>
        ) : null}
        {isClientMounted && ( 
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

