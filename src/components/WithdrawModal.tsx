
"use client";

import type React from "react";
import { useState, useMemo } from "react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

interface WithdrawModalProps {
  asset: SplToken | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmWithdraw: (grossAmount: number, netAmount: number) => Promise<void>; // User requests gross, receives net
}

const WITHDRAWAL_TAX_PERCENTAGE = 5; // 5%

export const WithdrawModal: React.FC<WithdrawModalProps> = ({
  asset,
  isOpen,
  onClose,
  onConfirmWithdraw,
}) => {
  const [amount, setAmount] = useState<string>(""); // Gross amount user wants to withdraw
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  if (!asset) return null;

  const { netAmount, taxAmount } = useMemo(() => {
    const grossAmountNum = parseFloat(amount);
    if (isNaN(grossAmountNum) || grossAmountNum <= 0) {
      return { netAmount: 0, taxAmount: 0 };
    }
    const calculatedTax = grossAmountNum * (WITHDRAWAL_TAX_PERCENTAGE / 100);
    const calculatedNetAmount = grossAmountNum - calculatedTax;
    // Ensure netAmount isn't negative due to precision, though unlikely with positive inputs
    return { 
      netAmount: Math.max(0, calculatedNetAmount), 
      taxAmount: calculatedTax 
    };
  }, [amount]);

  const handleWithdraw = async () => {
    const grossAmountNum = parseFloat(amount);
    if (isNaN(grossAmountNum) || grossAmountNum <= 0) {
      toast({ title: "Error", description: "Invalid withdrawal amount.", variant: "destructive" });
      return;
    }
    // Here, you might want to check against an "in-game balance" rather than wallet balance
    // For this example, we'll assume the user can request any amount.
    // A real implementation would check against their available in-game currency.

    setIsProcessing(true);
    try {
      await onConfirmWithdraw(grossAmountNum, netAmount);
      onClose();
    } catch (error: any) {
      console.error("Withdrawal request failed in modal:", error);
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
          <DialogTitle className="text-2xl font-headline">Request Token Withdrawal</DialogTitle>
          <DialogDescription>
            Request to withdraw {asset.name} ({asset.symbol}) to your wallet.
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
              {/* Typically, you'd show in-game balance here, not wallet balance */}
              <p className="text-xs text-muted-foreground">Your wallet balance: {asset.balance.toLocaleString()} {asset.symbol}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="withdrawAmount" className="text-base">Amount to Withdraw</Label>
            <Input
              id="withdrawAmount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="text-base"
              min="0"
              step="any"
            />
          </div>

          {parseFloat(amount) > 0 && (
            <Alert variant="default" className="bg-blue-50 border-blue-200">
              <Info className="h-5 w-5 text-blue-600" />
              <AlertTitle className="font-semibold text-blue-700">Withdrawal Details</AlertTitle>
              <AlertDescription className="text-blue-600">
                Requested: {parseFloat(amount).toLocaleString()} {asset.symbol}<br />
                Tax ({WITHDRAWAL_TAX_PERCENTAGE}%): {taxAmount.toLocaleString()} {asset.symbol}<br />
                You will receive: <strong>{netAmount.toLocaleString()} {asset.symbol}</strong>
              </AlertDescription>
            </Alert>
          )}
           <Alert variant="default" className="bg-orange-50 border-orange-200">
              <Info className="h-5 w-5 text-orange-600" />
              <AlertTitle className="font-semibold text-orange-700">Important Note</AlertTitle>
              <AlertDescription className="text-orange-600">
                Withdrawals are processed by the team and may take some time. This action initiates a request. The actual transfer from the custodial wallet requires backend processing.
              </AlertDescription>
            </Alert>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isProcessing} className="text-base">Cancel</Button>
          <Button 
            onClick={handleWithdraw} 
            disabled={isProcessing || !amount || parseFloat(amount) <= 0}
            className="bg-blue-600 hover:bg-blue-700 text-white text-base"
          >
            {isProcessing ? "Processing..." : "Request Withdrawal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
