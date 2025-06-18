
import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { WalletContextProvider } from '@/contexts/WalletContextProvider';
import { NetworkProvider } from '@/contexts/NetworkContext';
import { Toaster } from '@/components/ui/toaster';

export const metadata: Metadata = {
  title: 'SolBlaze GameBridge',
  description: 'Manage your Solana assets within your Unity game via SolBlaze.',
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* 
          This script tag loads the Unity WebGL loader.
          Ensure 'UnityLoader.js' (or the actual name of your loader script, e.g., YourGameName.loader.js)
          is present in your `public/Build/` directory.
          The `strategy="beforeInteractive"` is important for it to load early.
        */}
        <Script src="/Build/UnityLoader.js" strategy="beforeInteractive" />
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

    