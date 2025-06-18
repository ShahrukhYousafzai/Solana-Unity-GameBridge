
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
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
import { transferNft, transferSplToken, burnNft, burnSplToken, transferCNft, burnCNft, depositSplToken, initiateWithdrawalRequest } from "@/lib/solana/transactions";
import type { WithdrawalResponse } from "@/lib/solana/transactions";
import { RefreshCw, Package, PackageSearch, CoinsIcon } from "lucide-react";
import { useNetwork } from "@/contexts/NetworkContext";
import type { SupportedSolanaNetwork } from "@/config";
import { NetworkSwitcher } from "@/components/NetworkSwitcher";
import { CUSTODIAL_WALLET_ADDRESS } from "@/config";

const ConnectWalletButton = dynamic(
  () => import("@/components/ConnectWalletButton").then((mod) => mod.ConnectWalletButton),
  { 
    ssr: false,
    loading: () => <Skeleton className="h-10 w-32 rounded-md" /> 
  }
);

// Placeholder for Unity communication
// The actual implementation will depend on your Unity Web Browser plugin
const sendToUnity = (objectName: string, methodName: string, message: any) => {
  if (typeof window !== 'undefined' && (window as any).UnityGame?.SendMessage) {
    console.log(`[UnityBridge] Sending to Unity: ${objectName}.${methodName}`, message);
    (window as any).UnityGame.SendMessage(objectName, methodName, JSON.stringify(message));
  } else {
    console.warn(`[UnityBridge] UnityGame.SendMessage not found. Message for ${objectName}.${methodName} not sent.`, message);
  }
};


export default function HomePage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, sendTransaction, connected, connect: connectWalletAdapter, disconnect: disconnectWalletAdapter, select } = wallet;
  const { toast } = useToast();
  const { currentNetwork, setCurrentNetwork, rpcUrl } = useNetwork();

  const [nfts, setNfts] = useState<Nft[]>([]);
  const [cnfts, setCnfts] = useState<CNft[]>([]);
  const [tokens, setTokens] = useState<SplToken[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isBurnModalOpen, setIsBurnModalOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);

  const allFetchedAssets = useMemo(() => [...nfts, ...cnfts, ...tokens], [nfts, cnfts, tokens]);
  const selectedAsset = useMemo(() => allFetchedAssets.find(a => a.id === selectedAssetId) || null, [selectedAssetId, allFetchedAssets]);

  const loadAssets = useCallback(async () => {
    if (!publicKey || !rpcUrl || !connection || !wallet) {
      setNfts([]);
      setCnfts([]);
      setTokens([]);
      setSelectedAssetId(null);
      sendToUnity("SolBlazeManager", "OnAssetsLoaded", { nfts: [], cnfts: [], tokens: [] });
      return;
    }
    setIsLoadingAssets(true);
    sendToUnity("SolBlazeManager", "OnAssetsLoadingStateChanged", { isLoading: true });
    setSelectedAssetId(null); 
    sendToUnity("SolBlazeManager", "OnAssetSelected", { asset: null });
    try {
      const { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, heliusWarning } = await fetchAssetsForOwner(publicKey.toBase58(), rpcUrl, connection, wallet);
      
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
      sendToUnity("SolBlazeManager", "OnAssetsLoaded", { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens });

      if (!heliusWarning) {
        toast({ title: "Asset Scan Complete", description: `Found ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs, and ${fetchedTokens.length} Tokens on ${currentNetwork}.` });
      }
    } catch (error: any) {
      console.error("Failed to load assets:", error);
      toast({ title: "Error Loading Assets", description: error.message, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnAssetsLoadFailed", { error: error.message });
      setNfts([]); setCnfts([]); setTokens([]);
      sendToUnity("SolBlazeManager", "OnAssetsLoaded", { nfts: [], cnfts: [], tokens: [] });
    } finally {
      setIsLoadingAssets(false);
      sendToUnity("SolBlazeManager", "OnAssetsLoadingStateChanged", { isLoading: false });
    }
  }, [publicKey, rpcUrl, connection, wallet, toast, currentNetwork]);

  useEffect(() => {
    if (connected && publicKey) {
      sendToUnity("SolBlazeManager", "OnWalletConnected", { publicKey: publicKey.toBase58() });
      loadAssets();
    } else {
      sendToUnity("SolBlazeManager", "OnWalletDisconnected", {});
      setNfts([]);
      setCnfts([]);
      setTokens([]);
      setSelectedAssetId(null);
    }
  }, [connected, publicKey, loadAssets, currentNetwork]);


  const handleConfirmTransfer = useCallback(async (recipientAddress: string, amount?: number) => {
    if (isSubmittingTransaction) {
      const msg = "Another transaction is already being processed.";
      toast({ title: "In Progress", description: msg, variant: "default" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "transfer", error: msg });
      return Promise.reject(new Error(msg));
    }
    if (!selectedAsset || !publicKey || !sendTransaction) {
      const msg = "Wallet not connected or no asset selected for transfer.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "transfer", error: msg });
      return Promise.reject(new Error(msg));
    }

    setIsSubmittingTransaction(true);
    sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "transfer", submitting: true });
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
          sendToUnity("SolBlazeManager", "OnTransactionError", { action: "transfer", error: msg });
          return Promise.reject(new Error(msg));
        }
        signature = await transferSplToken(connection, wallet, selectedAsset as SplToken, recipientPublicKey, amount);
      }

      if (signature) {
        toast({
          title: "Transfer Initiated",
          description: `Transaction signature: ${signature}`,
          action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View on Explorer</a>,
        });
        sendToUnity("SolBlazeManager", "OnTransactionSubmitted", { action: "transfer", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
        setIsTransferModalOpen(false);
        loadAssets(); 
        return Promise.resolve({signature});
      }
      return Promise.reject(new Error("Transfer signature was not obtained."));
    } catch (error: any) {
      console.error("Transfer failed:", error);
      toast({ title: "Transfer Failed", description: error.message, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "transfer", error: error.message });
      return Promise.reject(error);
    } finally {
      setIsSubmittingTransaction(false);
      sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "transfer", submitting: false });
    }
  }, [selectedAsset, publicKey, sendTransaction, connection, wallet, toast, loadAssets, currentNetwork, rpcUrl, isSubmittingTransaction]);

  const handleConfirmBurn = useCallback(async (amount?: number) => {
    if (isSubmittingTransaction) {
      const msg = "Another transaction is already being processed.";
      toast({ title: "In Progress", description: msg, variant: "default" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "burn", error: msg });
      return Promise.reject(new Error(msg));
    }
    if (!selectedAsset || !publicKey || !sendTransaction) {
      const msg = "Wallet not connected or no asset selected for burn.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "burn", error: msg });
      return Promise.reject(new Error(msg));
    }

    setIsSubmittingTransaction(true);
    sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "burn", submitting: true });
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
          sendToUnity("SolBlazeManager", "OnTransactionError", { action: "burn", error: msg });
          return Promise.reject(new Error(msg));
        }
        signature = await burnSplToken(connection, wallet, selectedAsset as SplToken, amount);
      }

      if (signature) {
        toast({
          title: "Burn Initiated",
          description: `Transaction signature: ${signature}`,
          action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View on Explorer</a>,
        });
        sendToUnity("SolBlazeManager", "OnTransactionSubmitted", { action: "burn", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
        setIsBurnModalOpen(false);
        loadAssets(); 
        return Promise.resolve({signature});
      }
      return Promise.reject(new Error("Burn signature was not obtained."));
    } catch (error: any) {
      console.error("Burn failed:", error);
      toast({ title: "Burn Failed", description: error.message, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "burn", error: error.message });
      return Promise.reject(error);
    } finally {
      setIsSubmittingTransaction(false);
      sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "burn", submitting: false });
    }
  }, [selectedAsset, publicKey, sendTransaction, connection, wallet, toast, loadAssets, currentNetwork, rpcUrl, isSubmittingTransaction]);

  const handleConfirmDeposit = useCallback(async (amount: number) => {
    if (isSubmittingTransaction) {
      const msg = "Another transaction is already being processed.";
      toast({ title: "In Progress", description: msg, variant: "default" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "deposit", error: msg });
      return Promise.reject(new Error(msg));
    }
    if (selectedAsset?.type !== "token" || !publicKey || !CUSTODIAL_WALLET_ADDRESS) {
      const msg = "Wallet not connected, no token selected, or custodial address not configured for deposit.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "deposit", error: msg });
      return Promise.reject(new Error(msg));
    }
    if (amount <= 0) {
      const msg = "Invalid deposit amount.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "deposit", error: msg });
      return Promise.reject(new Error(msg));
    }

    setIsSubmittingTransaction(true);
    sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "deposit", submitting: true });
    try {
      const signature = await depositSplToken(connection, wallet, selectedAsset as SplToken, amount, CUSTODIAL_WALLET_ADDRESS);
      toast({
        title: "Deposit Initiated",
        description: `Transaction signature: ${signature}`,
        action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View on Explorer</a>,
      });
      sendToUnity("SolBlazeManager", "OnTransactionSubmitted", { action: "deposit", signature, explorerUrl: getTransactionExplorerUrl(signature, currentNetwork) });
      setIsDepositModalOpen(false);
      loadAssets(); 
      return Promise.resolve({signature});
    } catch (error: any) {
      console.error("Deposit failed:", error);
      toast({ title: "Deposit Failed", description: error.message, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnTransactionError", { action: "deposit", error: error.message });
      return Promise.reject(error);
    } finally {
      setIsSubmittingTransaction(false);
      sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "deposit", submitting: false });
    }
  }, [selectedAsset, publicKey, connection, wallet, toast, loadAssets, currentNetwork, isSubmittingTransaction]);

  const handleRequestWithdrawal = useCallback(async (_grossAmount: number, netAmount: number) => {
    if (isSubmittingTransaction) {
      const msg = "Another transaction is already being processed.";
      toast({ title: "In Progress", description: msg, variant: "default" });
      sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { success: false, message: msg, error: msg });
      return Promise.reject(new Error(msg));
    }
     if (selectedAsset?.type !== "token" || !publicKey) {
      const msg = "Wallet not connected or no token selected for withdrawal.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { success: false, message: msg, error: msg });
      return Promise.reject(new Error(msg));
    }
    if (netAmount <= 0) { 
      const msg = "Invalid withdrawal amount (net amount must be positive).";
      toast({ title: "Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { success: false, message: msg, error: msg });
      return Promise.reject(new Error(msg));
    }

    setIsSubmittingTransaction(true);
    sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "withdraw", submitting: true });
    try {
      const result: WithdrawalResponse = await initiateWithdrawalRequest(
        selectedAsset as SplToken,
        publicKey.toBase58(),
        netAmount,
        currentNetwork
      );

      if (result.success) {
        toast({
          title: "Withdrawal Processed",
          description: result.signature ? `Transaction Signature: ${result.signature}` : result.message,
          action: result.signature ? <a href={getTransactionExplorerUrl(result.signature, currentNetwork)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View on Explorer</a> : undefined,
        });
        sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { ...result, explorerUrl: result.signature ? getTransactionExplorerUrl(result.signature, currentNetwork) : undefined });
        setIsWithdrawModalOpen(false);
        return Promise.resolve(result);
      } else {
        toast({ title: "Withdrawal Failed", description: result.message, variant: "destructive" });
        sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { ...result, error: result.message });
        return Promise.reject(new Error(result.message));
      }
    } catch (error: any) {
      console.error("Withdrawal request failed:", error);
      const msg = error.message || "Withdrawal request error.";
      toast({ title: "Withdrawal Request Error", description: msg, variant: "destructive" });
      sendToUnity("SolBlazeManager", "OnWithdrawalResponse", { success: false, message: msg, error: msg });
      return Promise.reject(error);
    } finally {
      setIsSubmittingTransaction(false);
      sendToUnity("SolBlazeManager", "OnTransactionSubmitting", { action: "withdraw", submitting: false });
    }
  }, [selectedAsset, publicKey, toast, currentNetwork, isSubmittingTransaction]);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).unityBridge = {
        connectWallet: async () => {
          try {
            if (!connected) {
              // This attempts to open the wallet selection modal or auto-connect.
              // The actual connection is handled by the wallet adapter's UI.
              // We might need a more direct way if `ConnectWalletButton` is hidden.
              // For now, assume this triggers the adapter's modal.
              // A common pattern is to simulate a click on the connect button if it's hidden
              // or call a method on the adapter if available.
              // Let's try to use the adapter's connect method if available.
              if (wallet.wallets.length > 0 && !wallet.wallet) {
                 select(wallet.wallets[0].adapter.name); // Select first available, or provide UI in Unity
                 // The modal should appear if `select` is called and autoConnect is false or fails.
              }
              // If already selected, connect may trigger the wallet.
              await connectWalletAdapter(); 
            }
            // Connection status will be updated by the main `useEffect` listening to `connected` and `publicKey`
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
          loadAssets(); // This is already a useCallback
          return Promise.resolve();
        },
        getAssets: () => ({
          nfts,
          cnfts,
          tokens,
        }),
        selectAsset: (assetId: string | null) => {
          setSelectedAssetId(assetId);
          const newSelectedAsset = allFetchedAssets.find(a => a.id === assetId) || null;
          sendToUnity("SolBlazeManager", "OnAssetSelected", { asset: newSelectedAsset });
          return Promise.resolve(newSelectedAsset);
        },
        getSelectedAsset: () => selectedAsset,
        transferAsset: (recipientAddress: string, amount?: number) => {
          if (!selectedAsset) return Promise.reject(new Error("No asset selected for transfer."));
          return handleConfirmTransfer(recipientAddress, amount);
        },
        burnAsset: (amount?: number) => {
          if (!selectedAsset) return Promise.reject(new Error("No asset selected for burn."));
          return handleConfirmBurn(amount);
        },
        depositAsset: (amount: number) => {
          if (selectedAsset?.type !== 'token') return Promise.reject(new Error("Only SPL tokens can be deposited."));
          return handleConfirmDeposit(amount);
        },
        requestWithdrawal: (grossAmount: number, netAmount: number) => { // Expects netAmount too now
          if (selectedAsset?.type !== 'token') return Promise.reject(new Error("Only SPL tokens can be withdrawn."));
          // The modal usually calculates netAmount, Unity might need to do this or send gross only
          // For now, let's assume Unity sends both as per the current handleRequestWithdrawal
          return handleRequestWithdrawal(grossAmount, netAmount);
        },
        setNetwork: (network: SupportedSolanaNetwork) => {
            setCurrentNetwork(network);
            sendToUnity("SolBlazeManager", "OnNetworkChanged", { network });
            return Promise.resolve();
        },
        getCurrentNetwork: () => currentNetwork,

        // --- Methods to open modals for web UI interaction (optional for Unity if it has its own UI) ---
        openTransferModal: () => {
          if (selectedAsset) setIsTransferModalOpen(true);
          else sendToUnity("SolBlazeManager", "OnModalError", { modal: "transfer", error: "No asset selected."});
        },
        openBurnModal: () => {
          if (selectedAsset) setIsBurnModalOpen(true);
          else sendToUnity("SolBlazeManager", "OnModalError", { modal: "burn", error: "No asset selected."});
        },
        openDepositModal: () => {
          if (selectedAsset?.type === 'token') setIsDepositModalOpen(true);
          else sendToUnity("SolBlazeManager", "OnModalError", { modal: "deposit", error: "No token selected."});
        },
        openWithdrawModal: () => {
          if (selectedAsset?.type === 'token') setIsWithdrawModalOpen(true);
          else sendToUnity("SolBlazeManager", "OnModalError", { modal: "withdraw", error: "No token selected."});
        },
      };
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).unityBridge;
      }
    };
  // Include all dependencies that are used inside the bridge functions
  }, [
    connected, publicKey, currentNetwork, nfts, cnfts, tokens, selectedAsset, allFetchedAssets,
    wallet, connectWalletAdapter, disconnectWalletAdapter, select,
    loadAssets, setSelectedAssetId,
    handleConfirmTransfer, handleConfirmBurn, handleConfirmDeposit, handleRequestWithdrawal,
    setCurrentNetwork,
    setIsTransferModalOpen, setIsBurnModalOpen, setIsDepositModalOpen, setIsWithdrawModalOpen,
    isSubmittingTransaction // Ensure bridge functions are aware of this
  ]);


  const handleSelectAsset = (assetId: string | null) => {
    setSelectedAssetId(assetId);
    const newSelectedAsset = allFetchedAssets.find(a => a.id === assetId) || null;
    sendToUnity("SolBlazeManager", "OnAssetSelected", { asset: newSelectedAsset });
  };

  const AssetList = ({ assets }: { assets: Asset[] }) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-1">
      {assets.length === 0 && !isLoadingAssets && <p className="col-span-full text-center text-muted-foreground py-8">No assets of this type found on {currentNetwork}.</p>}
      {isLoadingAssets ? 
        Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardHeader><Skeleton className="h-6 w-3/4" /></CardHeader>
            <CardContent>
              <Skeleton className="aspect-square w-full mb-2" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ))
        : assets.map((asset) => (
        <AssetCard key={asset.id} asset={asset} onClick={() => handleSelectAsset(asset.id)} />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-20 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <svg width="32" height="32" viewBox="0 0 100 100" fill="hsl(var(--primary))" xmlns="http://www.w3.org/2000/svg">
                <path d="M50 0L61.226 23.407L87.364 26.795L70.957 44.09L73.607 70.039L50 58.36L26.393 70.039L29.043 44.09L12.636 26.795L38.774 23.407L50 0ZM50 28.778L43.111 54.444H71.111L64.222 28.778H50ZM28.889 60L35.778 85.667L50 73.333L64.222 85.667L71.111 60H28.889Z"/>
              </svg>
              <h1 className="text-2xl font-bold font-headline text-primary">SolBlaze</h1>
            </div>
            <NetworkSwitcher /> 
          </div>
          <ConnectWalletButton />
        </div>
      </header>

      <main className="flex-1 container mx-auto p-4 md:p-6 space-y-8">
        {!connected ? (
          <Card className="text-center py-12 shadow-lg">
            <CardHeader>
              <CardTitle className="text-3xl font-headline">Welcome to SolBlaze Dashboard</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg text-muted-foreground mb-6">Connect your Solana wallet to manage your assets on the {currentNetwork} network.</p>
              <ConnectWalletButton />
            </CardContent>
          </Card>
        ) : (
          <>
            <section className="space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <h2 className="text-2xl font-semibold font-headline">Select Asset ({currentNetwork})</h2>
                 <Button variant="outline" onClick={loadAssets} disabled={isLoadingAssets || isSubmittingTransaction}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingAssets ? 'animate-spin' : ''}`} />
                  Refresh Assets
                </Button>
              </div>
              <AssetDropdown
                nfts={nfts}
                cnfts={cnfts}
                tokens={tokens}
                selectedAssetId={selectedAssetId}
                onSelectAsset={handleSelectAsset}
                isLoading={isLoadingAssets}
                disabled={!publicKey || isSubmittingTransaction}
              />
            </section>

            {selectedAsset && (
              <section>
                <AssetDisplay
                  asset={selectedAsset}
                  onTransferClick={() => setIsTransferModalOpen(true)}
                  onBurnClick={() => setIsBurnModalOpen(true)}
                  onDepositClick={selectedAsset.type === 'token' ? () => setIsDepositModalOpen(true) : undefined}
                  onWithdrawClick={selectedAsset.type === 'token' ? () => setIsWithdrawModalOpen(true) : undefined}
                  currentNetwork={currentNetwork}
                  isActionDisabled={isSubmittingTransaction}
                />
              </section>
            )}

            <section>
              <Card className="shadow-lg">
                <CardHeader>
                  <CardTitle className="text-2xl font-semibold font-headline">My Wallet Assets ({currentNetwork})</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="nfts" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-4">
                      <TabsTrigger value="nfts" className="text-base py-2 flex items-center gap-2"><Package className="h-5 w-5" />NFTs ({nfts.length})</TabsTrigger>
                      <TabsTrigger value="cnfts" className="text-base py-2 flex items-center gap-2"><PackageSearch className="h-5 w-5" />cNFTs ({cnfts.length})</TabsTrigger>
                      <TabsTrigger value="tokens" className="text-base py-2 flex items-center gap-2"><CoinsIcon className="h-5 w-5" />Tokens ({tokens.length})</TabsTrigger>
                    </TabsList>
                    <TabsContent value="nfts"><AssetList assets={nfts} /></TabsContent>
                    <TabsContent value="cnfts"><AssetList assets={cnfts} /></TabsContent>
                    <TabsContent value="tokens"><AssetList assets={tokens} /></TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </main>

      <footer className="py-6 text-center text-sm text-muted-foreground border-t">
        <p>&copy; {new Date().getFullYear()} SolBlaze. All rights reserved. Network: {currentNetwork}</p>
        <p className="mt-1">Powered by Helius and Solana.</p>
      </footer>

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
