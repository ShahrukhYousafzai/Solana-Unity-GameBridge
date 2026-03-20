# 🚀 Solana Unity GameBridge

**Solana Unity GameBridge** is a high-performance, React-based middleware solution designed to seamlessly bridge the gap between Solana's blockchain ecosystem and Unity WebGL games. It provides a robust, professional UI for asset management and a bi-directional communication layer for real-time game interactions.

---

## 📸 Screenshots

| Dashboard Overview | Asset Management |
| :---: | :---: |
| ![Dashboard Overview](https://i.ibb.co/v4XQChxd/Screenshot-2026-03-20-at-10-42-44-AM.png) | ![Asset Management](https://i.ibb.co/whZXVn6c/Screenshot-2026-03-20-at-10-42-52-AM.png) |

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
- [x] **Asset Operations**: Transfer, Burn, Deposit, and Withdraw (with automated tax calculation).
- [x] **Professional UI**: Fully responsive, dark-mode themed interface using ShadCN components.

---

## 🎮 Unity Integration Guide

To wire your Unity game with the bridge, follow these patterns for communication.

### 1. Setup in Unity
Create an empty GameObject in your scene named `GameBridgeManager`. Attach a C# script to it to handle incoming messages from the bridge.

### 2. Calling React from Unity (C#)
Unity calls the bridge using `Application.ExternalCall` or a `.jslib` plugin that invokes the global `window` handlers defined in `src/app/page.tsx`.

```csharp
// Example: Requesting a wallet connection
public void ConnectWallet() {
    #if !UNITY_EDITOR && UNITY_WEBGL
        Application.ExternalEval("window.handleConnectWalletRequest()");
    #endif
}

// Example: Fetching user NFTs
public void GetNFTs() {
    #if !UNITY_EDITOR && UNITY_WEBGL
        Application.ExternalEval("window.handleGetUserNFTsRequest()");
    #endif
}

// Example: Initiating a withdrawal
public void Withdraw(string mint, float amount) {
    #if !UNITY_EDITOR && UNITY_WEBGL
        Application.ExternalEval($"window.handleWithdrawFundsRequest('{mint}', {amount})");
    #endif
}
```

### 3. Handling Bridge Messages in Unity
The bridge sends JSON messages back to the `GameBridgeManager` GameObject.

```csharp
using UnityEngine;
using System;

[Serializable]
public class WalletData { public string publicKey; }

public class GameBridgeManager : MonoBehaviour {
    
    // Called when the wallet connects
    public void OnWalletConnected(string json) {
        WalletData data = JsonUtility.FromJson<WalletData>(json);
        Debug.Log("Wallet Connected: " + data.publicKey);
        // Trigger game logic (e.g., load profile)
    }

    // Called when assets are loaded
    public void OnAssetsLoaded(string json) {
        // Parse the complex asset JSON (NFTs, Tokens, etc.)
        // Update your game inventory
    }

    // Called during transaction processing
    public void OnTransactionSubmitting(string json) {
        // Show a "Processing..." spinner in Unity UI
    }
}
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18.x or higher
- **Helius API Key**: Required for asset indexing. [Get one here](https://dev.helius.xyz/).

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

---

## 🏗 Project Structure

- `src/app`: Next.js 15 App Router pages and layouts.
- `src/components`: Reusable UI components (Modals, Dropdowns, Asset Cards).
- `src/contexts`: React Contexts for Wallet and Network state management.
- `src/lib`: Core logic for Solana transactions and Helius asset loading.
- `public/game`: Target directory for Unity WebGL build assets.

---

## 🛡 Security & Best Practices

- **Private Keys**: Server-side secrets are managed via non-prefixed environment variables.
- **RPC Resiliency**: Automatic fallback to public RPCs for balance checks.
- **Transaction Safety**: All mutations require explicit wallet approval.