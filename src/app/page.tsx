
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getTransactionExplorerUrl, getAddressExplorerUrl } from "@/utils/explorer";
import { transferNft, transferSplToken, burnNft, burnSplToken, transferCNft, burnCNft } from "@/lib/solana/transactions";
import { RefreshCw, Package, PackageSearch, CoinsIcon } from "lucide-react";
import { useNetwork } from "@/contexts/NetworkContext";
import { NetworkSwitcher } from "@/components/NetworkSwitcher";

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
  const { publicKey, sendTransaction, connected } = wallet;
  const { toast } = useToast();
  const { currentNetwork, rpcUrl } = useNetwork();

  const [nfts, setNfts] = useState<Nft[]>([]);
  const [cnfts, setCnfts] = useState<CNft[]>([]);
  const [tokens, setTokens] = useState<SplToken[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isBurnModalOpen, setIsBurnModalOpen] = useState(false);
  const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);

  const allFetchedAssets = useMemo(() => [...nfts, ...cnfts, ...tokens], [nfts, cnfts, tokens]);
  const selectedAsset = useMemo(() => allFetchedAssets.find(a => a.id === selectedAssetId) || null, [selectedAssetId, allFetchedAssets]);

  const loadAssets = useCallback(async () => {
    if (!publicKey || !rpcUrl || !connection || !wallet) {
      setNfts([]);
      setCnfts([]);
      setTokens([]);
      setSelectedAssetId(null);
      return;
    }
    setIsLoadingAssets(true);
    setSelectedAssetId(null); 
    try {
      const { nfts: fetchedNfts, cnfts: fetchedCnfts, tokens: fetchedTokens, heliusWarning } = await fetchAssetsForOwner(publicKey.toBase58(), rpcUrl, connection, wallet);
      
      if (heliusWarning) {
        toast({
          title: "Helius API Warning",
          description: heliusWarning,
          variant: "destructive", // Can be changed to a "warning" variant if one exists and is preferred
        });
      }

      setNfts(fetchedNfts);
      setCnfts(fetchedCnfts);
      setTokens(fetchedTokens);
      toast({ title: "Asset Scan Complete", description: `Found ${fetchedNfts.length} NFTs, ${fetchedCnfts.length} cNFTs, and ${fetchedTokens.length} Tokens on ${currentNetwork}.` });
    } catch (error: any) {
      console.error("Failed to load assets:", error);
      toast({ title: "Error Loading Assets", description: error.message, variant: "destructive" });
      setNfts([]); setCnfts([]); setTokens([]);
    } finally {
      setIsLoadingAssets(false);
    }
  }, [publicKey, rpcUrl, connection, wallet, toast, currentNetwork]);

  useEffect(() => {
    if (connected && publicKey) {
      loadAssets();
    } else {
      setNfts([]);
      setCnfts([]);
      setTokens([]);
      setSelectedAssetId(null);
    }
  }, [connected, publicKey, loadAssets, currentNetwork]);

  const handleConfirmTransfer = useCallback(async (recipientAddress: string, amount?: number) => {
    if (isSubmittingTransaction) {
      toast({ title: "In Progress", description: "Another transaction is already being processed.", variant: "default" });
      return;
    }
    if (!selectedAsset || !publicKey || !sendTransaction) {
      toast({ title: "Error", description: "Wallet not connected or no asset selected.", variant: "destructive" });
      return;
    }

    setIsSubmittingTransaction(true);
    let signature: string | undefined;
    try {
      const recipientPublicKey = new PublicKey(recipientAddress);
      if (selectedAsset.type === "nft") {
        signature = await transferNft(connection, wallet, selectedAsset as Nft, recipientPublicKey);
      } else if (selectedAsset.type === "cnft") {
         signature = await transferCNft(connection, wallet, selectedAsset as CNft, recipientPublicKey, rpcUrl);
      } else if (selectedAsset.type === "token") {
        if (typeof amount !== 'number' || amount <= 0) {
          toast({ title: "Error", description: "Invalid amount for token transfer.", variant: "destructive" });
          setIsSubmittingTransaction(false);
          return;
        }
        signature = await transferSplToken(connection, wallet, selectedAsset as SplToken, recipientPublicKey, amount);
      }

      if (signature) {
        toast({
          title: "Transfer Initiated",
          description: `Transaction signature: ${signature}`,
          action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View on Explorer</a>,
        });
        setIsTransferModalOpen(false);
        loadAssets(); 
      }
    } catch (error: any) {
      console.error("Transfer failed:", error);
      toast({ title: "Transfer Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmittingTransaction(false);
    }
  }, [selectedAsset, publicKey, sendTransaction, connection, wallet, toast, loadAssets, currentNetwork, rpcUrl, isSubmittingTransaction]);

  const handleConfirmBurn = useCallback(async (amount?: number) => {
    if (isSubmittingTransaction) {
      toast({ title: "In Progress", description: "Another transaction is already being processed.", variant: "default" });
      return;
    }
    if (!selectedAsset || !publicKey || !sendTransaction) {
      toast({ title: "Error", description: "Wallet not connected or no asset selected.", variant: "destructive" });
      return;
    }

    setIsSubmittingTransaction(true);
    let signature: string | undefined;
    try {
      if (selectedAsset.type === "nft") {
        signature = await burnNft(connection, wallet, selectedAsset as Nft);
      } else if (selectedAsset.type === "cnft") {
         signature = await burnCNft(connection, wallet, selectedAsset as CNft, rpcUrl);
      } else if (selectedAsset.type === "token") {
        if (typeof amount !== 'number' || amount <= 0) {
          toast({ title: "Error", description: "Invalid amount for token burn.", variant: "destructive" });
          setIsSubmittingTransaction(false);
          return;
        }
        signature = await burnSplToken(connection, wallet, selectedAsset as SplToken, amount);
      }

      if (signature) {
        toast({
          title: "Burn Initiated",
          description: `Transaction signature: ${signature}`,
          action: <a href={getTransactionExplorerUrl(signature, currentNetwork)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View on Explorer</a>,
        });
        setIsBurnModalOpen(false);
        loadAssets(); 
      }
    } catch (error: any) {
      console.error("Burn failed:", error);
      toast({ title: "Burn Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmittingTransaction(false);
    }
  }, [selectedAsset, publicKey, sendTransaction, connection, wallet, toast, loadAssets, currentNetwork, rpcUrl, isSubmittingTransaction]);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).transferSelectedAsset = async (recipientAddressString: string, amount?: number) => {
        if (isSubmittingTransaction) {
          toast({ title: "In Progress", description: "Another transaction is already being processed.", variant: "default" });
          return;
        }
        if (!selectedAsset) {
          toast({ title: "Error", description: "No asset selected.", variant: "destructive" });
          return;
        }
        try {
          const recipientPublicKey = new PublicKey(recipientAddressString);
          await handleConfirmTransfer(recipientPublicKey.toBase58(), amount);
        } catch (error: any) {
           toast({ title: "Transfer Failed", description: error.message, variant: "destructive" });
        }
      };
      (window as any).burnSelectedAsset = async (amount?: number) => {
         if (isSubmittingTransaction) {
          toast({ title: "In Progress", description: "Another transaction is already being processed.", variant: "default" });
          return;
        }
         if (!selectedAsset) {
          toast({ title: "Error", description: "No asset selected.", variant: "destructive" });
          return;
        }
        try {
          await handleConfirmBurn(amount);
        } catch (error: any) {
           toast({ title: "Burn Failed", description: error.message, variant: "destructive" });
        }
      };
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).transferSelectedAsset;
        delete (window as any).burnSelectedAsset;
      }
    };
  }, [selectedAsset, handleConfirmTransfer, handleConfirmBurn, toast, isSubmittingTransaction]);

  const handleSelectAsset = (assetId: string | null) => {
    setSelectedAssetId(assetId);
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
        </>
      )}
    </div>
  );
}
