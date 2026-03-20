
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { type WalletName, WalletReadyState } from "@solana/wallet-adapter-base";
import { PublicKey, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
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
  UNITY_PRODUCT_VERSION,
  getPublicRpcUrl
} from "@/config";
import { Skeleton } from "@/components/ui/skeleton";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Unity, useUnityContext } from "react-unity-webgl";
import placeholders from "@/app/lib/placeholder-images.json";

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
    handleSwapTokensRequest?: () => void;
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
    loaderUrl: `/game/Build/${gameProductNameOrDefault}.loader.js`,
    dataUrl: `/game/Build/${gameProductNameOrDefault}.data`,
    frameworkUrl: `/game/Build/${gameProductNameOrDefault}.framework.js`,
    codeUrl: `/game/Build/${gameProductNameOrDefault}.wasm`,
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
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);

  const nftsRef = useRef(nfts);
  const cnftsRef = useRef(cnfts);
  const tokensRef = useRef(tokens);
  const solBalanceRef = useRef(_solBalance);
  const allFetchedAssetsRef = useRef<Asset[]>([]);
  const isSubmittingTransactionRef = useRef(isSubmittingTransaction);
  const rpcUrlRef = useRef(rpcUrl);
  const currentNetworkRef = useRef(currentNetwork);
  const lastLoadedPkForAssetsRef = useRef<string | null>(null);
  
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
      } catch (e) {
        console.error(`[Page RUW] Error sending message to Unity: ${gameObjectName}.${methodName}`, e);
      }
    }
  }, [isLoaded, sendMessage]);


  const fetchSolBalanceInternal = useCallback(async (): Promise<number> => {
    const currentPk = walletHookRef.current.publicKey;
    if (currentPk && connection) {
      try {
        const balance = await connection.getBalance(currentPk);
        const sol = balance / LAMPORTS_PER_SOL;
        _setSolBalance(sol);
        if(isLoaded) sendToUnityGame("GameBridgeManager", "OnSolBalanceUpdated", { solBalance: sol });
        return sol;
      } catch (error: any) {
        console.warn(`[Page RUW] Primary RPC failed for getBalance. Attempting fallback.`);
        try {
          const backupRpcUrl = getPublicRpcUrl(currentNetworkRef.current);
          const backupConnection = new Connection(backupRpcUrl, 'confirmed');
          const balance = await backupConnection.getBalance(currentPk);
          const sol = balance / LAMPORTS_PER_SOL;
          _setSolBalance(sol);
          if(isLoaded) sendToUnityGame("GameBridgeManager", "OnSolBalanceUpdated", { solBalance: sol });
          return sol;
        } catch (backupError: any) {
          console.error("[Page RUW] Backup public RPC also failed for getBalance:", backupError);
          throw backupError;
        }
      }
    }
    return 0;
  }, [isLoaded, sendToUnityGame, connection]); 

  const resetLocalAssets = useCallback(() => {
    setNfts([]);
    setCnfts([]);
    setTokens([]);
    _setSolBalance(0);
    lastLoadedPkForAssetsRef.current = null; 
    setIsInitialLoadComplete(false);
  }, []);

  const loadUserAssetsInternal = useCallback(async () => {
    const currentPk = walletHookRef.current.publicKey;
    const currentRpc = rpcUrlRef.current; 

    if (!currentPk || !currentRpc || !connection || !isLoaded) {
      return;
    }
    
    if (lastLoadedPkForAssetsRef.current === currentPk.toBase58()) {
      return;
    }
    
    lastLoadedPkForAssetsRef.current = currentPk.toBase58();
    setIsLoadingAssets(true);
    sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: true });

    const [solResult, assetsResult] = await Promise.allSettled([
        fetchSolBalanceInternal(),
        fetchAssetsForOwner(currentPk.toBase58(), currentRpc, connection, walletHookRef.current)
    ]);

    let finalSolBalance = solBalanceRef.current;

    if (solResult.status === 'fulfilled') {
        finalSolBalance = solResult.value;
    }
    
    if (assetsResult.status === 'fulfilled') {
        const { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, heliusWarning } = assetsResult.value;

        if (heliusWarning) {
            toast({ title: "API Warning", description: heliusWarning, variant: "default" });
            sendToUnityGame("GameBridgeManager", "OnHeliusWarning", { warning: heliusWarning });
        }

        setNfts(fetchedNfts); 
        setCnfts(fetchedCnfts); 
        setTokens(fetchedTokens);
        
        sendToUnityGame("GameBridgeManager", "OnAssetsLoaded", { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, solBalance: finalSolBalance });

        if (walletHookRef.current.publicKey) {
          sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: walletHookRef.current.publicKey.toBase58() });
        }
    } else {
        const error = assetsResult.reason as any;
        console.error("[Page RUW] Failed to load NFTs and Tokens:", error);
        sendToUnityGame("GameBridgeManager", "OnAssetsLoadFailed", { error: error.message });
        setNfts([]);
        setCnfts([]);
        setTokens([]);
    }

    setIsLoadingAssets(false);
    sendToUnityGame("GameBridgeManager", "OnAssetsLoadingStateChanged", { isLoading: false });
    setIsInitialLoadComplete(true);

  }, [isLoaded, sendToUnityGame, toast, fetchSolBalanceInternal, connection]); 

  const debouncedLoadUserAssets = useMemo(() => debounce(loadUserAssetsInternal, 500), [loadUserAssetsInternal]);

  const prevConnectedForUnityRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    const { connected } = walletHookRef.current;
  
    if (!isClientMounted) { 
      return;
    }

    if (!connected) { 
      if (prevConnectedForUnityRef.current === true) {
        if (isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletDisconnected", {});
        resetLocalAssets(); 
      }
    }

    prevConnectedForUnityRef.current = connected;

  }, [walletHook.connected, isLoaded, sendToUnityGame, isClientMounted, resetLocalAssets]);
  
  const prevConnectedStateForRefreshRef = useRef<boolean>(walletHook.connected);
  const disconnectReloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const { connected } = walletHookRef.current;
    
    if (disconnectReloadTimeoutRef.current) {
        clearTimeout(disconnectReloadTimeoutRef.current);
        disconnectReloadTimeoutRef.current = null;
    }

    if (prevConnectedStateForRefreshRef.current === true && !connected) {
        disconnectReloadTimeoutRef.current = setTimeout(() => {
            window.location.reload();
        }, 500); 
    }
    
    prevConnectedStateForRefreshRef.current = connected;

  }, [walletHook.connected]); 

  useEffect(() => {
    if (isLoaded && walletHook.connected && walletHook.publicKey && !isLoadingAssets && !isSubmittingTransaction) {
      debouncedLoadUserAssets();
    }
  }, [isLoaded, walletHook.connected, walletHook.publicKey, isLoadingAssets, isSubmittingTransaction, debouncedLoadUserAssets]);


  const previousModalVisibilityRef = useRef(walletModal.visible);
  const previousSelectedWalletNameRef = useRef<string | null>(null);

  useEffect(() => {
      const { wallet, connected, connecting, connect: walletConnectAdapterHook } = walletHookRef.current;
      const currentSelectedWalletName = wallet?.adapter.name || null;

      if (previousModalVisibilityRef.current && !walletModal.visible) { 
          if (currentSelectedWalletName && !connected && !connecting) {
              walletConnectAdapterHook?.().catch((error: any) => {
                  console.error(`[Page RUW ModalCloseEffect] Auto-connection failed for ${currentSelectedWalletName}:`, error);
                  toast({ title: `Failed to connect ${currentSelectedWalletName}`, description: error.message, variant: "destructive" });
              });
          }
      }
      previousModalVisibilityRef.current = walletModal.visible;
      if (currentSelectedWalletName) { 
          previousSelectedWalletNameRef.current = currentSelectedWalletName;
      } else if (!connected) { 
          previousSelectedWalletNameRef.current = null;
      }
  }, [walletModal.visible, walletHook.wallet, walletHook.connected, walletHook.connecting, walletConnect, toast, sendToUnityGame, isLoaded, select]);


  const memoizedHandleConnectWalletRequest = useCallback(async (walletNameFromUnity?: string) => {
    const { select: selectWalletFromHook, wallet, connect: walletConnectAdapter, connected, connecting } = walletHookRef.current;
    const currentAvailableWallets = walletHookRef.current.wallets; 

    if (connected) {
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnected", { publicKey: walletHookRef.current.publicKey?.toBase58() });
      return;
    }
    if (connecting) {
      return;
    }

    if (walletNameFromUnity) {
      const targetAdapter = currentAvailableWallets.find(w => w.adapter.name === walletNameFromUnity)?.adapter;
      if (targetAdapter) {
        if (targetAdapter.readyState === WalletReadyState.Installed || targetAdapter.readyState === WalletReadyState.Loadable) {
          if (wallet?.adapter.name !== targetAdapter.name) {
            selectWalletFromHook(targetAdapter.name as WalletName);
            await new Promise(resolve => setTimeout(resolve, 150)); 
          }
          const newlySelectedWalletHook = walletHookRef.current;
          if (newlySelectedWalletHook.wallet?.adapter.name === targetAdapter.name && !newlySelectedWalletHook.connected && !newlySelectedWalletHook.connecting) {
            newlySelectedWalletHook.connect?.().catch(error => {
              console.error(`[Page RUW GlobalCB] ConnectWalletRequest: Connection failed for ${targetAdapter.name}:`, error);
              toast({ title: `Failed to connect ${targetAdapter.name}`, description: error.message, variant: "destructive" });
            });
          } 
          return;
        } else {
          selectWalletFromHook(null); 
          walletModal.setVisible(true); return;
        }
      } else {
        selectWalletFromHook(null); walletModal.setVisible(true); return;
      }
    } else {
        const currentSelectedWalletAdapter = walletHookRef.current.wallet?.adapter;
        if (currentSelectedWalletAdapter && (currentSelectedWalletAdapter.readyState === WalletReadyState.Installed || currentSelectedWalletAdapter.readyState === WalletReadyState.Loadable) && !connected && !connecting) {
          walletConnectAdapter?.().catch(error => {
              console.error(`[Page RUW GlobalCB] ConnectWalletRequest: Connection failed for ${currentSelectedWalletAdapter.name}:`, error);
              toast({ title: `Failed to connect ${currentSelectedWalletAdapter.name}`, description: error.message, variant: "destructive" });
          });
        } else { 
           selectWalletFromHook(null); 
           walletModal.setVisible(true);
        }
    }
  }, [toast, walletModal, sendToUnityGame, isLoaded]); 

  const memoizedHandleIsWalletConnectedRequest = useCallback(() => {
    const currentlyConnected = walletHookRef.current.connected;
    const pk = walletHookRef.current.publicKey?.toBase58() || null;
    if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletConnectionStatus", { isConnected: currentlyConnected, publicKey: pk });
    return currentlyConnected;
  }, [sendToUnityGame, isLoaded]);

  const memoizedHandleGetPublicKeyRequest = useCallback(() => {
    const pk = walletHookRef.current.publicKey?.toBase58() || null;
    if(isLoaded) sendToUnityGame("GameBridgeManager", "OnPublicKeyReceived", { publicKey: pk });
    return pk;
  }, [sendToUnityGame, isLoaded]);

  const memoizedHandleDisconnectWalletRequest = useCallback(async () => {
    try {
      await walletHookRef.current.disconnect();
    } catch (error: any) {
      toast({ title: "Wallet Disconnect Error", description: error.message, variant: "destructive" });
    }
  }, [sendToUnityGame, toast, isLoaded]);

  const memoizedHandleGetAvailableWalletsRequest = useCallback(() => {
    const currentAvailableWallets = walletHookRef.current.wallets;
    const available = currentAvailableWallets.map(w => ({ name: w.adapter.name, icon: w.adapter.icon, readyState: w.adapter.readyState }));
    if(isLoaded) sendToUnityGame("GameBridgeManager", "OnAvailableWalletsReceived", { wallets: available });
    return available;
  }, [sendToUnityGame, isLoaded]);

  const memoizedHandleSelectWalletRequest = useCallback(async (walletName: string) => {
    const { select: reactSelectWallet, wallets: currentWallets } = walletHookRef.current; 
    try {
      const targetWallet = currentWallets.find(w => w.adapter.name === walletName);
      if (!targetWallet) { throw new Error(`Wallet ${walletName} not available.`); }
      reactSelectWallet(walletName as WalletName); 
      if(isLoaded) sendToUnityGame("GameBridgeManager", "OnWalletSelectAttempted", { walletName });
    } catch (error: any) {
      toast({ title: "Wallet Selection Error", description: error.message, variant: "destructive" });
    }
  }, [sendToUnityGame, toast, isLoaded]);

  const memoizedHandleGetUserNFTsRequest = useCallback(async () => {
    if (!walletHookRef.current.publicKey || !connection) { return; }
    if (isLoaded) sendToUnityGame("GameBridgeManager", "OnUserNFTsRequested", { nfts: nftsRef.current, cnfts: cnftsRef.current });
  }, [connection, sendToUnityGame, isLoaded]);

  const memoizedHandleGetUserTokensRequest = useCallback(async () => {
    if (!walletHookRef.current.publicKey || !connection) { return; }
    if (isLoaded) sendToUnityGame("GameBridgeManager", "OnUserTokensRequested", { tokens: tokensRef.current, solBalance: solBalanceRef.current });
  }, [connection, sendToUnityGame, isLoaded]);
  
  const memoizedHandleGetSolBalanceRequest = useCallback(async () => {
    if(isLoaded) sendToUnityGame("GameBridgeManager", "OnSolBalanceUpdated", { solBalance: solBalanceRef.current });
    return solBalanceRef.current;
  }, [isLoaded, sendToUnityGame]);

  const performTransaction = useCallback(async (actionName: string, mint: string | null, transactionFn: () => Promise<string>, reloadAssets: boolean = true) => {
    if (isSubmittingTransactionRef.current) { return; }
    if (!walletHookRef.current.publicKey || !walletHookRef.current.sendTransaction || !connection) { return; }
    setIsSubmittingTransaction(true); 
    if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: actionName, submitting: true, mint });
    try {
      const signature = await transactionFn();
      toast({ title: `${actionName.replace(/_/g, ' ')} Initiated`, description: `Sig: ${signature.substring(0,10)}...`, action: <a href={getTransactionExplorerUrl(signature, currentNetworkRef.current)} target="_blank" rel="noopener noreferrer">View</a> });
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionSubmitted", { action: actionName, signature, mint, explorerUrl: getTransactionExplorerUrl(signature, currentNetworkRef.current) });
      if (reloadAssets) { 
          debouncedLoadUserAssets(); 
      } else if (actionName === 'transfer_sol' || actionName === 'burn_sol' || actionName === 'deposit_sol') {
          fetchSolBalanceInternal(); 
      }
    } catch (error: any) { 
      toast({ title: `${actionName.replace(/_/g, ' ')} Failed`, description: error.message, variant: "destructive" }); 
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionError", { action: actionName, error: error.message, mint });
    } finally { 
      setIsSubmittingTransaction(false); 
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: actionName, submitting: false, mint }); 
    }
  }, [connection, toast, debouncedLoadUserAssets, fetchSolBalanceInternal, currentNetworkRef, sendToUnityGame, isLoaded]);

  const memoizedHandleTransferSOLRequest = useCallback((amountSol: number, toAddress: string) => {
      if (amountSol <= 0) return;
      const recipientPublicKey = new PublicKey(toAddress);
      performTransaction("transfer_sol", null, () => transferSol(connection, walletHookRef.current, recipientPublicKey, amountSol), false);
  }, [connection, performTransaction]);

  const memoizedHandleTransferTokenRequest = useCallback((mint: string, amount: number, toAddress: string) => {
      const token = tokensRef.current.find(t => t.id === mint);
      if (!token || amount <= 0) return;
      const recipientPublicKey = new PublicKey(toAddress);
      performTransaction("transfer_token", mint, () => transferSplToken(connection, walletHookRef.current, token, recipientPublicKey, amount));
  }, [connection, performTransaction, tokensRef]);

  const memoizedHandleTransferNFTRequest = useCallback((mint: string, toAddress: string) => {
      const asset = allFetchedAssetsRef.current.find(a => a.id === mint && (a.type === 'nft' || a.type === 'cnft'));
      if (!asset) return;
      const recipientPublicKey = new PublicKey(toAddress);
      if (asset.type === 'nft') performTransaction("transfer_nft", mint, () => transferNft(connection, walletHookRef.current, asset as Nft, recipientPublicKey));
      else if (asset.type === 'cnft') performTransaction("transfer_nft", mint, () => transferCNft(connection, walletHookRef.current, asset as Cnft, recipientPublicKey, rpcUrlRef.current));
  }, [connection, performTransaction, allFetchedAssetsRef, rpcUrlRef]);

   const memoizedHandleBurnSOLRequest = useCallback((amountSol: number) => {
      if (amountSol <= 0) return;
      performTransaction("burn_sol", null, () => burnSol(connection, walletHookRef.current, amountSol), false);
  }, [connection, performTransaction]);

  const memoizedHandleBurnAssetRequest = useCallback((mint: string, amount?: number) => {
      const asset = allFetchedAssetsRef.current.find(a => a.id === mint);
      if (!asset) return;
      if (asset.type === 'nft') performTransaction("burn_asset", mint, () => burnNft(connection, walletHookRef.current, asset as Nft));
      else if (asset.type === 'cnft') performTransaction("burn_asset", mint, () => burnCNft(connection, walletHookRef.current, asset as Cnft, rpcUrlRef.current));
      else if (asset.type === 'token') {
          if (typeof amount !== 'number' || amount <= 0) return;
          performTransaction("burn_asset", mint, () => burnSplToken(connection, walletHookRef.current, asset as SplToken, amount));
      }
  }, [connection, performTransaction, allFetchedAssetsRef, rpcUrlRef]);

  const memoizedHandleMintNFTRequest = useCallback((name: string, symbol: string, metadataUri: string) => {
    if (currentNetworkRef.current === 'mainnet-beta') {
      toast({ title: "Minting Disabled", description: "NFT minting disabled on Mainnet.", variant: "destructive" });
      return;
    }
    performTransaction("mint_nft", name, () => mintStandardNft(connection, walletHookRef.current, metadataUri, name, symbol));
  }, [toast, connection, performTransaction, currentNetworkRef]);

  const memoizedHandleSwapTokensRequest = useCallback(() => {
    toast({ title: "Feature Unavailable", description: "Token swapping is not yet implemented." });
  }, [toast]);

  const memoizedHandleDepositFundsRequest = useCallback((tokenMintOrSol: string, amount: number) => {
      if (!CUSTODIAL_WALLET_ADDRESS || amount <= 0) return;
      if (tokenMintOrSol.toUpperCase() === "SOL") {
          performTransaction("deposit_funds", "SOL", () => depositSol(connection, walletHookRef.current, amount, CUSTODIAL_WALLET_ADDRESS), false);
      } else {
          const token = tokensRef.current.find(t => t.id === tokenMintOrSol);
          if (!token) return;
          performTransaction("deposit_funds", tokenMintOrSol, () => depositSplToken(connection, walletHookRef.current, token, amount, CUSTODIAL_WALLET_ADDRESS));
      }
  }, [connection, performTransaction, tokensRef]);

  const memoizedHandleWithdrawFundsRequest = useCallback(async (tokenMintOrSol: string, grossAmount: number) => {
    if (isSubmittingTransactionRef.current || !walletHookRef.current.publicKey || grossAmount <= 0) return;
    setIsSubmittingTransaction(true); 
    if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: true, tokenMint: tokenMintOrSol });
    try {
      let result: WithdrawalResponse;
      if (tokenMintOrSol.toUpperCase() === "SOL") result = await initiateWithdrawalRequest(walletHookRef.current.publicKey.toBase58(), grossAmount, currentNetworkRef.current);
      else {
        const token = allFetchedAssetsRef.current.find(a => a.id === tokenMintOrSol && a.type === 'token') as SplToken | undefined;
        if (!token) throw new Error("Token details for withdrawal not found.");
        result = await initiateWithdrawalRequest(walletHookRef.current.publicKey.toBase58(), grossAmount, currentNetworkRef.current, token);
      }
      if (result.success) {
        toast({ title: "Withdrawal Processed", description: result.signature ? `Sig: ${result.signature.substring(0,10)}...` : result.message });
        fetchSolBalanceInternal(); 
      } else {
        toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
      }
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnWithdrawalResponse", { ...result, action: "withdraw_funds", tokenMint: tokenMintOrSol });
    } catch (error: any) { 
      toast({ title: "Withdrawal Request Error", description: error.message, variant: "destructive" }); 
    } finally { 
      setIsSubmittingTransaction(false); 
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnTransactionSubmitting", { action: "withdraw_funds", submitting: false, tokenMint: tokenMintOrSol }); 
    }
  }, [toast, fetchSolBalanceInternal, currentNetworkRef, allFetchedAssetsRef, sendToUnityGame, isLoaded]);
  
  const memoizedHandleSetNetworkRequest = useCallback((network: SupportedSolanaNetwork) => {
      setCurrentNetwork(network); 
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnNetworkChanged", { network });
  }, [setCurrentNetwork, sendToUnityGame, isLoaded]);
  
  const memoizedHandleGetCurrentNetworkRequest = useCallback(() => {
      if (isLoaded) sendToUnityGame("GameBridgeManager", "OnCurrentNetworkReceived", { network: currentNetworkRef.current });
      return currentNetworkRef.current;
  }, [currentNetworkRef, sendToUnityGame, isLoaded]);

  const memoizedHandleGameBridgeManagerReady = useCallback(() => {
    console.log("[Page RUW] GameBridgeManagerReady");
  }, []);


  const memoizedHandleUnityError = useCallback((error: Error | string) => { 
    const errorMessage = typeof error === 'string' ? error : error.message;
    toast({
      title: "Unity Engine Error",
      description: errorMessage,
      variant: "destructive",
      duration: 10000,
    });
  }, [toast]);

  const memoizedHandleUnityLoaded = useCallback(() => {
      if(isClientMounted) sendToUnityGame("GameBridgeManager", "OnUnityReady", {});
  }, [isClientMounted, sendToUnityGame]);


  useEffect(() => {
    if (!isClientMounted) return;
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
    
    return () => {
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
    };
  }, [
      isClientMounted, 
      memoizedHandleConnectWalletRequest, memoizedHandleIsWalletConnectedRequest, memoizedHandleGetPublicKeyRequest,
      memoizedHandleDisconnectWalletRequest, memoizedHandleGetAvailableWalletsRequest, memoizedHandleSelectWalletRequest,
      memoizedHandleGetUserNFTsRequest, memoizedHandleGetUserTokensRequest, memoizedHandleGetSolBalanceRequest,
      memoizedHandleTransferSOLRequest, memoizedHandleTransferTokenRequest, memoizedHandleTransferNFTRequest,
      memoizedHandleBurnSOLRequest, memoizedHandleBurnAssetRequest, memoizedHandleMintNFTRequest,
      memoizedHandleSwapTokensRequest, memoizedHandleDepositFundsRequest, memoizedHandleWithdrawFundsRequest,
      memoizedHandleSetNetworkRequest, memoizedHandleGetCurrentNetworkRequest
  ]);

  useEffect(() => {
    if (!isClientMounted || !isLoaded || !addEventListener || !removeEventListener) return;
    addEventListener("OnGameBridgeManagerReady", memoizedHandleGameBridgeManagerReady);
    addEventListener("error", memoizedHandleUnityError);
    addEventListener("loaded", memoizedHandleUnityLoaded);

    return () => {
      if(removeEventListener) {
        removeEventListener("OnGameBridgeManagerReady", memoizedHandleGameBridgeManagerReady);
        removeEventListener("error", memoizedHandleUnityError);
        removeEventListener("loaded", memoizedHandleUnityLoaded);
      }
    };
  }, [
    isClientMounted, isLoaded, 
    addEventListener, removeEventListener, 
    memoizedHandleGameBridgeManagerReady, memoizedHandleUnityError, memoizedHandleUnityLoaded
  ]);


  useEffect(() => {
    return () => {
      if (isLoaded && detachAndUnload) { 
        detachAndUnload().catch(error => {
          console.error("[Page RUW] Unload error:", error);
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
                src={placeholders.logo.src}
                alt={placeholders.logo.alt}
                width={placeholders.logo.width} 
                height={placeholders.logo.height} 
                className="object-contain"
                data-ai-hint="game logo"
                priority
              />
            )}
          </div>
          <div className="flex-1 flex justify-end">
            <ConnectWalletButton />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full relative overflow-hidden p-0 m-0">
        {!isClientMounted ? ( 
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-50">
                <p className="text-lg text-foreground">Initializing Game Engine...</p>
            </div>
        ) : !isLoaded ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-50">
             <div className="w-60 h-60 mb-4">
                <Image
                     src={placeholders.loadingLogo.src}
                     alt={placeholders.loadingLogo.alt}
                     width={placeholders.loadingLogo.width}
                     height={placeholders.loadingLogo.height}
                     className="object-contain"
                     data-ai-hint="phoenix fire"
                     priority
                />
             </div>
             <p className="text-lg text-foreground mt-4">
                Loading Game: {loadingPercentage}%
             </p>
             <div className="w-1/2 max-w-md mt-2 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-150" style={{ width: `${loadingPercentage}%`}}></div>
             </div>
             <p className="text-xs text-muted-foreground mt-2 px-4 text-center">Hang tight — it might take a bit longer to load if it is the first time.</p>
          </div>
        ) : (
          <div className="w-full h-full relative">
            <Image 
              src={placeholders.gamePlaceholder.src}
              alt={placeholders.gamePlaceholder.alt}
              fill
              className="object-cover"
              data-ai-hint="game screenshot"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="bg-card p-8 rounded-xl shadow-2xl border border-border text-center max-w-lg">
                <h2 className="text-3xl font-bold mb-4">Game Prototype Active</h2>
                <p className="text-muted-foreground mb-6">This is a placeholder for your Unity WebGL build. Once your build is ready, it will replace this screen.</p>
                <div className="flex flex-col items-center gap-2">
                   <div className="text-sm font-mono bg-muted p-2 rounded">
                      Network: {currentNetwork}
                   </div>
                   {walletHook.connected && (
                     <div className="text-sm text-green-500 font-semibold">
                       Wallet Connected: {walletHook.publicKey?.toBase58().substring(0,8)}...
                     </div>
                   )}
                </div>
              </div>
            </div>
            {/* Keeping the Unity component hidden but initialized to avoid breaking logic if needed, 
                though in a pure visual placeholder mode you'd usually swap it entirely */}
            <div className="hidden">
              <Unity
                id="react-unity-webgl-canvas" 
                unityProvider={unityProvider}
                devicePixelRatio={currentDevicePixelRatio} 
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
