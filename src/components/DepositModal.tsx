
"use client";

import type React from "react";
import { useState } from "react";
import type { SplToken } from "@/types/solana";
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

interface DepositModalProps {
  asset: SplToken | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmDeposit: (amount: number) => Promise<void>;
}

export const DepositModal: React.FC<DepositModalProps> = ({
  asset,
  isOpen,
  onClose,
  onConfirmDeposit,
}) => {
  const [amount, setAmount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  if (!asset) return null;

  const handleDeposit = async () => {
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      toast({ title: "Error", description: "Invalid deposit amount.", variant: "destructive" });
      return;
    }
    if (depositAmount > asset.balance) {
      toast({ title: "Error", description: "Deposit amount exceeds your balance.", variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    try {
      await onConfirmDeposit(depositAmount);
      onClose(); 
    } catch (error: any) {
      // Error toast is typically handled by the caller (onConfirmDeposit)
      console.error("Deposit failed in modal:", error);
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
          <DialogTitle className="text-2xl font-headline">Deposit Token</DialogTitle>
          <DialogDescription>
            Deposit {asset.name} ({asset.symbol}) to the custodial wallet.
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
              <p className="text-sm text-muted-foreground">{asset.symbol}</p>
              <p className="text-xs text-muted-foreground">Your balance: {asset.balance.toLocaleString()} {asset.symbol}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="depositAmount" className="text-base">Amount to Deposit</Label>
            <Input
              id="depositAmount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Max: ${asset.balance.toLocaleString()}`}
              className="text-base"
              min="0"
              step="any"
              aria-describedby="depositAmountHelp"
            />
            <p id="depositAmountHelp" className="text-xs text-muted-foreground">
              This amount will be transferred from your wallet.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isProcessing} className="text-base">Cancel</Button>
          <Button 
            onClick={handleDeposit} 
            disabled={isProcessing || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > asset.balance} 
            className="bg-green-600 hover:bg-green-700 text-white text-base"
          >
            {isProcessing ? "Processing..." : "Confirm Deposit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
