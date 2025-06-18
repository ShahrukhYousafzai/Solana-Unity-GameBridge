
import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { WalletContextProvider } from '@/contexts/WalletContextProvider';
import { NetworkProvider } from '@/contexts/NetworkContext';
import { Toaster } from '@/components/ui/toaster';
import { UNITY_GAME_BUILD_BASE_NAME } from '@/config';

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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* 
          This script tag loads the Unity WebGL loader.
          It now dynamically uses UNITY_GAME_BUILD_BASE_NAME.
          Example: If UNITY_GAME_BUILD_BASE_NAME is "GearHeadRacing", this will load "/Build/GearHeadRacing.loader.js".
          Ensure this loader script name matches what your Unity build generates when "Name Files As Hashes" is disabled.
        */}
        <Script src={`/Build/${UNITY_GAME_BUILD_BASE_NAME}.loader.js`} strategy="beforeInteractive" />
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
    
