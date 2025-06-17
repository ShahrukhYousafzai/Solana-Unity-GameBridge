"use client";

import type React from "react";
import { useState } from "react";
import type { Asset, SplToken } from "@/types/solana";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import { PublicKey } from "@solana/web3.js";

interface TransferModalProps {
  asset: Asset | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmTransfer: (recipientAddress: string, amount?: number) => Promise<void>;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  asset,
  isOpen,
  onClose,
  onConfirmTransfer,
}) => {
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState<string>(""); // String for input, convert to number later
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  if (!asset) return null;

  const handleTransfer = async () => {
    if (!recipientAddress) {
      toast({ title: "Error", description: "Recipient address is required.", variant: "destructive" });
      return;
    }
    try {
      new PublicKey(recipientAddress);
    } catch (error) {
      toast({ title: "Error", description: "Invalid recipient address.", variant: "destructive" });
      return;
    }

    let transferAmount: number | undefined = undefined;
    if (asset.type === "token") {
      transferAmount = parseFloat(amount);
      if (isNaN(transferAmount) || transferAmount <= 0) {
        toast({ title: "Error", description: "Invalid amount for token transfer.", variant: "destructive" });
        return;
      }
      if (transferAmount > (asset as SplToken).balance) {
        toast({ title: "Error", description: "Transfer amount exceeds balance.", variant: "destructive" });
        return;
      }
    }

    setIsProcessing(true);
    try {
      await onConfirmTransfer(recipientAddress, transferAmount);
      // Success toast is handled by the parent component after transaction confirmation
      onClose(); // Close modal on successful initiation
    } catch (error: any) {
      // Error toast handled by parent or here if specific to modal validation
      console.error("Transfer failed in modal:", error);
      // Toast might already be shown by onConfirmTransfer's error handling
    } finally {
      setIsProcessing(false);
    }
  };
  
  const resetForm = () => {
    setRecipientAddress("");
    setAmount("");
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      resetForm();
    }
  };


  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-card rounded-lg shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-headline">Transfer Asset</DialogTitle>
          <DialogDescription>
            You are about to transfer "{asset.name}". Enter the recipient's Solana address.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-6 space-y-6">
          <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-md">
            {asset.imageUrl ? (
              <Image src={asset.imageUrl} alt={asset.name} width={64} height={64} className="rounded" data-ai-hint="token item" />
            ) : (
              <div className="w-16 h-16 bg-secondary rounded flex items-center justify-center text-muted-foreground">
                <Image src="https://placehold.co/64x64.png" alt="Placeholder" width={64} height={64} className="rounded" data-ai-hint="token item" />
              </div>
            )}
            <div>
              <h3 className="font-semibold">{asset.name}</h3>
              <p className="text-sm text-muted-foreground">{asset.symbol || asset.type.toUpperCase()}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="recipientAddress" className="text-base">Recipient Address</Label>
            <Input
              id="recipientAddress"
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              placeholder="Enter Solana address (e.g., SoLAnA...)"
              className="text-base"
              aria-describedby="recipientAddressHelp"
            />
             <p id="recipientAddressHelp" className="text-xs text-muted-foreground">
              Ensure the address is correct. Transactions are irreversible.
            </p>
          </div>

          {asset.type === "token" && (
            <div className="space-y-2">
              <Label htmlFor="amount" className="text-base">Amount to Transfer</Label>
              <Input
                id="amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`Max: ${(asset as SplToken).balance.toLocaleString()}`}
                className="text-base"
                min="0"
                step="any"
                aria-describedby="amountHelp"
              />
              <p id="amountHelp" className="text-xs text-muted-foreground">
                Available balance: {(asset as SplToken).balance.toLocaleString()} {asset.symbol}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isProcessing} className="text-base">Cancel</Button>
          <Button onClick={handleTransfer} disabled={isProcessing || !recipientAddress || (asset.type === 'token' && !amount)} className="bg-primary hover:bg-primary/90 text-primary-foreground text-base">
            {isProcessing ? "Processing..." : "Confirm Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
