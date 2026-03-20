# 🚀 Solana Unity GameBridge

**Solana Unity GameBridge** is a high-performance, React-based middleware solution designed to seamlessly bridge the gap between Solana's blockchain ecosystem and Unity WebGL games. It provides a robust, professional UI for asset management and a bi-directional communication layer for real-time game interactions.

---

## 📸 Screenshots

| Main Page | Wallet Connect |
| :---: | :---: |
| ![Main Page](https://i.ibb.co/v4XQChxd/Screenshot-2026-03-20-at-10-42-44-AM.png) | ![Wallet Connect](https://i.ibb.co/whZXVn6c/Screenshot-2026-03-20-at-10-42-52-AM.png) |

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

- [x] **Wallet Connectivity**: Full support for Phantom, Solflare, and Backpack with `autoConnect`.
- [x] **Multi-Network Support**: Seamless switching between Mainnet-Beta, Devnet, and Testnet.
- [x] **Smart Asset Indexing**: Real-time loading of NFTs, Compressed NFTs (cNFTs), and SPL Tokens via Helius.
- [x] **Resilient Balance Fetching**: Optimized SOL balance retrieval with automatic public RPC fallbacks.
- [x] **Bidirectional Communication**: Instant message passing between React and Unity.
- [x] **Asset Operations**: Transfer, Burn, Deposit, and Withdraw (with automated tax calculation).

---

## 🎮 Unity Integration & Wiring Guide

The bridge exposes a global API via the `window` object that Unity can call using `Application.ExternalEval`.

### 1. The React-to-Unity API (Global Handlers)

Unity scripts can trigger these functions directly:

| Function | Description |
| :--- | :--- |
| `window.handleConnectWalletRequest(name?)` | Opens the wallet modal or connects a specific wallet (e.g., "Phantom"). |
| `window.handleGetUserNFTsRequest()` | Fetches all NFTs/cNFTs and sends them back to Unity via `OnUserNFTsRequested`. |
| `window.handleGetUserTokensRequest()` | Fetches all SPL Tokens and SOL balance, sending them via `OnUserTokensRequested`. |
| `window.handleGetSolBalanceRequest()` | Returns the current SOL balance. |
| `window.handleTransferNFTRequest(mint, to)` | Initiates an NFT transfer. |
| `window.handleWithdrawFundsRequest(mint, amount)`| Initiates a withdrawal from the custodial wallet. |
| `window.handleDisconnectWalletRequest()` | Disconnects the current wallet. |

### 2. Calling from Unity (C#)

```csharp
// Example: Requesting the wallet list
public void RequestWallets() {
    #if !UNITY_EDITOR && UNITY_WEBGL
        Application.ExternalEval("window.handleGetAvailableWalletsRequest()");
    #endif
}

// Example: Sending SOL
public void SendSol(string toAddress, float amount) {
    #if !UNITY_EDITOR && UNITY_WEBGL
        Application.ExternalEval($"window.handleTransferSOLRequest({amount}, '{toAddress}')");
    #endif
}
```

### 3. Receiving Data in Unity

Your Unity game must have a GameObject named **`GameBridgeManager`** with a script containing these methods:

```csharp
public class GameBridgeManager : MonoBehaviour {
    // Called when the wallet connects
    public void OnWalletConnected(string json) {
        // json: { "publicKey": "..." }
    }

    // Called when NFTs are loaded
    public void OnUserNFTsRequested(string json) {
        // Parse the list of NFTs and cNFTs here
    }

    // Called for transaction status
    public void OnTransactionSubmitting(string json) {
        // Show loading spinner in Unity
    }
}
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.x+
- **Helius API Key**: [Get one here](https://dev.helius.xyz/).

### Local Environment Setup

1. **Install dependencies**: `npm install`
2. **Configure `.env.local`**:
   ```env
   NEXT_PUBLIC_HELIUS_API_KEY="your-api-key"
   NEXT_PUBLIC_CUSTODIAL_WALLET_ADDRESS="your-custodial-pubkey"
   CUSTODIAL_WALLET_PRIVATE_KEY="your-private-key"
   ```
3. **Run**: `npm run dev`