
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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

// Declare global functions for jslib to call
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

// Debounce function
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
  const { publicKey, connected, connect: connectWalletAdapter, disconnect: disconnectWalletAdapter, select, wallets: availableWallets } = walletHook;
  const { toast } = useToast();
  const { currentNetwork, setCurrentNetwork, rpcUrl } = useNetwork();
  const walletModal = useWalletModal();
  const walletHookRef = useRef(walletHook);

  const gameBaseNameOrDefault = UNITY_GAME_BUILD_BASE_NAME || "MyGame";

  const { unityProvider, isLoaded, loadingProgression, sendMessage, addEventListener, removeEventListener,UNSAFE__detachAndUnloadImmediate: detachAndUnload } = useUnityContext({
    loaderUrl: `/Build/${gameBaseNameOrDefault}.loader.js`,
    dataUrl: `/Build/${gameBaseNameOrDefault}.data`,
    frameworkUrl: `/Build/${gameBaseNameOrDefault}.framework.js`,
    codeUrl: `/Build/${gameBaseNameOrDefault}.wasm`,
    companyName: UNITY_COMPANY_NAME,
    productName: UNITY_PRODUCT_NAME,
    productVersion: UNITY_PRODUCT_VERSION,
  });

  const [nfts, setNfts] = useState<Nft[]>([]);
  const [cnfts, setCnfts] = useState<CNft[]>([]);
  const [tokens, setTokens] = useState<SplToken[]>([]);
  const [_solBalance, _setSolBalance] = useState<number>(0); 
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);
  const [currentDevicePixelRatio, setCurrentDevicePixelRatio] = useState<number | undefined>(undefined);
  const [isClientMounted, setIsClientMounted] = useState(false);


  // Refs for values that might be accessed in callbacks/effects
  const nftsRef = useRef(nfts);
  const cnftsRef = useRef(cnfts);
  const tokensRef = useRef(tokens);
  const solBalanceRef = useRef(_solBalance);
  const allFetchedAssetsRef = useRef<Asset[]>([]);
  const isSubmittingTransactionRef = useRef(isSubmittingTransaction);
  const rpcUrlRef = useRef(rpcUrl);
  const currentNetworkRef = useRef(currentNetwork);
  
  useEffect(() => { walletHookRef.current = walletHook; }, [walletHook]);
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
    setCurrentDevicePixelRatio(window.devicePixelRatio);
  }, []);

  const sendToUnityGame = useCallback((gameObjectName: string, methodName: string, message: any) => {
    if (isLoaded) { 
      const replacer = (key: string, value: any) => (typeof value === 'bigint' ? value.toString() : value);
      const msgStr = typeof message === 'object' ? JSON.stringify(message, replacer) : String(message);
      try {
        sendMessage(gameObjectName, methodName, msgStr);
        console.log(`[Page RUW] Sent to Unity: ${gameObjectName}.${methodName}`, message);
      } catch (e) {
        console.error(`[Page RUW] Error sending message to Unity: ${gameObjectName}.${methodName}`, e, "Message was:", message);
      }
    } else {
      console.warn(`[Page RUW] sendToUnityGame: Unity not loaded or ready. Cannot send. isLoaded: ${isLoaded}.`);
    }
  }, [isLoaded, sendMessage]);


  const fetchSolBalanceInternal = useCallback(async (
    currentPk: PublicKey | null,
    currentConn: Connection
  ): Promise<number> => {
    if (currentPk && currentConn) {
      try {
        const balance = await currentConn.getBalance(currentPk);
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
  }, [sendToUnityGame, toast]);

  const loadUserAssetsInternal = useCallback(async (
    currentPk: PublicKey | null,
    currentRpcFromRef: string,
    currentConn: Connection,
  ) => {
    if (!currentPk || !currentRpcFromRef || !currentConn || !walletHookRef.current.publicKey) {
      setNfts([]); setCnfts([]); setTokens([]); _setSolBalance(0);
      sendToUnityGame("GameBridgeManager", "OnAssetsLoaded", { nfts: [], cnfts: [], tokens: [], solBalance: 0 });
      return;
    }
    setIsLoadingAssets(true);
    sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
    try {
      const validWalletContext = walletHookRef.current.publicKey ? walletHookRef.current : walletHook;
      const [fetchedSol, { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, heliusWarning }] = await Promise.all([
        fetchSolBalanceInternal(currentPk, currentConn),
        fetchAssetsForOwner(currentPk.toBase58(), currentRpcFromRef, currentConn, validWalletContext)
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
      setNfts([]); setCnfts([]); setTokens([]); _setSolBalance(0);
    } finally {
      setIsLoadingAssets(false);
      sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false });
    }
  }, [sendToUnityGame, toast, fetchSolBalanceInternal, walletHook]); // walletHook as dep for validWalletContext fallback

  const debouncedLoadUserAssets = useMemo(() => debounce(loadUserAssetsInternal, 500), [loadUserAssetsInternal]);

  useEffect(() => {
    if (!isLoaded) {
      console.log("[Page RUW WalletEffect] Unity not ready (isLoaded is false), skipping asset load/wallet status update to Unity.");
      return;
    }
    if (walletHookRef.current.connected && walletHookRef.current.publicKey && rpcUrlRef.current && connection) {
      console.log("[Page RUW WalletEffect] Wallet connected AND Unity ready. Sending OnWalletConnected to Unity and loading assets.");
      sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: walletHookRef.current.publicKey.toBase58() });
      debouncedLoadUserAssets(walletHookRef.current.publicKey, rpcUrlRef.current, connection);
    } else if (!walletHookRef.current.connected && isLoaded) {
      console.log("[Page RUW WalletEffect] Wallet disconnected AND Unity ready. Sending OnWalletDisconnected to Unity.");
      sendToUnityGame("GameBridgeManager", "OnWalletDisconnected", {});
      setNfts([]); setCnfts([]); setTokens([]); _setSolBalance(0);
    }
  // Main dependencies: isLoaded, connection. WalletHookRef.current.connected/publicKey are read via ref.
  // RpcUrlRef.current also read via ref. DebouncedLoadUserAssets has its own deps.
  }, [isLoaded, connection, sendToUnityGame, debouncedLoadUserAssets]);


  useEffect(() => {
    console.log("[Page RUW BridgeEffect] Setting up global handlers and react-unity-webgl event listeners. RUW isLoaded:", isLoaded);

    if (!isLoaded) {
      console.log("[Page RUW BridgeEffect] RUW isLoaded is false. Global handlers will be defined once Unity is ready.");
      // Do not define handlers yet if Unity isn't ready, as they depend on walletHookRef which might also not be fully stable
      // or they might be called prematurely.
    } else {
        console.log("[Page RUW BridgeEffect] RUW isLoaded is true. Signaling 'OnUnityReady' to GameBridgeManager C# (which means JS bridge is up).");
        sendToUnityGame("GameBridgeManager", "OnUnityReady", {});

        const connectWithTimeout = async (adapter: WalletAdapter, timeoutMs: number = 20000): Promise<void> => {
          console.log(`[Page RUW connectWithTimeout] Attempting to connect with adapter: ${adapter.name}, timeout: ${timeoutMs}ms`);
          let timeoutHandle: NodeJS.Timeout;
      
          const connectionPromise = walletHookRef.current.connect();
      
          const timeoutPromise = new Promise<void>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              console.error(`[Page RUW connectWithTimeout] Wallet connection timed out after ${timeoutMs}ms for ${adapter.name}.`);
              reject(new Error(`Connection to ${adapter.name} timed out.`));
            }, timeoutMs);
          });
      
          try {
            await Promise.race([connectionPromise, timeoutPromise]);
            clearTimeout(timeoutHandle!); // Clear timeout if connection succeeds or fails fast
            console.log(`[Page RUW connectWithTimeout] Connection attempt for ${adapter.name} completed (either success or quick failure).`);
          } catch (error) {
            clearTimeout(timeoutHandle!); // Clear timeout if connection promise itself rejects
            console.error(`[Page RUW connectWithTimeout] Error during connection attempt for ${adapter.name}:`, error);
            throw error; // Re-throw the error (either from timeout or from connect())
          }
        };

        window.handleConnectWalletRequest = async (walletNameFromUnity?: string) => {
          console.log("[Page RUW Global] window.handleConnectWalletRequest CALLED.", 
            "walletHook.connected:", walletHookRef.current.connected, 
            "walletHook.wallet:", walletHookRef.current.wallet?.adapter.name,
            "Wallet name from Unity:", walletNameFromUnity
          );
    
          if (walletHookRef.current.connected && walletHookRef.current.publicKey) {
              console.log("[Page RUW Global] handleConnectWalletRequest: Already connected. Sending OnWalletConnected.");
              sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: walletHookRef.current.publicKey.toBase58() });
              return;
          }
    
          let targetWalletName: WalletName | undefined = walletNameFromUnity as WalletName | undefined;
          
          if (targetWalletName) {
            const selectedAdapter = availableWallets.find(w => w.adapter.name === targetWalletName)?.adapter;
            if (selectedAdapter) {
              console.log(`[Page RUW Global] Wallet specified by Unity: ${targetWalletName}. Current adapter in hook: ${walletHookRef.current.wallet?.adapter.name}. Selecting if different.`);
              if (walletHookRef.current.wallet?.adapter.name !== targetWalletName) {
                try {
                  console.log(`[Page RUW Global] Attempting to select wallet: ${targetWalletName}`);
                  await walletHookRef.current.select(targetWalletName);
                  // Re-check after select, as it might update walletHookRef.current.wallet asynchronously
                  // However, connect() below will use the selected wallet implicitly.
                  console.log(`[Page RUW Global] Wallet ${targetWalletName} selected. Proceeding to connect.`);
                } catch (e: any) {
                  console.error(`[Page RUW Global] Error selecting wallet ${targetWalletName}:`, e);
                  sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: `Failed to select ${targetWalletName}: ${e.message}`, action: "select_wallet_on_connect_request" });
                  toast({ title: "Wallet Selection Error", description: e.message, variant: "destructive" });
                  walletModal.setVisible(true); // Fallback to modal
                  return;
                }
              }
            } else {
              console.warn(`[Page RUW Global] Wallet ${targetWalletName} specified by Unity not found in available wallets. Opening modal.`);
              walletModal.setVisible(true);
              sendToUnityGame("GameBridgeManager", "OnWalletSelectionNeeded", {message: `Wallet ${targetWalletName} not found.`});
              return;
            }
          }
          
          if (!walletHookRef.current.wallet) {
              console.warn("[Page RUW Global] handleConnectWalletRequest: No wallet adapter selected or available in hook. Opening wallet selection modal.");
              setTimeout(() => walletModal.setVisible(true), 0); 
              sendToUnityGame("GameBridgeManager", "OnWalletSelectionNeeded", {message: "Please select a wallet."});
              return;
          }
    
          const adapter = walletHookRef.current.wallet.adapter;
          console.log(`[Page RUW Global] handleConnectWalletRequest: Proceeding with adapter: ${adapter.name}, ReadyState: ${adapter.readyState}, Connecting: ${walletHookRef.current.connecting}`);
    
          if (adapter.readyState !== WalletReadyState.Installed && adapter.readyState !== WalletReadyState.Loadable) {
             const notReadyMsg = `Wallet ${adapter.name} is not ready (State: ${adapter.readyState}). You might need to install it or its browser extension.`;
             console.warn(`[Page RUW Global] handleConnectWalletRequest: ${notReadyMsg}`);
             if (adapter.url) window.open(adapter.url, '_blank'); else walletModal.setVisible(true);
             sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: notReadyMsg, action: "connect_wallet_not_ready"});
             toast({ title: "Wallet Not Ready", description: notReadyMsg, variant: "default", duration: 7000 });
             return;
          }
    
          try {
            console.log(`[Page RUW Global] Calling connectWithTimeout for adapter: ${adapter.name}`);
            await connectWithTimeout(adapter); // Uses walletHookRef.current.connect() internally
            // OnWalletConnected will be sent by the main wallet effect if successful
            console.log(`[Page RUW Global] connectWithTimeout completed for ${adapter.name}. Current status: connected=${walletHookRef.current.connected}`);
            if (walletHookRef.current.connected && walletHookRef.current.publicKey) {
               // This is a bit redundant if the main effect handles it, but good for immediate feedback
               sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: walletHookRef.current.publicKey.toBase58() });
            } else if (!walletHookRef.current.connecting) {
              // If not connecting and not connected, it might have been a silent failure or user cancellation
              console.warn(`[Page RUW Global] Wallet ${adapter.name} is not connected after attempt and not in connecting state.`);
              // Potentially send OnWalletConnectionError if it's not a user cancellation
            }
          } catch (error: any) {
            console.error(`[Page RUW Global] Error during connectWithTimeout for ${adapter.name}:`, error);
            sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, details: error.name, action: "connect_wallet_attempt" });
            toast({ title: "Wallet Connection Error", description: `${error.name || 'Error'}: ${error.message}`, variant: "destructive" });
          }
        };
        console.log("[Page RUW BridgeEffect]   - handleConnectWalletRequest is active.");

        window.handleIsWalletConnectedRequest = () => {
          const currentlyConnected = walletHookRef.current.connected;
          const pk = walletHookRef.current.publicKey?.toBase58() || null;
          sendToUnityGame("GameBridgeManager", "OnWalletConnectionStatus", { isConnected: currentlyConnected, publicKey: pk });
          return currentlyConnected;
        };
        console.log("[Page RUW BridgeEffect]   - handleIsWalletConnectedRequest is active.");

        window.handleGetPublicKeyRequest = () => {
          const pk = walletHookRef.current.publicKey?.toBase58() || null;
          sendToUnityGame("GameBridgeManager", "OnPublicKeyReceived", { publicKey: pk });
          return pk;
        };
        console.log("[Page RUW BridgeEffect]   - handleGetPublicKeyRequest is active.");

        window.handleDisconnectWalletRequest = async () => {
          try {
            await walletHookRef.current.disconnect();
            // OnWalletDisconnected will be sent by the main wallet effect
          } catch (error: any) {
            sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "disconnect_wallet" });
            toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
          }
        };
        console.log("[Page RUW BridgeEffect]   - handleDisconnectWalletRequest is active.");

        window.handleGetAvailableWalletsRequest = () => {
          const available = availableWallets.map(w => ({ name: w.adapter.name, icon: w.adapter.icon, readyState: w.adapter.readyState }));
          sendToUnityGame("GameBridgeManager", "OnAvailableWalletsReceived", { wallets: available });
          return available;
        };
        console.log("[Page RUW BridgeEffect]   - handleGetAvailableWalletsRequest is active.");

        window.handleSelectWalletRequest = (walletName: string) => {
          try {
            const targetWallet = availableWallets.find(w => w.adapter.name === walletName);
            if (!targetWallet) { throw new Error(`Wallet ${walletName} not available.`); }
            walletHookRef.current.select(walletName as WalletName);
            console.log(`[Page RUW Global] Wallet selected via handleSelectWalletRequest: ${walletName}. Modal might be needed if not auto-connecting.`);
            sendToUnityGame("GameBridgeManager", "OnWalletSelectAttempted", { walletName });
             // Optionally, trigger connect automatically or open modal if not connecting
            // For now, just selecting. Unity might call connect explicitly after this.
          } catch (error: any) {
            sendToUnityGame("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "select_wallet_exception" });
            toast({ title: "Wallet Selection Error", description: error.message, variant: "destructive" });
          }
        };
        console.log("[Page RUW BridgeEffect]   - handleSelectWalletRequest is active.");
        
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
        console.log("[Page RUW BridgeEffect]   - handleGetUserNFTsRequest is active.");

        window.handleGetUserTokensRequest = async () => {
          if (!walletHookRef.current.publicKey || !connection) { sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { error: "Wallet not connected", tokens: [], solBalance: 0 }); return; }
          setIsLoadingAssets(true); sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
          try {
            const [fetchedSol, { tokens: fetchedTokensFromHelius, heliusWarning }] = await Promise.all([
                fetchSolBalanceInternal(walletHookRef.current.publicKey, connection),
                fetchAssetsForOwner(walletHookRef.current.publicKey.toBase58(), rpcUrlRef.current, connection, walletHookRef.current)
            ]);
            if (heliusWarning) sendToUnityGame("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
            setTokens(fetchedTokensFromHelius.filter(a => a.type === 'token') as SplToken[]);
            sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { tokens: tokensRef.current, solBalance: solBalanceRef.current });
          } catch (e:any) { sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { error: e.message, tokens:[], solBalance: 0}); }
          finally { setIsLoadingAssets(false); sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
        };
        console.log("[Page RUW BridgeEffect]   - handleGetUserTokensRequest is active.");

        window.handleGetSolBalanceRequest = async () => {
          if (!walletHookRef.current.publicKey || !connection) { sendToUnityGame("GameBridgeManager", "OnSolBalanceUpdateFailed", { error: "Wallet not connected" }); return 0; }
          return fetchSolBalanceInternal(walletHookRef.current.publicKey, connection);
        };
        console.log("[Page RUW BridgeEffect]   - handleGetSolBalanceRequest is active.");

        const performTransaction = async (actionName: string, mint: string | null, transactionFn: () => Promise<string>, reloadAssets: boolean = true) => {
          if (isSubmittingTransactionRef.current) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: "Transaction in progress", mint }); return; }
          if (!walletHookRef.current.publicKey || !walletHookRef.current.sendTransaction || !connection) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: "Wallet not connected", mint }); return; }
          setIsSubmittingTransaction(true); sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: actionName, submitting: true, mint });
          try {
            const signature = await transactionFn();
            toast({ title: `${actionName.replace(/_/g, ' ')} Initiated`, description: `Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
            sendToUnityGame("GameBridgeManager", "OnTransactionSubmitted", { action: actionName, signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
            if (reloadAssets && walletHookRef.current.publicKey && rpcUrlRef.current && connection) { // Check walletHookRef.current
                debouncedLoadUserAssets(walletHookRef.current.publicKey, rpcUrlRef.current, connection);
            } else if (actionName === 'transfer_sol' || actionName === 'burn_sol' || actionName === 'deposit_sol') {
                if (walletHookRef.current.publicKey && connection) fetchSolBalanceInternal(walletHookRef.current.publicKey, connection); // Check walletHookRef.current
            }
          } catch (error: any) { toast({ title: `${actionName.replace(/_/g, ' ')} Failed`, description: error.message, variant: "destructive" }); sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: error.message, mint });
          } finally { setIsSubmittingTransaction(false); sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: actionName, submitting: false, mint }); }
        };
        
        window.handleTransferSOLRequest = (amountSol: number, toAddress: string) => {
            if (amountSol <= 0) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Amount must be positive" }); return; }
            const recipientPublicKey = new PublicKey(toAddress);
            performTransaction("transfer_sol", null, () => transferSol(connection, walletHookRef.current, recipientPublicKey, amountSol), false);
        };
        console.log("[Page RUW BridgeEffect]   - handleTransferSOLRequest is active.");

        window.handleTransferTokenRequest = (mint: string, amount: number, toAddress: string) => {
            const token = tokensRef.current.find(t => t.id === mint);
            if (!token) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Token not found", mint }); return; }
            if (amount <= 0) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Amount must be positive", mint }); return; }
            const recipientPublicKey = new PublicKey(toAddress);
            performTransaction("transfer_token", mint, () => transferSplToken(connection, walletHookRef.current, token, recipientPublicKey, amount));
        };
        console.log("[Page RUW BridgeEffect]   - handleTransferTokenRequest is active.");

        window.handleTransferNFTRequest = (mint: string, toAddress: string) => {
            const asset = allFetchedAssetsRef.current.find(a => a.id === mint && (a.type === 'nft' || a.type === 'cnft'));
            if (!asset) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "Asset not found", mint }); return; }
            const recipientPublicKey = new PublicKey(toAddress);
            if (asset.type === 'nft') performTransaction("transfer_nft", mint, () => transferNft(connection, walletHookRef.current, asset as Nft, recipientPublicKey));
            else if (asset.type === 'cnft') performTransaction("transfer_nft", mint, () => transferCNft(connection, walletHookRef.current, asset as CNft, recipientPublicKey, rpcUrlRef.current));
        };
        console.log("[Page RUW BridgeEffect]   - handleTransferNFTRequest is active.");

         window.handleBurnSOLRequest = (amountSol: number) => {
            if (amountSol <= 0) { sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Amount must be positive" }); return; }
            performTransaction("burn_sol", null, () => burnSol(connection, walletHookRef.current, amountSol), false);
        };
        console.log("[Page RUW BridgeEffect]   - handleBurnSOLRequest is active.");

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
        console.log("[Page RUW BridgeEffect]   - handleBurnAssetRequest is active.");

        window.handleMintNFTRequest = (name: string, symbol: string, metadataUri: string) => {
          if (currentNetworkRef.current === 'mainnet-beta') {
            toast({ title: "Minting Disabled", description: "NFT minting disabled on Mainnet.", variant: "destructive" });
            sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Minting disabled on Mainnet" }); return;
          }
          performTransaction("mint_nft", name, () => mintStandardNft(connection, walletHookRef.current, metadataUri, name, symbol));
        };
        console.log("[Page RUW BridgeEffect]   - handleMintNFTRequest is active.");

        window.handleSwapTokensRequest = () => {
          const msg = "Token swapping is not yet implemented.";
          toast({ title: "Feature Unavailable", description: msg }); sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: "swap_tokens", error: msg });
        };
        console.log("[Page RUW BridgeEffect]   - handleSwapTokensRequest is active.");

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
        console.log("[Page RUW BridgeEffect]   - handleDepositFundsRequest is active.");

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
              if (walletHookRef.current.publicKey && connection) fetchSolBalanceInternal(walletHookRef.current.publicKey, connection);
            } else {
              toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
            }
            sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetworkRef.current) : undefined });
          } catch (error: any) { toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" }); sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint: tokenMintOrSol });
          } finally { setIsSubmittingTransaction(false); sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); }
        };
        console.log("[Page RUW BridgeEffect]   - handleWithdrawFundsRequest is active.");

        window.handleSetNetworkRequest = (network: SupportedSolanaNetwork) => {
            setCurrentNetwork(network); 
            sendToUnityGame("GameBridgeManager", "OnNetworkChanged", { network });
        };
        console.log("[Page RUW BridgeEffect]   - handleSetNetworkRequest is active.");

        window.handleGetCurrentNetworkRequest = () => {
            sendToUnityGame("GameBridgeManager", "OnCurrentNetworkReceived", { network: currentNetworkRef.current });
            return currentNetworkRef.current;
        };
        console.log("[Page RUW BridgeEffect]   - handleGetCurrentNetworkRequest is active.");

        console.log("[Page RUW BridgeEffect] Global Request Handlers DEFINED.");
    }
    
    const handleGameBridgeManagerReady = () => {
      console.log("[Page RUW Listener] Received 'OnGameBridgeManagerReady' from Unity.");
    };
    addEventListener("OnGameBridgeManagerReady", handleGameBridgeManagerReady);


    return () => {
      console.log("[Page RUW BridgeEffect] Cleaning up global handlers and react-unity-webgl event listeners.");
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
      
      if (isLoaded && detachAndUnload) {
        console.log("[Page RUW Cleanup] Detaching and unloading Unity instance.");
        detachAndUnload().catch(error => {
          console.error("[Page RUW Cleanup] Error detaching and unloading Unity instance:", error);
        });
      }
    };
  }, [
      isLoaded, connection, walletModal, availableWallets, setCurrentNetwork, // Direct dependencies for setup
      sendToUnityGame, toast, fetchSolBalanceInternal, debouncedLoadUserAssets, // Callbacks
      addEventListener, removeEventListener, detachAndUnload // from useUnityContext
  ]);


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
                <img
                     src={`/Build/${gameBaseNameOrDefault}_Logo.png`} 
                     alt="Game Logo"
                     className="w-full h-full object-contain"
                     data-ai-hint="phoenix fire"
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
        {isClientMounted && ( // Only render Unity component on client after mount
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
