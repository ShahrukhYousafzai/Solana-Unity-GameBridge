
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
import { Unity, useUnityContext } from "react-unity-webgl";

const ConnectWalletButton = dynamic(
  () => import("@/components/ConnectWalletButton").then((mod) => mod.ConnectWalletButton),
  {
    ssr: false,
    loading: () => <Skeleton className="h-10 w-32 rounded-md" />
  }
);

// Declare global functions that jslib will call
declare global {
  interface Window {
    // Functions exposed FOR jslib to call
    handleConnectWalletRequest?: () => void;
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
    handleSwapTokensRequest?: () => void;
    handleDepositFundsRequest?: (tokenMintOrSol: string, amount: number) => void;
    handleWithdrawFundsRequest?: (tokenMintOrSol: string, grossAmount: number) => void;
    handleSetNetworkRequest?: (network: SupportedSolanaNetwork) => void;
    handleGetCurrentNetworkRequest?: () => SupportedSolanaNetwork;

    // For direct call from Unity for connect wallet, if needed by C# DllImport __Internal to "callConnectWalletFromUnity"
    callConnectWalletFromUnity?: () => void;
  }
}

// Debounce function remains the same
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

  const gameBaseNameOrDefault = UNITY_GAME_BUILD_BASE_NAME || "MyGame";

  const { unityProvider, isLoaded, loadingProgression, sendMessage, addEventListener, removeEventListener } = useUnityContext({
    loaderUrl: `/Build/${gameBaseNameOrDefault}.loader.js`,
    dataUrl: `/Build/${gameBaseNameOrDefault}.data`,
    frameworkUrl: `/Build/${gameBaseNameOrDefault}.framework.js`,
    codeUrl: `/Build/${gameBaseNameOrDefault}.wasm`,
  });

  const [nfts, setNfts] = useState<Nft[]>([]);
  const [cnfts, setCnfts] = useState<CNft[]>([]);
  const [tokens, setTokens] = useState<SplToken[]>([]);
  const [_solBalance, _setSolBalance] = useState<number>(0); // Renamed to avoid conflict
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);

  // Refs for values that might be accessed in callbacks/effects
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

  const sendToUnity = useCallback((gameObjectName: string, methodName: string, message: any) => {
    if (isLoaded) { // Use isLoaded from react-unity-webgl
      const replacer = (key: string, value: any) => (typeof value === 'bigint' ? value.toString() : value);
      const msgStr = typeof message === 'object' ? JSON.stringify(message, replacer) : String(message);
      try {
        sendMessage(gameObjectName, methodName, msgStr);
        console.log(`[Page RUW] Sent to Unity: ${gameObjectName}.${methodName}`, message);
      } catch (e) {
        console.error(`[Page RUW] Error sending message to Unity: ${gameObjectName}.${methodName}`, e, "Message was:", message);
      }
    } else {
      console.warn(`[Page RUW] sendToUnity: Unity not loaded. Cannot send. IsLoaded: ${isLoaded}.`);
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
        sendToUnity("GameBridgeManager", "OnSolBalanceUpdated", { solBalance: sol });
        return sol;
      } catch (error: any) {
        console.error("[Page RUW] Failed to fetch SOL balance:", error);
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
      const validWalletContext = currentWalletCtx.publicKey ? currentWalletCtx : walletHook; // Ensure we use a valid context
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
      console.error("[Page RUW] Failed to load assets:", error);
      toast({ title: "Error Loading Assets", description: error.message, variant: "destructive" });
      sendToUnity("GameBridgeManager", "OnAssetsLoadFailed", { error: error.message });
      setNfts([]); setCnfts([]); setTokens([]); _setSolBalance(0);
    } finally {
      setIsLoadingAssets(false);
      sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false });
    }
  }, [sendToUnity, toast, fetchSolBalanceInternal, walletHook]);

  const debouncedLoadUserAssets = useMemo(() => debounce(loadUserAssetsInternal, 500), [loadUserAssetsInternal]);

  // Effect for Wallet Status and Asset Loading, dependent on Unity being ready
  useEffect(() => {
    if (!isLoaded) { // Use isLoaded from react-unity-webgl
      console.log("[Page RUW WalletEffect] Unity not ready, skipping asset load/wallet status update to Unity.");
      return;
    }
    if (connected && publicKey && rpcUrlRef.current && connection && walletHook) {
      console.log("[Page RUW WalletEffect] Wallet connected AND Unity ready. Sending OnWalletConnected to Unity and loading assets.");
      sendToUnity("GameBridgeManager", "OnWalletConnected", { publicKey: publicKey.toBase58() });
      debouncedLoadUserAssets(publicKey, rpcUrlRef.current, connection, walletHook);
    } else if (!connected && isLoaded) {
      console.log("[Page RUW WalletEffect] Wallet disconnected AND Unity ready. Sending OnWalletDisconnected to Unity.");
      sendToUnity("GameBridgeManager", "OnWalletDisconnected", {});
      setNfts([]); setCnfts([]); setTokens([]); _setSolBalance(0);
    }
  }, [connected, publicKey, connection, walletHook, debouncedLoadUserAssets, sendToUnity, isLoaded]);


  // Setup global bridge functions for jslib and react-unity-webgl event listeners
  useEffect(() => {
    console.log("[Page RUW BridgeEffect] Setting up global handlers and react-unity-webgl event listeners. isLoaded:", isLoaded);

    // Functions to be called by jslib (exposed on window)
    // These now act as the "unityBridge" methods effectively
    window.handleConnectWalletRequest = async () => {
      console.log("[Page RUW Global] handleConnectWalletRequest CALLED. walletHook.wallet:", walletHook.wallet?.adapter.name, "walletHook.connected:", walletHook.connected);
      if (walletHook.connected && walletHook.publicKey) {
          console.log("[Page RUW Global] handleConnectWalletRequest: Already connected. Sending OnWalletConnected.");
          sendToUnity("GameBridgeManager", "OnWalletConnected", { publicKey: walletHook.publicKey.toBase58() });
          return;
      }
      if (!walletHook.wallet) {
          console.warn("[Page RUW Global] handleConnectWalletRequest: No wallet type selected. Opening wallet selection modal.");
          setTimeout(() => walletModal.setVisible(true), 0);
          sendToUnity("GameBridgeManager", "OnWalletSelectionNeeded", {message: "Please select a wallet."});
          return;
      }
      const adapterState = walletHook.wallet.adapter.readyState;
      if (adapterState !== WalletReadyState.Installed && adapterState !== WalletReadyState.Loadable) {
         const notReadyMsg = `Wallet ${walletHook.wallet.adapter.name} is not ready (State: ${adapterState}).`;
         console.warn(`[Page RUW Global] handleConnectWalletRequest: ${notReadyMsg}`);
         setTimeout(() => walletModal.setVisible(true), 0);
         sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: notReadyMsg, action: "connect_wallet_not_ready"});
         toast({ title: "Wallet Not Ready", description: notReadyMsg, variant: "default" });
         return;
      }
      try {
        console.log("[Page RUW Global] Attempting wallet connection via adapter...");
        await connectWalletAdapter();
      } catch (error: any) {
        sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: error.message, details: error.name, action: "connect_wallet_attempt" });
        toast({ title: "Wallet Connection Error", description: `${error.name}: ${error.message}`, variant: "destructive" });
      }
    };

    window.handleIsWalletConnectedRequest = () => {
      const currentlyConnected = walletHook.connected;
      const pk = walletHook.publicKey?.toBase58() || null;
      sendToUnity("GameBridgeManager", "OnWalletConnectionStatus", { isConnected: currentlyConnected, publicKey: pk });
      return currentlyConnected;
    };
    window.handleGetPublicKeyRequest = () => {
      const pk = walletHook.publicKey?.toBase58() || null;
      sendToUnity("GameBridgeManager", "OnPublicKeyReceived", { publicKey: pk });
      return pk;
    };
    window.handleDisconnectWalletRequest = async () => {
      try { await disconnectWalletAdapter(); }
      catch (error: any) { sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "disconnect_wallet" }); }
    };
    window.handleGetAvailableWalletsRequest = () => {
      const available = availableWallets.map(w => ({ name: w.adapter.name, icon: w.adapter.icon, readyState: w.adapter.readyState }));
      sendToUnity("GameBridgeManager", "OnAvailableWalletsReceived", { wallets: available });
      return available;
    };
    window.handleSelectWalletRequest = (walletName: string) => {
      try {
        const targetWallet = availableWallets.find(w => w.adapter.name === walletName);
        if (!targetWallet) { throw new Error(`Wallet ${walletName} not available.`); }
        select(walletName as WalletName);
        sendToUnity("GameBridgeManager", "OnWalletSelectAttempted", { walletName });
      } catch (error: any) { sendToUnity("GameBridgeManager", "OnWalletConnectionError", { error: error.message, action: "select_wallet_exception" }); }
    };

    window.handleGetUserNFTsRequest = async () => {
      if (!walletHook.publicKey || !connection) { sendToUnity("GameBridgeManager", "OnUserNFTsRequested", { error: "Wallet not connected", nfts: [], cnfts: [] }); return; }
      setIsLoadingAssets(true); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
      try {
        const { nfts: fetchedNfts, cnfts: fetchedCnfts, heliusWarning } = await fetchAssetsForOwner(walletHook.publicKey.toBase58(), rpcUrlRef.current, connection, walletHook);
        if (heliusWarning) sendToUnity("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning, isError: heliusWarning.toLowerCase().includes("api key")});
        setNfts(fetchedNfts); setCnfts(fetchedCnfts);
        sendToUnity("GameBridgeManager", "OnUserNFTsRequested", { nfts: nftsRef.current, cnfts: cnftsRef.current });
      } catch (e:any) { sendToUnity("GameBridgeManager", "OnUserNFTsRequested", { error: e.message, nfts:[], cnfts:[]}); }
      finally { setIsLoadingAssets(false); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
    };
    window.handleGetUserTokensRequest = async () => {
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
      } catch (e:any) { sendToUnity("GameBridgeManager", "OnUserTokensRequested", { error: e.message, tokens:[], solBalance: 0}); }
      finally { setIsLoadingAssets(false); sendToUnity("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false }); }
    };
    window.handleGetSolBalanceRequest = async () => {
      if (!walletHook.publicKey || !connection) { sendToUnity("GameBridgeManager", "OnSolBalanceUpdateFailed", { error: "Wallet not connected" }); return 0; }
      return fetchSolBalanceInternal(walletHook.publicKey, connection);
    };

    const performTransaction = async (actionName: string, mint: string | null, transactionFn: () => Promise<string>, reloadAssets: boolean = true) => {
      if (isSubmittingTransactionRef.current) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: actionName, error: "Transaction in progress", mint }); return; }
      if (!walletHook.publicKey || !walletHook.sendTransaction || !connection) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: actionName, error: "Wallet not connected", mint }); return; }
      setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: actionName, submitting: true, mint });
      try {
        const signature = await transactionFn();
        toast({ title: `${actionName.replace(/_/g, ' ')} Initiated`, description: `Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
        sendToUnity("GameBridgeManager", "OnTransactionSubmitted", { action: actionName, signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
        if (reloadAssets && walletHook.publicKey && rpcUrlRef.current && connection && walletHook) {
            debouncedLoadUserAssets(walletHook.publicKey, rpcUrlRef.current, connection, walletHook);
        } else if (actionName === 'transfer_sol' || actionName === 'burn_sol') {
            if (walletHook.publicKey && connection) fetchSolBalanceInternal(walletHook.publicKey, connection);
        }
      } catch (error: any) { toast({ title: `${actionName.replace(/_/g, ' ')} Failed`, description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: actionName, error: error.message, mint });
      } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: actionName, submitting: false, mint }); }
    };
    
    window.handleTransferSOLRequest = (amountSol: number, toAddress: string) => {
        if (amountSol <= 0) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_sol", error: "Amount must be positive" }); return; }
        const recipientPublicKey = new PublicKey(toAddress);
        performTransaction("transfer_sol", null, () => transferSol(connection, walletHook, recipientPublicKey, amountSol), false);
    };
    window.handleTransferTokenRequest = (mint: string, amount: number, toAddress: string) => {
        const token = tokensRef.current.find(t => t.id === mint);
        if (!token) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Token not found", mint }); return; }
        if (amount <= 0) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_token", error: "Amount must be positive", mint }); return; }
        const recipientPublicKey = new PublicKey(toAddress);
        performTransaction("transfer_token", mint, () => transferSplToken(connection, walletHook, token, recipientPublicKey, amount));
    };
    window.handleTransferNFTRequest = (mint: string, toAddress: string) => {
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint && (a.type === 'nft' || a.type === 'cnft'));
        if (!asset) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "transfer_nft", error: "Asset not found", mint }); return; }
        const recipientPublicKey = new PublicKey(toAddress);
        if (asset.type === 'nft') performTransaction("transfer_nft", mint, () => transferNft(connection, walletHook, asset as Nft, recipientPublicKey));
        else if (asset.type === 'cnft') performTransaction("transfer_nft", mint, () => transferCNft(connection, walletHook, asset as CNft, recipientPublicKey, rpcUrlRef.current));
    };
     window.handleBurnSOLRequest = (amountSol: number) => {
        if (amountSol <= 0) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_sol", error: "Amount must be positive" }); return; }
        performTransaction("burn_sol", null, () => burnSol(connection, walletHook, amountSol), false);
    };
    window.handleBurnAssetRequest = (mint: string, amount?: number) => {
        const asset = allFetchedAssetsRef.current.find(a => a.id === mint);
        if (!asset) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Asset not found", mint }); return; }
        if (asset.type === 'nft') performTransaction("burn_asset", mint, () => burnNft(connection, walletHook, asset as Nft));
        else if (asset.type === 'cnft') performTransaction("burn_asset", mint, () => burnCNft(connection, walletHook, asset as CNft, rpcUrlRef.current));
        else if (asset.type === 'token') {
            if (typeof amount !== 'number' || amount <= 0) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "burn_asset", error: "Invalid amount for token burn", mint }); return; }
            performTransaction("burn_asset", mint, () => burnSplToken(connection, walletHook, asset as SplToken, amount));
        }
    };
    window.handleMintNFTRequest = (name: string, symbol: string, metadataUri: string) => {
      if (currentNetworkRef.current === 'mainnet-beta') {
        toast({ title: "Minting Disabled", description: "NFT minting disabled on Mainnet.", variant: "destructive" });
        sendToUnity("GameBridgeManager", "OnTransactionError", { action: "mint_nft", error: "Minting disabled on Mainnet" }); return;
      }
      performTransaction("mint_nft", name, () => mintStandardNft(connection, walletHook, metadataUri, name, symbol));
    };
    window.handleSwapTokensRequest = () => {
      const msg = "Token swapping is not yet implemented.";
      toast({ title: "Feature Unavailable", description: msg }); sendToUnity("GameBridgeManager", "OnTransactionError", { action: "swap_tokens", error: msg });
    };
    window.handleDepositFundsRequest = (tokenMintOrSol: string, amount: number) => {
        if (!CUSTODIAL_WALLET_ADDRESS) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Custodial address not set", tokenMint: tokenMintOrSol }); return; }
        if (amount <= 0) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Amount must be positive", tokenMint: tokenMintOrSol }); return; }
        if (tokenMintOrSol.toUpperCase() === "SOL") {
            performTransaction("deposit_funds", "SOL", () => depositSol(connection, walletHook, amount, CUSTODIAL_WALLET_ADDRESS));
        } else {
            const token = tokensRef.current.find(t => t.id === tokenMintOrSol);
            if (!token) { sendToUnity("GameBridgeManager", "OnTransactionError", { action: "deposit_funds", error: "Token not found for deposit", tokenMint: tokenMintOrSol }); return; }
            performTransaction("deposit_funds", tokenMintOrSol, () => depositSplToken(connection, walletHook, token, amount, CUSTODIAL_WALLET_ADDRESS));
        }
    };
    window.handleWithdrawFundsRequest = async (tokenMintOrSol: string, grossAmount: number) => {
      if (isSubmittingTransactionRef.current) { sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Transaction in progress", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
      if (!walletHook.publicKey) { sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Wallet not connected", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
      if (grossAmount <= 0) { sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: "Amount must be positive", action: "withdraw_funds", tokenMint: tokenMintOrSol }); return; }
      setIsSubmittingTransaction(true); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: true, tokenMint: tokenMintOrSol });
      try {
        let result: WithdrawalResponse;
        if (tokenMintOrSol.toUpperCase() === "SOL") result = await initiateWithdrawalRequest(walletHook.publicKey.toBase58(), grossAmount, currentNetworkRef.current);
        else {
          const token = allFetchedAssetsRef.current.find(a => a.id === tokenMintOrSol && a.type === 'token') as SplToken | undefined;
          if (!token) { throw new Error("Token details for withdrawal not found."); }
          result = await initiateWithdrawalRequest(walletHook.publicKey.toBase58(), grossAmount, currentNetworkRef.current, token);
        }
        if (result.success) toast({ title: "Withdrawal Processed", description: result.signature ? `Sig: ${result.signature.substring(0,10)}...` : result.message, action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> : undefined });
        else toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
        sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetworkRef.current) : undefined });
      } catch (error: any) { toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" }); sendToUnity("GameBridgeManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, action: "withdraw_funds", tokenMint: tokenMintOrSol });
      } finally { setIsSubmittingTransaction(false); sendToUnity("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); }
    };

    window.handleSetNetworkRequest = (network: SupportedSolanaNetwork) => {
        setCurrentNetwork(network);
        sendToUnity("GameBridgeManager", "OnNetworkChanged", { network });
    };
    window.handleGetCurrentNetworkRequest = () => {
        sendToUnity("GameBridgeManager", "OnCurrentNetworkReceived", { network: currentNetworkRef.current });
        return currentNetworkRef.current;
    };

    // Also set up direct connect wallet for Unity if it uses a DllImport to "callConnectWalletFromUnity"
    window.callConnectWalletFromUnity = window.handleConnectWalletRequest;

    // react-unity-webgl event listeners (these are for events sent FROM Unity via react-unity-webgl's system)
    // If your C# calls jslib which calls window.handle... above, these specific listeners might be redundant
    // unless react-unity-webgl automatically dispatches certain events or you configure Unity to do so.
    // For now, main communication from Unity will be via jslib -> window.handle...

    // Example: If Unity could directly send "UnityReady" via react-unity-webgl event system
    const handleUnityReady = () => {
      console.log("[Page RUW Listener] Unity sent 'UnityReady' event.");
      // This could be another place to signal Unity is fully interactive
    };
    addEventListener("UnityReady", handleUnityReady); // Example event name

    // Signal to Unity that the React bridge is ready IF Unity is already loaded
    if (isLoaded) {
      console.log("[Page RUW BridgeEffect] Unity already loaded. Signaling OnUnityReady to GameBridgeManager.");
      sendToUnity("GameBridgeManager", "OnUnityReady", {});
    }

    return () => {
      console.log("[Page RUW BridgeEffect] Cleaning up global handlers and react-unity-webgl event listeners.");
      // Clean up global functions
      delete window.handleConnectWalletRequest;
      delete window.handleIsWalletConnectedRequest;
      delete window.handleGetPublicKeyRequest;
      delete window.handleDisconnectWalletRequest;
      delete window.handleGetAvailableWalletsRequest;
      delete window.handleSelectWalletRequest;
      delete window.handleGetUserNFTsRequest;
      delete window.handleGetUserTokensRequest;
      delete window.handleGetSolBalanceRequest;
      delete window.handleTransferSOLRequest;
      delete window.handleTransferTokenRequest;
      delete window.handleTransferNFTRequest;
      delete window.handleBurnSOLRequest;
      delete window.handleBurnAssetRequest;
      delete window.handleMintNFTRequest;
      delete window.handleSwapTokensRequest;
      delete window.handleDepositFundsRequest;
      delete window.handleWithdrawFundsRequest;
      delete window.handleSetNetworkRequest;
      delete window.handleGetCurrentNetworkRequest;
      delete window.callConnectWalletFromUnity;

      removeEventListener("UnityReady", handleUnityReady); // Example
    };
  }, [
      isLoaded, walletHook, connection, walletModal, connectWalletAdapter, disconnectWalletAdapter, select, availableWallets,
      sendToUnity, toast, fetchSolBalanceInternal, debouncedLoadUserAssets, setCurrentNetwork,
      addEventListener, removeEventListener, // from useUnityContext
  ]);


  // Effect to send OnUnityReady once the game is loaded
  useEffect(() => {
    if (isLoaded) {
      console.log("[Page RUW] Unity game IS LOADED (isLoaded is true). Signaling OnUnityReady to GameBridgeManager.");
      sendToUnity("GameBridgeManager", "OnUnityReady", {});
    }
  }, [isLoaded, sendToUnity]);

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
        {!isLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-50">
             <div className="w-60 h-60 mb-4">
                <img
                     src={`/Build/${gameBaseNameOrDefault}_Logo.png`} // Assumes you have a logo in public/Build/
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
        )}
        <Unity
            unityProvider={unityProvider}
            className={`w-full h-full block ${!isLoaded ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}
            style={{ background: 'transparent' }}
            devicePixelRatio={window.devicePixelRatio} // Optional: for sharper rendering on high DPI screens
        />
      </main>
    </div>
  );
}
