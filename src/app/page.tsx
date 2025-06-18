
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import dynamic from "next/dynamic";
import { fetchAssetsForOwner } from "@/lib/asset-loader";
import type { Asset, Nft, CNft, SplToken } from "@/types/solana";
import { AssetDropdown } from "@/components/AssetDropdown";
import { AssetCard } from "@/components/AssetCard";
import { AssetDisplay } from "@/components/AssetDisplay";
import { TransferModal } from "@/components/TransferModal";
import { BurnModal } from "@/components/BurnModal";
import { DepositModal } from "@/components/DepositModal";
import { WithdrawModal } from "@/components/WithdrawModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getTransactionExplorerUrl, getAddressExplorerUrl } from "@/utils/explorer";
import {
  transferNft, transferSplToken, burnNft, burnSplToken,
  transferCNft, burnCNft, depositSplToken, initiateWithdrawalRequest,
  transferSol, depositSol, burnSol, type WithdrawalResponse
} from "@/lib/solana/transactions";
import { RefreshCw, Package, PackageSearch, CoinsIcon } from "lucide-react";
import { useNetwork } from "@/contexts/NetworkContext";
import type { SupportedSolanaNetwork } from "@/config";
import { NetworkSwitcher } from "@/components/NetworkSwitcher";
import { CUSTODIAL_WALLET_ADDRESS, SOL_DECIMALS } from "@/config";

const ConnectWalletButton = dynamic(
  () => import("@/components/ConnectWalletButton").then((mod) => mod.ConnectWalletButton),
  {
    ssr: false,
    loading: () => <Skeleton className="h-10 w-32 rounded-md" />
  }
);

export default function HomePage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, sendTransaction, connected, connect: connectWalletAdapter, disconnect: disconnectWalletAdapter, select } = wallet;
  const { toast } = useToast();
  const { currentNetwork, setCurrentNetwork, rpcUrl } = useNetwork();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [nfts, setNfts] = useState<Nft[]>([]);
  const [cnfts, setCnfts] = useState<CNft[]>([]);
  const [tokens, setTokens] = useState<SplToken[]>([]);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isBurnModalOpen, setIsBurnModalOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);

  const allFetchedAssets = useMemo(() => [...nfts, ...cnfts, ...tokens], [nfts, cnfts, tokens]);
  const selectedAsset = useMemo(() => allFetchedAssets.find(a => a.id === selectedAssetId) || null, [selectedAssetId, allFetchedAssets]);

  const sendToUnity = useCallback((objectName: string, methodName: string, message: any) => {
    if (iframeRef.current && iframeRef.current.contentWindow && (iframeRef.current.contentWindow as any).UnityGame?.SendMessage) {
      console.log(`[UnityBridge] Sending to Unity (iframe): ${objectName}.${methodName}`, message);
      (iframeRef.current.contentWindow as any).UnityGame.SendMessage(objectName, methodName, JSON.stringify(message));
    } else {
      console.warn(`[UnityBridge] UnityGame.SendMessage not found in iframe or iframe not ready. Message for ${objectName}.${methodName} not sent.`, message);
    }
  }, [iframeRef]);


  const fetchSolBalance = useCallback(async () => {
    if (publicKey && connection) {
      try {
        const balance = await connection.getBalance(publicKey);
        const sol = balance / LAMPORTS_PER_SOL;
        setSolBalance(sol);
        sendToUnity("SolBlazeManager", "OnSolBalanceUpdated", { solBalance: sol });
        return sol;
      } catch (error: any) {
        console.error("Failed to fetch SOL balance:", error);
        toast({ title: "Error Fetching SOL Balance", description: error.message, variant: "destructive" });
        sendToUnity("SolBlazeManager", "OnSolBalanceUpdateFailed", { error: error.message });
        return 0;
      }
    }
    return 0;
  }, [publicKey, connection, sendToUnity, toast]);

  const loadAssets = useCallback(async () => {
    if (!publicKey || !rpcUrl || !connection || !wallet) {
      setNfts([]);
      setCnfts([]);
      setTokens([]);
      setSolBalance(0);
      setSelectedAssetId(null);
      sendToUnity("SolBlazeManager", "OnAssetsLoaded", { nfts: [], cnfts: [], tokens: [], solBalance: 0 });
      return;
    }
    setIsLoadingAssets(true);
    sendToUnity("SolBlazeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
    setSelectedAssetId(null);
    sendToUnity("SolBlazeManager", "OnAssetSelected", { asset: null });
    try {
      const [fetchedSolBalance, { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, heliusWarning }] = await Promise.all([
        fetchSolBalance(),
        fetchAssetsForOwner(publicKey.toBase58(), rpcUrl, connection, wallet)
      ]);

      if (heliusWarning) {
        const isApiKeyError = heliusWarning.toLowerCase().includes("access forbidden") || heliusWarning.toLowerCase().includes("api key");
        const toastVariant = isApiKeyError ? "destructive" : "default";
        toast({
          title: "API Warning",
          description: heliusWarning,
          variant: toastVariant,
        });
        sendToUnity("SolBlazeManager", "OnHeliusWarning", { warning: heliusWarning, isError: isApiKeyError });
      }

      setNfts(fetchedNfts);
      setCnfts(fetchedCnfts);
      setTokens(fetchedTokens);
      // SOL balance is set by fetchSolBalance and sent to Unity there

      sendToUnity("SolBlazeManager", "OnAssetsLoaded", { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, solBalance: fetchedSolBalance });

      if (!heliusWarning) {
        toast({ title: "Asset Scan Complete", description: `Found ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs, ${fetchedTokens.length} Tokens, and ${fetchedSolBalance.toFixed(SOL_DECIMALS)} SOL on ${currentNetwork}.` });
      }
    } catch (error: any) {
      console.error("Failed to load assets:", error);
      toast({ title: "Error Loading Assets", description: error.message, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnAssetsLoadFailed", { error: error.message });
      setNfts([]); setCnfts([]); setTokens([]); setSolBalance(0);
      sendToUnity("SolBlazeManager", "OnAssetsLoaded", { nfts: [], cnfts: [], tokens: [], solBalance: 0 });
    } finally {
      setIsLoadingAssets(false);
      sendToUnity("SolBlazeManager", "OnAssetsLoadingStateChanged", { isLoading: false });
    }
  }, [publicKey, rpcUrl, connection, wallet, toast, currentNetwork, sendToUnity, fetchSolBalance]);

  useEffect(() => {
    if (connected && publicKey) {
      sendToUnity("SolBlazeManager", "OnWalletConnected", { publicKey: publicKey.toBase58() });
      loadAssets();
    } else {
      sendToUnity("SolBlazeManager", "OnWalletDisconnected", {});
      setNfts([]);
      setCnfts([]);
      setTokens([]);
      setSolBalance(0);
      setSelectedAssetId(null);
    }
  }, [connected, publicKey, loadAssets, currentNetwork, sendToUnity]);


  const handleConfirmTransfer = useCallback(async (recipientAddress: string, amount?: number) => {
    if (isSubmittingTransaction) {
      const msg = "Another transaction is already being processed.";
      toast({ title: "In Progress", description: msg, variant: "default" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "transfer_asset", error: msg });
      return Promise.reject(new Error(msg));
    }
    if (!selectedAsset || !publicKey || !sendTransaction) {
      const msg = "Wallet not connected or no asset selected for transfer.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "transfer_asset", error: msg });
      return Promise.reject(new Error(msg));
    }

    setIsSubmittingTransaction(true);
    sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "transfer_asset", submitting: true });
    let signature: string | undefined;
    try {
      const recipientPublicKey = new PublicKey(recipientAddress);
      if (selectedAsset.type === "nft") {
        signature = await transferNft(connection, wallet, selectedAsset as Nft, recipientPublicKey);
      } else if (selectedAsset.type === "cnft") {
         signature = await transferCNft(connection, wallet, selectedAsset as CNft, recipientPublicKey, rpcUrl);
      } else if (selectedAsset.type === "token") {
        if (typeof amount !== 'number' || amount <= 0) {
          const msg = "Invalid amount for token transfer.";
          toast({ title: "Error", description: msg, variant: "destructive" });
          setIsSubmittingTransaction(false);
          sendToUnity("SolBlazeManager", "OnTransactionError", { action: "transfer_asset", error: msg });
          return Promise.reject(new Error(msg));
        }
        signature = await transferSplToken(connection, wallet, selectedAsset as SplToken, recipientPublicKey, amount);
      }

      if (signature) {
        toast({
          title: "Asset Transfer Initiated",
          description: `Transaction signature: ${signature}`,
          action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View on Explorer</a>,
        });
        sendToUnity("SolBlazeManager", "OnTransactionSubmitted", { action: "transfer_asset", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
        setIsTransferModalOpen(false);
        loadAssets();
        return Promise.resolve({signature});
      }
      return Promise.reject(new Error("Asset transfer signature was not obtained."));
    } catch (error: any) {
      console.error("Asset transfer failed:", error);
      toast({ title: "Asset Transfer Failed", description: error.message, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "transfer_asset", error: error.message });
      return Promise.reject(error);
    } finally {
      setIsSubmittingTransaction(false);
      sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "transfer_asset", submitting: false });
    }
  }, [selectedAsset, publicKey, sendTransaction, connection, wallet, toast, loadAssets, currentNetwork, rpcUrl, isSubmittingTransaction, sendToUnity]);

  const handleConfirmBurn = useCallback(async (amount?: number) => {
    if (isSubmittingTransaction) {
      const msg = "Another transaction is already being processed.";
      toast({ title: "In Progress", description: msg, variant: "default" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "burn_asset", error: msg });
      return Promise.reject(new Error(msg));
    }
    if (!selectedAsset || !publicKey || !sendTransaction) {
      const msg = "Wallet not connected or no asset selected for burn.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "burn_asset", error: msg });
      return Promise.reject(new Error(msg));
    }

    setIsSubmittingTransaction(true);
    sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: true });
    let signature: string | undefined;
    try {
      if (selectedAsset.type === "nft") {
        signature = await burnNft(connection, wallet, selectedAsset as Nft);
      } else if (selectedAsset.type === "cnft") {
         signature = await burnCNft(connection, wallet, selectedAsset as CNft, rpcUrl);
      } else if (selectedAsset.type === "token") {
        if (typeof amount !== 'number' || amount <= 0) {
          const msg = "Invalid amount for token burn.";
          toast({ title: "Error", description: msg, variant: "destructive" });
          setIsSubmittingTransaction(false);
          sendToUnity("SolBlazeManager", "OnTransactionError", { action: "burn_asset", error: msg });
          return Promise.reject(new Error(msg));
        }
        signature = await burnSplToken(connection, wallet, selectedAsset as SplToken, amount);
      }

      if (signature) {
        toast({
          title: "Asset Burn Initiated",
          description: `Transaction signature: ${signature}`,
          action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View on Explorer</a>,
        });
        sendToUnity("SolBlazeManager", "OnTransactionSubmitted", { action: "burn_asset", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
        setIsBurnModalOpen(false);
        loadAssets();
        return Promise.resolve({signature});
      }
      return Promise.reject(new Error("Asset burn signature was not obtained."));
    } catch (error: any) {
      console.error("Asset burn failed:", error);
      toast({ title: "Asset Burn Failed", description: error.message, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "burn_asset", error: error.message });
      return Promise.reject(error);
    } finally {
      setIsSubmittingTransaction(false);
      sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "burn_asset", submitting: false });
    }
  }, [selectedAsset, publicKey, sendTransaction, connection, wallet, toast, loadAssets, currentNetwork, rpcUrl, isSubmittingTransaction, sendToUnity]);

  const handleConfirmDeposit = useCallback(async (amount: number) => {
    if (isSubmittingTransaction) {
      const msg = "Another transaction is already being processed.";
      toast({ title: "In Progress", description: msg, variant: "default" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "deposit_token", error: msg });
      return Promise.reject(new Error(msg));
    }
    if (selectedAsset?.type !== "token" || !publicKey || !CUSTODIAL_WALLET_ADDRESS) {
      const msg = "Wallet not connected, no token selected, or custodial address not configured for deposit.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "deposit_token", error: msg });
      return Promise.reject(new Error(msg));
    }
    if (amount <= 0) {
      const msg = "Invalid deposit amount.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "deposit_token", error: msg });
      return Promise.reject(new Error(msg));
    }

    setIsSubmittingTransaction(true);
    sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "deposit_token", submitting: true });
    try {
      const signature = await depositSplToken(connection, wallet, selectedAsset as SplToken, amount, CUSTODIAL_WALLET_ADDRESS);
      toast({
        title: "Token Deposit Initiated",
        description: `Transaction signature: ${signature}`,
        action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View on Explorer</a>,
      });
      sendToUnity("SolBlazeManager", "OnTransactionSubmitted", { action: "deposit_token", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
      setIsDepositModalOpen(false);
      loadAssets();
      return Promise.resolve({signature});
    } catch (error: any) {
      console.error("Token deposit failed:", error);
      toast({ title: "Token Deposit Failed", description: error.message, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "deposit_token", error: error.message });
      return Promise.reject(error);
    } finally {
      setIsSubmittingTransaction(false);
      sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "deposit_token", submitting: false });
    }
  }, [selectedAsset, publicKey, connection, wallet, toast, loadAssets, currentNetwork, isSubmittingTransaction, sendToUnity]);

  const handleRequestWithdrawal = useCallback(async (_grossAmount: number, netAmount: number) => {
    if (isSubmittingTransaction) {
      const msg = "Another transaction is already being processed.";
      toast({ title: "In Progress", description: msg, variant: "default" });
      sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { success: false, message: msg, error: msg, type: 'token' });
      return Promise.reject(new Error(msg));
    }
     if (selectedAsset?.type !== "token" || !publicKey) {
      const msg = "Wallet not connected or no token selected for withdrawal.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { success: false, message: msg, error: msg, type: 'token' });
      return Promise.reject(new Error(msg));
    }
    if (netAmount <= 0) {
      const msg = "Invalid withdrawal amount (net amount must be positive).";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { success: false, message: msg, error: msg, type: 'token' });
      return Promise.reject(new Error(msg));
    }

    setIsSubmittingTransaction(true);
    sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "withdraw_token", submitting: true });
    try {
      const result: WithdrawalResponse = await initiateWithdrawalRequest(
        publicKey.toBase58(),
        netAmount, // This is token units
        currentNetwork,
        selectedAsset as SplToken // Pass the token
      );

      if (result.success) {
        toast({
          title: "Token Withdrawal Processed",
          description: result.signature ? `Transaction Signature: ${result.signature}` : result.message,
          action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetwork)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View on Explorer</a> : undefined,
        });
        sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { ...result, type: 'token', explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetwork) : undefined });
        setIsWithdrawModalOpen(false);
        return Promise.resolve(result);
      } else {
        toast({ title: "Token Withdrawal Failed", description: result.message, variant: "destructive" });
        sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { ...result, type: 'token', error: result.message });
        return Promise.reject(new Error(result.message));
      }
    } catch (error: any) {
      console.error("Token withdrawal request failed:", error);
      const msg = error.message || "Token withdrawal request error.";
      toast({ title: "Token Withdrawal Request Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { success: false, message: msg, error: msg, type: 'token' });
      return Promise.reject(error);
    } finally {
      setIsSubmittingTransaction(false);
      sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "withdraw_token", submitting: false });
    }
  }, [selectedAsset, publicKey, toast, currentNetwork, isSubmittingTransaction, sendToUnity]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).unityBridge = {
        connectWallet: async () => {
          try {
            if (!connected) {
              if (wallet.wallets.length > 0 && !wallet.wallet) {
                 select(wallet.wallets[0].adapter.name);
              }
              await connectWalletAdapter();
            }
            return Promise.resolve({ connected: wallet.connected, publicKey: wallet.publicKey?.toBase58() || null });
          } catch (error: any) {
            sendToUnity("SolBlazeManager", "OnWalletConnectionError", { error: error.message });
            return Promise.reject(error);
          }
        },
        disconnectWallet: async () => {
          try {
            await disconnectWalletAdapter();
            sendToUnity("SolBlazeManager", "OnWalletDisconnected", {});
            return Promise.resolve();
          } catch (error: any) {
            sendToUnity("SolBlazeManager", "OnWalletConnectionError", { error: error.message });
            return Promise.reject(error);
          }
        },
        getWalletState: () => ({
          connected: connected,
          publicKey: publicKey?.toBase58() || null,
          network: currentNetwork,
        }),
        loadAssets: () => {
          loadAssets();
          return Promise.resolve();
        },
        getAssets: () => ({
          nfts,
          cnfts,
          tokens,
          solBalance
        }),
        getSolBalance: async () => {
            const balance = await fetchSolBalance();
            return Promise.resolve(balance);
        },
        selectAsset: (assetId: string | null) => {
          setSelectedAssetId(assetId);
          const newSelectedAsset = allFetchedAssets.find(a => a.id === assetId) || null;
          sendToUnity("SolBlazeManager", "OnAssetSelected", { asset: newSelectedAsset });
          return Promise.resolve(newSelectedAsset);
        },
        getSelectedAsset: () => selectedAsset,

        // Asset Transactions
        transferAsset: (recipientAddress: string, amount?: number) => {
          if (!selectedAsset) return Promise.reject(new Error("No asset selected for transfer."));
          return handleConfirmTransfer(recipientAddress, amount);
        },
        burnAsset: (amount?: number) => {
          if (!selectedAsset) return Promise.reject(new Error("No asset selected for burn."));
          return handleConfirmBurn(amount);
        },
        depositAsset: (amount: number) => { // For SPL Tokens
          if (selectedAsset?.type !== 'token') return Promise.reject(new Error("Only SPL tokens can be deposited using depositAsset. Use depositSol for SOL."));
          return handleConfirmDeposit(amount);
        },
        requestTokenWithdrawal: (grossAmount: number, netAmount: number) => {
          if (selectedAsset?.type !== 'token') return Promise.reject(new Error("Only SPL tokens can be withdrawn using requestTokenWithdrawal. Use requestSolWithdrawal for SOL."));
          return handleRequestWithdrawal(grossAmount, netAmount);
        },

        // SOL Transactions
        transferSol: async (recipientAddress: string, amountSol: number) => {
           if (isSubmittingTransaction) return Promise.reject(new Error("Another transaction is already being processed."));
           if (!publicKey || !sendTransaction) return Promise.reject(new Error("Wallet not connected for SOL transfer."));
           setIsSubmittingTransaction(true);
           sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: true });
           try {
             const recipientPublicKey = new PublicKey(recipientAddress);
             const signature = await transferSol(connection, wallet, recipientPublicKey, amountSol);
             toast({ title: "SOL Transfer Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank">View</a> });
             sendToUnity("SolBlazeManager", "OnTransactionSubmitted", { action: "transfer_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
             fetchSolBalance();
             return Promise.resolve({signature});
           } catch (error: any) {
             toast({ title: "SOL Transfer Failed", description: error.message, variant: "destructive" });
             sendToUnity("SolBlazeManager", "OnTransactionError", { action: "transfer_sol", error: error.message });
             return Promise.reject(error);
           } finally {
             setIsSubmittingTransaction(false);
             sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "transfer_sol", submitting: false });
           }
        },
        depositSol: async (amountSol: number) => {
           if (isSubmittingTransaction) return Promise.reject(new Error("Another transaction is already being processed."));
           if (!publicKey || !sendTransaction || !CUSTODIAL_WALLET_ADDRESS) return Promise.reject(new Error("Wallet not connected or custodial address not set for SOL deposit."));
           setIsSubmittingTransaction(true);
           sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "deposit_sol", submitting: true });
           try {
             const signature = await depositSol(connection, wallet, amountSol, CUSTODIAL_WALLET_ADDRESS);
             toast({ title: "SOL Deposit Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank">View</a> });
             sendToUnity("SolBlazeManager", "OnTransactionSubmitted", { action: "deposit_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
             fetchSolBalance();
             return Promise.resolve({signature});
           } catch (error: any) {
             toast({ title: "SOL Deposit Failed", description: error.message, variant: "destructive" });
             sendToUnity("SolBlazeManager", "OnTransactionError", { action: "deposit_sol", error: error.message });
             return Promise.reject(error);
           } finally {
             setIsSubmittingTransaction(false);
             sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "deposit_sol", submitting: false });
           }
        },
        requestSolWithdrawal: async (_grossAmountSol: number, netAmountSol: number) => { // Unity sends net amount for SOL
            if (isSubmittingTransaction) return Promise.reject(new Error("Another transaction is already being processed."));
            if (!publicKey) return Promise.reject(new Error("Wallet not connected for SOL withdrawal."));
            if (netAmountSol <= 0) return Promise.reject(new Error("Invalid SOL withdrawal amount."));

            setIsSubmittingTransaction(true);
            sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "withdraw_sol", submitting: true });
            try {
                const result = await initiateWithdrawalRequest(publicKey.toBase58(), netAmountSol, currentNetwork); // No token passed, amount is SOL units
                if (result.success) {
                    toast({ title: "SOL Withdrawal Processed", description: result.signature ? `Sig: ${result.signature}` : result.message, action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetwork)} target="_blank">View</a> : undefined });
                    sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { ...result, type: 'sol', explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetwork) : undefined });
                } else {
                    toast({ title: "SOL Withdrawal Failed", description: result.message, variant: "destructive" });
                    sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { ...result, type: 'sol', error: result.message });
                }
                return result.success ? Promise.resolve(result) : Promise.reject(new Error(result.message));
            } catch (error: any) {
                toast({ title: "SOL Withdrawal Error", description: error.message, variant: "destructive" });
                sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { success: false, message: error.message, error: error.message, type: 'sol' });
                return Promise.reject(error);
            } finally {
                setIsSubmittingTransaction(false);
                sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "withdraw_sol", submitting: false });
            }
        },
        burnSol: async (amountSol: number) => {
           if (isSubmittingTransaction) return Promise.reject(new Error("Another transaction is already being processed."));
           if (!publicKey || !sendTransaction) return Promise.reject(new Error("Wallet not connected for SOL burn."));
           setIsSubmittingTransaction(true);
           sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: true });
           try {
             const signature = await burnSol(connection, wallet, amountSol);
             toast({ title: "SOL Burn Initiated", description: `Signature: ${signature}`, action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank">View</a> });
             sendToUnity("SolBlazeManager", "OnTransactionSubmitted", { action: "burn_sol", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
             fetchSolBalance();
             return Promise.resolve({signature});
           } catch (error: any) {
             toast({ title: "SOL Burn Failed", description: error.message, variant: "destructive" });
             sendToUnity("SolBlazeManager", "OnTransactionError", { action: "burn_sol", error: error.message });
             return Promise.reject(error);
           } finally {
             setIsSubmittingTransaction(false);
             sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "burn_sol", submitting: false });
           }
        },

        setNetwork: (network: SupportedSolanaNetwork) => {
            setCurrentNetwork(network);
            sendToUnity("SolBlazeManager", "OnNetworkChanged", { network });
            return Promise.resolve();
        },
        getCurrentNetwork: () => currentNetwork,

        // Methods to open modals (might be less relevant if Unity has its own UI)
        openTransferModal: () => {
          if (selectedAsset) setIsTransferModalOpen(true);
          else sendToUnity("SolBlazeManager", "OnModalError", { modal: "transfer", error: "No asset selected."});
        },
        openBurnModal: () => {
          if (selectedAsset) setIsBurnModalOpen(true);
          else sendToUnity("SolBlazeManager", "OnModalError", { modal: "burn", error: "No asset selected."});
        },
        openDepositModal: () => { // Only for SPL tokens via web UI
          if (selectedAsset?.type === 'token') setIsDepositModalOpen(true);
          else sendToUnity("SolBlazeManager", "OnModalError", { modal: "deposit_token", error: "No SPL token selected."});
        },
        openWithdrawModal: () => { // Only for SPL tokens via web UI
          if (selectedAsset?.type === 'token') setIsWithdrawModalOpen(true);
          else sendToUnity("SolBlazeManager", "OnModalError", { modal: "withdraw_token", error: "No SPL token selected."});
        },
      };
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).unityBridge;
      }
    };
  }, [
    connected, publicKey, currentNetwork, nfts, cnfts, tokens, solBalance, selectedAsset, allFetchedAssets,
    wallet, connectWalletAdapter, disconnectWalletAdapter, select,
    loadAssets, setSelectedAssetId, fetchSolBalance,
    handleConfirmTransfer, handleConfirmBurn, handleConfirmDeposit, handleRequestWithdrawal,
    setCurrentNetwork, connection, rpcUrl, sendToUnity, toast,
    setIsTransferModalOpen, setIsBurnModalOpen, setIsDepositModalOpen, setIsWithdrawModalOpen,
    isSubmittingTransaction
  ]);


  const handleSelectAsset = (assetId: string | null) => {
    setSelectedAssetId(assetId);
    const newSelectedAsset = allFetchedAssets.find(a => a.id === assetId) || null;
    sendToUnity("SolBlazeManager", "OnAssetSelected", { asset: newSelectedAsset });
  };


  return (
    <div className="flex flex-col min-h-screen bg-gray-900 text-white overflow-hidden">
       <header className="sticky top-0 z-[100] w-full border-b border-gray-700 bg-gray-800/95 backdrop-blur supports-[backdrop-filter]:bg-gray-800/60">
        <div className="container flex h-16 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <svg width="28" height="28" viewBox="0 0 100 100" fill="hsl(var(--primary))" xmlns="http://www.w3.org/2000/svg">
                <path d="M50 0L61.226 23.407L87.364 26.795L70.957 44.09L73.607 70.039L50 58.36L26.393 70.039L29.043 44.09L12.636 26.795L38.774 23.407L50 0ZM50 28.778L43.111 54.444H71.111L64.222 28.778H50ZM28.889 60L35.778 85.667L50 73.333L64.222 85.667L71.111 60H28.889Z"/>
              </svg>
              <h1 className="text-xl font-bold text-primary">SolBlaze GameBridge</h1>
            </div>
            <NetworkSwitcher />
          </div>
          <ConnectWalletButton />
        </div>
      </header>

      <main className="flex-1 w-full h-[calc(100vh-4rem)] p-0 m-0"> {/* Adjusted height for header */}
        <iframe
          ref={iframeRef}
          src="/unity-game/index.html" // Path to your Unity WebGL build's index.html
          title="Unity Game"
          className="w-full h-full border-none"
          allow="autoplay; fullscreen *; geolocation; microphone; camera; midi; monetization; xr-spatial-tracking; gamepad; gyroscope; accelerometer; xr; cross-origin-isolated"
          sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
        ></iframe>
      </main>

      {/* Modals remain available for web-based testing or specific Unity-triggered UI if needed */}
      {selectedAsset && (
        <>
          <TransferModal
            asset={selectedAsset}
            isOpen={isTransferModalOpen}
            onClose={() => setIsTransferModalOpen(false)}
            onConfirmTransfer={handleConfirmTransfer}
          />
          <BurnModal
            asset={selectedAsset}
            isOpen={isBurnModalOpen}
            onClose={() => setIsBurnModalOpen(false)}
            onConfirmBurn={handleConfirmBurn}
          />
          {selectedAsset.type === 'token' && (
            <>
              <DepositModal
                asset={selectedAsset as SplToken}
                isOpen={isDepositModalOpen}
                onClose={() => setIsDepositModalOpen(false)}
                onConfirmDeposit={handleConfirmDeposit}
              />
              <WithdrawModal
                asset={selectedAsset as SplToken}
                isOpen={isWithdrawModalOpen}
                onClose={() => setIsWithdrawModalOpen(false)}
                onConfirmWithdraw={handleRequestWithdrawal}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
