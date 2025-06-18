
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* 
          The Unity WebGL build will typically include its own loader script (e.g., UnityLoader.js or similar)
          and data/framework files. You'll place your Unity build in the `public/Build/` directory.
          The path here should match the main loader script from your Unity build.
          Example: /Build/YourGameLoader.js 
          For some Unity versions it might be just `Build/UnityLoader.js`
        */}
        <Script src="/Build/UnityLoader.js" strategy="beforeInteractive" />
      </head>
      <body className="font-body antialiased bg-gray-900 text-white overflow-hidden">
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
