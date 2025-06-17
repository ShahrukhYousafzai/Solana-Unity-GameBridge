"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export const ConnectWalletButton = () => {
  return (
    <WalletMultiButton
      style={{
        backgroundColor: "hsl(var(--primary))",
        color: "hsl(var(--primary-foreground))",
        borderRadius: "var(--radius)",
        padding: "10px 20px",
        fontWeight: "600",
        transition: "background-color 0.2s ease-in-out",
      }}
    />
  );
};

// CSS for hover effect if needed (or handle via Radix UI button styling if built custom)
// Alternatively, Tailwind classes can be applied if WalletMultiButton accepts className prop and forwards it.
// For direct style prop, you might need to use a wrapper or state for hover.
// The default button has its own hover states. This style prop sets the base.
