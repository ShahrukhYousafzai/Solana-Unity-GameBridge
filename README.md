# 🚀 Solana Unity GameBridge

**Solana Unity GameBridge** is a high-performance, React-based middleware solution designed to seamlessly bridge the gap between Solana's blockchain ecosystem and Unity WebGL games. It provides a robust, professional UI for asset management and a bi-directional communication layer for real-time game interactions.

---

## 🌟 Introduction

This project serves as a gateway for Unity developers to integrate Web3 features without compromising the gaming experience. By leveraging a Next.js 15 frontend, the bridge handles complex blockchain transactions, wallet connectivity, and asset indexing (NFTs, cNFTs, and Tokens), while the Unity game engine remains focused on core gameplay.

## 🛠 Tech Stack

- **Framework**: [Next.js 15 (App Router)](https://nextjs.org/)
- **Library**: [React 18](https://reactjs.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) with [ShadCN UI](https://ui.shadcn.com/)
- **Blockchain**:
  - [@solana/web3.js](https://solana-labs.github.io/solana-web3.js/)
  - [@solana/wallet-adapter](https://github.com/solana-labs/wallet-adapter)
  - [@metaplex-foundation/umi](https://github.com/metaplex-foundation/umi)
  - [Helius DAS API](https://www.helius.dev/) (Asset Indexing)
- **Game Integration**: [react-unity-webgl](https://github.com/jeffreylanters/react-unity-webgl)
- **Icons**: [Lucide React](https://lucide.dev/)

---

## ✨ Features Checklist

- [x] **Wallet Connectivity**: Full support for Phantom, Solflare, and Backpack with `autoConnect` functionality.
- [x] **Multi-Network Support**: Seamless switching between Mainnet-Beta, Devnet, and Testnet.
- [x] **Smart Asset Indexing**: Real-time loading of NFTs, Compressed NFTs (cNFTs), and SPL Tokens via Helius DAS.
- [x] **Resilient Balance Fetching**: Optimized SOL balance retrieval with automatic public RPC fallbacks.
- [x] **Bidirectional Communication**: Instant message passing between the React bridge and Unity C# scripts.
- [x] **Asset Operations**:
  - [x] Transfer (NFTs, cNFTs, Tokens, SOL)
  - [x] Burn (Permanent removal from circulation)
  - [x] Minting (Standard NFTs supported on Devnet)
- [x] **Custodial Withdrawal System**: Backend API route for processing game-to-wallet withdrawals with automated tax calculation.
- [x] **Professional UI**: Fully responsive, dark-mode themed interface using ShadCN components.
- [x] **Optimized Loading**: Detailed progression tracking for Unity WebGL build loading.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18.x or higher
- **Helius API Key**: Required for asset indexing and reliable RPC access. [Get one here](https://dev.helius.xyz/).

### Local Environment Setup

1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd solblaze
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env.local` file in the root directory:
   ```env
   NEXT_PUBLIC_HELIUS_API_KEY="your-helius-api-key"
   NEXT_PUBLIC_CUSTODIAL_WALLET_ADDRESS="your-custodial-wallet-pubkey"
   CUSTODIAL_WALLET_PRIVATE_KEY="your-custodial-wallet-private-key"
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```

### Unity Build Placement

To ensure the game loads correctly, place your Unity WebGL build files inside the `public/game/Build/` directory. The application is configured to look for the loader, framework, data, and wasm files in this subfolder to avoid conflicts with Next.js routing.

---

## 🏗 Project Structure

- `src/app`: Next.js 15 App Router pages and layouts.
- `src/components`: Reusable UI components (Modals, Dropdowns, Asset Cards).
- `src/contexts`: React Contexts for Wallet and Network state management.
- `src/lib`: Core logic for Solana transactions, Helius asset loading, and Unity bridging.
- `src/types`: TypeScript definitions for blockchain assets and API responses.
- `public/game`: Target directory for Unity WebGL build assets.

---

## 🛡 Security & Best Practices

- **Private Keys**: Server-side secrets are managed via non-prefixed environment variables to prevent client-side exposure.
- **RPC Resiliency**: The app implements fallback mechanisms for read-only RPC calls to ensure high availability.
- **Transaction Safety**: All mutations require explicit wallet approval and provide feedback via transaction signatures.
