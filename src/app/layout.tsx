import type {Metadata} from 'next';
import './globals.css';
import {WalletContextProvider} from '@/contexts/WalletContextProvider';
import {Toaster} from '@/components/ui/toaster';

export const metadata: Metadata = {
  title: 'SolBlaze Wallet Dashboard',
  description: 'Manage your Solana NFTs, cNFTs, and SPL tokens with SolBlaze.',
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
      </head>
      <body className="font-body antialiased">
        <WalletContextProvider>
          {children}
          <Toaster />
        </WalletContextProvider>
      </body>
    </html>
  );
}
