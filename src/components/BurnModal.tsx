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
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";


interface BurnModalProps {
  asset: Asset | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmBurn: (amount?: number) => Promise<void>;
}

export const BurnModal: React.FC<BurnModalProps> = ({
  asset,
  isOpen,
  onClose,
  onConfirmBurn,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [amount, setAmount] = useState<string>(""); // String for input, convert to number later
  const { toast } = useToast();

  if (!asset) return null;

  const handleBurn = async () => {
    let burnAmount: number | undefined = undefined;
    if (asset.type === "token") {
      burnAmount = parseFloat(amount);
      if (isNaN(burnAmount) || burnAmount <= 0) {
        toast({ title: "Error", description: "Invalid amount for token burn.", variant: "destructive" });
        return;
      }
      if (burnAmount > (asset as SplToken).balance) {
        toast({ title: "Error", description: "Burn amount exceeds balance.", variant: "destructive" });
        return;
      }
    }

    setIsProcessing(true);
    try {
      await onConfirmBurn(burnAmount);
      // Success toast handled by parent
      onClose(); // Close modal on successful initiation
    } catch (error: any) {
      // Error toast handled by parent or here
      console.error("Burn failed in modal:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetForm = () => {
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
          <DialogTitle className="text-2xl font-headline text-destructive">Confirm Burn Asset</DialogTitle>
          <DialogDescription>
            You are about to permanently burn "{asset.name}". This action is irreversible.
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
                {asset.type === 'token' && <p className="text-xs text-muted-foreground">Balance: {(asset as SplToken).balance.toLocaleString()}</p>}
                </div>
            </div>
            
            {asset.type === "token" && (
                <div className="space-y-2">
                <Label htmlFor="burnAmount" className="text-base">Amount to Burn</Label>
                <Input
                    id="burnAmount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Max: ${(asset as SplToken).balance.toLocaleString()}`}
                    className="text-base"
                    min="0"
                    step="any"
                />
                 <p className="text-xs text-muted-foreground">
                    Available balance: {(asset as SplToken).balance.toLocaleString()} {asset.symbol}
                </p>
                </div>
            )}

            <Alert variant="destructive" className="mt-4">
                <AlertTriangle className="h-5 w-5" />
                <AlertTitle className="font-semibold">Warning</AlertTitle>
                <AlertDescription>
                Burning this asset will permanently remove it from your wallet and circulation. This action cannot be undone.
                </AlertDescription>
            </Alert>
        </div>


        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isProcessing} className="text-base">Cancel</Button>
          <Button onClick={handleBurn} variant="destructive" disabled={isProcessing || (asset.type === 'token' && !amount)} className="text-base">
            {isProcessing ? "Processing..." : `Confirm Burn ${asset.type === 'token' && amount ? amount + ' ' + asset.symbol : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
