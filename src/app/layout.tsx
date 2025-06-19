
import type { Metadata } from 'next';
// Script import for Unity loader is removed as it's handled by unity-game-host.html
import './globals.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { WalletContextProvider } from '@/contexts/WalletContextProvider';
import { NetworkProvider } from '@/contexts/NetworkContext';
import { Toaster } from '@/components/ui/toaster';
// UNITY_GAME_BUILD_BASE_NAME is not needed here anymore for the loader script tag

export const metadata: Metadata = {
  title: 'Solana Unity GameBridge',
  description: 'Manage your Solana assets within your Unity game.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        <meta httpEquiv="Content-Security-Policy" content="upgrade-insecure-requests" />
        <meta
          name="viewport"
          content="width=device-width, height=device-height, initial-scale=1.0, user-scalable=no, shrink-to-fit=no"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* The Unity loader script tag is removed from here */}
      </head>
      <body className="font-body antialiased bg-background text-foreground overflow-hidden">
        <NetworkProvider>
          <WalletContextProvider>
            {children}
            <Toaster />
          </WalletContextProvider>
        </NetworkProvider>
      </body>
    </html>
  );
}
