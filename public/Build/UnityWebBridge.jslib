
// UnityWebBridge.jslib
// This file provides the JavaScript implementations for functions declared in C# via DllImport.
// These functions will bridge calls from Unity (C#) to the main React/Next.js page (window.handle...Request functions).

mergeInto(LibraryManager.library, {
  // --- Wallet Connection ---
  JsConnectWallet: function() {
    try {
      if (window.handleConnectWalletRequest && typeof window.handleConnectWalletRequest === 'function') {
        console.log("[UnityWebBridge.jslib] Calling window.handleConnectWalletRequest()");
        window.handleConnectWalletRequest();
      } else {
        console.error("[UnityWebBridge.jslib] window.handleConnectWalletRequest is not defined or not a function on the window.");
      }
    } catch (e) {
      console.error("[UnityWebBridge.jslib] Error in JsConnectWallet calling window.handleConnectWalletRequest:", e);
    }
  },

  JsIsWalletConnected: function() {
    try {
      if (window.handleIsWalletConnectedRequest && typeof window.handleIsWalletConnectedRequest === 'function') {
        console.log("[UnityWebBridge.jslib] Calling window.handleIsWalletConnectedRequest()");
        return window.handleIsWalletConnectedRequest() ? 1 : 0;
      } else {
        console.error("[UnityWebBridge.jslib] window.handleIsWalletConnectedRequest is not defined or not a function on the window.");
        return 0; // Default to false (0)
      }
    } catch (e) {
      console.error("[UnityWebBridge.jslib] Error in JsIsWalletConnected calling window.handleIsWalletConnectedRequest:", e);
      return 0; // Default to false (0) on error
    }
  },

  JsGetPublicKey: function() {
    try {
      if (window.handleGetPublicKeyRequest && typeof window.handleGetPublicKeyRequest === 'function') {
        console.log("[UnityWebBridge.jslib] Calling window.handleGetPublicKeyRequest()");
        const pk = window.handleGetPublicKeyRequest();
        if (pk) {
          const buffer = stringToNewUTF8(pk);
          return buffer;
        }
        return null;
      } else {
        console.error("[UnityWebBridge.jslib] window.handleGetPublicKeyRequest is not defined or not a function on the window.");
        return null;
      }
    } catch (e) {
      console.error("[UnityWebBridge.jslib] Error in JsGetPublicKey calling window.handleGetPublicKeyRequest:", e);
      return null;
    }
  },

  JsDisconnectWallet: function() {
    try {
      if (window.handleDisconnectWalletRequest && typeof window.handleDisconnectWalletRequest === 'function') {
        console.log("[UnityWebBridge.jslib] Calling window.handleDisconnectWalletRequest()");
        window.handleDisconnectWalletRequest();
      } else {
        console.error("[UnityWebBridge.jslib] window.handleDisconnectWalletRequest is not defined or not a function on the window.");
      }
    } catch (e) {
      console.error("[UnityWebBridge.jslib] Error in JsDisconnectWallet calling window.handleDisconnectWalletRequest:", e);
    }
  },

  JsGetAvailableWallets: function() {
    try {
      if (window.handleGetAvailableWalletsRequest && typeof window.handleGetAvailableWalletsRequest === 'function') {
        console.log("[UnityWebBridge.jslib] Calling window.handleGetAvailableWalletsRequest()");
        const wallets = window.handleGetAvailableWalletsRequest(); // Expects JSON string or object
        const walletsJson = typeof wallets === 'string' ? wallets : JSON.stringify(wallets || []);
        const buffer = stringToNewUTF8(walletsJson);
        return buffer;
      } else {
        console.error("[UnityWebBridge.jslib] window.handleGetAvailableWalletsRequest is not defined or not a function on the window.");
        return stringToNewUTF8("[]");
      }
    } catch (e) {
      console.error("[UnityWebBridge.jslib] Error in JsGetAvailableWallets calling window.handleGetAvailableWalletsRequest:", e);
      return stringToNewUTF8("[]");
    }
  },

  JsSelectWallet: function(walletNamePointer) {
    const walletName = UTF8ToString(walletNamePointer);
    try {
      if (window.handleSelectWalletRequest && typeof window.handleSelectWalletRequest === 'function') {
        console.log(`[UnityWebBridge.jslib] Calling window.handleSelectWalletRequest with wallet: ${walletName}`);
        window.handleSelectWalletRequest(walletName);
      } else {
        console.error("[UnityWebBridge.jslib] window.handleSelectWalletRequest is not defined or not a function on the window.");
      }
    } catch (e) {
      console.error(`[UnityWebBridge.jslib] Error in JsSelectWallet (calling window.handleSelectWalletRequest for ${walletName}):`, e);
    }
  },

  // --- Asset Fetching ---
  JsGetUserNFTs: function() {
    try {
      if (window.handleGetUserNFTsRequest && typeof window.handleGetUserNFTsRequest === 'function') {
        console.log("[UnityWebBridge.jslib] Calling window.handleGetUserNFTsRequest()");
        window.handleGetUserNFTsRequest(); // This is async, Unity receives data via SendMessage from React
      } else {
        console.error("[UnityWebBridge.jslib] window.handleGetUserNFTsRequest is not defined or not a function on the window.");
      }
    } catch (e) {
      console.error("[UnityWebBridge.jslib] Error in JsGetUserNFTs calling window.handleGetUserNFTsRequest:", e);
    }
  },

  JsGetUserTokens: function() {
    try {
      if (window.handleGetUserTokensRequest && typeof window.handleGetUserTokensRequest === 'function') {
        console.log("[UnityWebBridge.jslib] Calling window.handleGetUserTokensRequest()");
        window.handleGetUserTokensRequest(); // Async, data via SendMessage
      } else {
        console.error("[UnityWebBridge.jslib] window.handleGetUserTokensRequest is not defined or not a function on the window.");
      }
    } catch (e) {
      console.error("[UnityWebBridge.jslib] Error in JsGetUserTokens calling window.handleGetUserTokensRequest:", e);
    }
  },

  JsGetSolBalance: function() {
    try {
      if (window.handleGetSolBalanceRequest && typeof window.handleGetSolBalanceRequest === 'function') {
        console.log("[UnityWebBridge.jslib] Calling window.handleGetSolBalanceRequest()");
        // This function in React now returns a Promise<number>, JSLib cannot directly return async result here.
        // React will send the balance back via SendMessageToUnity when it resolves.
        // For a synchronous JSLib call, this function can't return the actual balance.
        // If Unity *needs* a sync return, the React side must cache it and this JSLib returns the cache.
        // For now, assuming React sends it back via SendMessage and this JSLib returns 0 as placeholder.
        window.handleGetSolBalanceRequest(); // Trigger the fetch
        return 0; // Placeholder. Actual value comes via event.
      } else {
        console.error("[UnityWebBridge.jslib] window.handleGetSolBalanceRequest is not defined or not a function on the window.");
        return 0;
      }
    } catch (e) {
      console.error("[UnityWebBridge.jslib] Error in JsGetSolBalance calling window.handleGetSolBalanceRequest:", e);
      return 0;
    }
  },

  // --- Asset Operations ---
  JsTransferSOL: function(amountSol, toAddressPointer) {
    const toAddress = UTF8ToString(toAddressPointer);
    try {
      if (window.handleTransferSOLRequest && typeof window.handleTransferSOLRequest === 'function') {
        console.log(`[UnityWebBridge.jslib] Calling window.handleTransferSOLRequest: Amount=${amountSol}, To=${toAddress}`);
        window.handleTransferSOLRequest(amountSol, toAddress);
      } else {
        console.error("[UnityWebBridge.jslib] window.handleTransferSOLRequest is not defined or not a function.");
      }
    } catch (e) {
      console.error(`[UnityWebBridge.jslib] Error in JsTransferSOL (calling for ${amountSol} SOL to ${toAddress}):`, e);
    }
  },

  JsTransferToken: function(mintPointer, amount, toAddressPointer) {
    const mint = UTF8ToString(mintPointer);
    const toAddress = UTF8ToString(toAddressPointer);
    try {
      if (window.handleTransferTokenRequest && typeof window.handleTransferTokenRequest === 'function') {
        console.log(`[UnityWebBridge.jslib] Calling window.handleTransferTokenRequest: Mint=${mint}, Amount=${amount}, To=${toAddress}`);
        window.handleTransferTokenRequest(mint, amount, toAddress);
      } else {
        console.error("[UnityWebBridge.jslib] window.handleTransferTokenRequest is not defined or not a function.");
      }
    } catch (e) {
      console.error(`[UnityWebBridge.jslib] Error in JsTransferToken (calling for ${amount} of ${mint} to ${toAddress}):`, e);
    }
  },

  JsTransferNFT: function(mintPointer, toAddressPointer) {
    const mint = UTF8ToString(mintPointer);
    const toAddress = UTF8ToString(toAddressPointer);
    try {
      if (window.handleTransferNFTRequest && typeof window.handleTransferNFTRequest === 'function') {
        console.log(`[UnityWebBridge.jslib] Calling window.handleTransferNFTRequest: Mint=${mint}, To=${toAddress}`);
        window.handleTransferNFTRequest(mint, toAddress);
      } else {
        console.error("[UnityWebBridge.jslib] window.handleTransferNFTRequest is not defined or not a function.");
      }
    } catch (e) {
      console.error(`[UnityWebBridge.jslib] Error in JsTransferNFT (calling for ${mint} to ${toAddress}):`, e);
    }
  },

  JsBurnSOL: function(amountSol) {
    try {
      if (window.handleBurnSOLRequest && typeof window.handleBurnSOLRequest === 'function') {
        console.log(`[UnityWebBridge.jslib] Calling window.handleBurnSOLRequest: Amount=${amountSol}`);
        window.handleBurnSOLRequest(amountSol);
      } else {
        console.error("[UnityWebBridge.jslib] window.handleBurnSOLRequest is not defined or not a function.");
      }
    } catch (e) {
      console.error(`[UnityWebBridge.jslib] Error in JsBurnSOL (calling for ${amountSol} SOL):`, e);
    }
  },

  // Renamed from JsBurnAsset back to JsBurnNFT to match C# DllImport
  JsBurnNFT: function(mintPointer, amount) { // 'amount' is typically 1 for NFTs, or actual amount for SPL tokens if this func is reused.
    const mint = UTF8ToString(mintPointer);
    try {
      if (window.handleBurnAssetRequest && typeof window.handleBurnAssetRequest === 'function') {
        console.log(`[UnityWebBridge.jslib] Calling window.handleBurnAssetRequest (via JsBurnNFT): Mint=${mint}, Amount=${amount}`);
        window.handleBurnAssetRequest(mint, amount); // React's handleBurnAssetRequest can differentiate by asset type
      } else {
        console.error("[UnityWebBridge.jslib] window.handleBurnAssetRequest is not defined or not a function.");
      }
    } catch (e) {
      console.error(`[UnityWebBridge.jslib] Error in JsBurnNFT (calling window.handleBurnAssetRequest for ${mint}, Amount ${amount}):`, e);
    }
  },

  JsMintNFT: function(namePointer, symbolPointer, metadataUriPointer) {
    const name = UTF8ToString(namePointer);
    const symbol = UTF8ToString(symbolPointer);
    const metadataUri = UTF8ToString(metadataUriPointer);
    try {
      if (window.handleMintNFTRequest && typeof window.handleMintNFTRequest === 'function') {
        console.log(`[UnityWebBridge.jslib] Calling window.handleMintNFTRequest: Name=${name}, Symbol=${symbol}, URI=${metadataUri}`);
        window.handleMintNFTRequest(name, symbol, metadataUri);
      } else {
        console.error("[UnityWebBridge.jslib] window.handleMintNFTRequest is not defined or not a function.");
      }
    } catch (e) {
      console.error(`[UnityWebBridge.jslib] Error in JsMintNFT (calling for ${name}):`, e);
    }
  },

  JsSwapTokens: function() { // Placeholder
    try {
      if (window.handleSwapTokensRequest && typeof window.handleSwapTokensRequest === 'function') {
        console.log("[UnityWebBridge.jslib] Calling window.handleSwapTokensRequest (Placeholder).");
        window.handleSwapTokensRequest();
      } else {
        console.error("[UnityWebBridge.jslib] window.handleSwapTokensRequest is not defined or not a function.");
      }
    } catch (e) {
      console.error("[UnityWebBridge.jslib] Error in JsSwapTokens:", e);
    }
  },

  // --- Custodial Operations ---
  JsDepositFunds: function(tokenMintOrSolPointer, amount) {
    const tokenMintOrSol = UTF8ToString(tokenMintOrSolPointer);
    try {
      if (window.handleDepositFundsRequest && typeof window.handleDepositFundsRequest === 'function') {
        console.log(`[UnityWebBridge.jslib] Calling window.handleDepositFundsRequest: Asset=${tokenMintOrSol}, Amount=${amount}`);
        window.handleDepositFundsRequest(tokenMintOrSol, amount);
      } else {
        console.error("[UnityWebBridge.jslib] window.handleDepositFundsRequest is not defined or not a function.");
      }
    } catch (e) {
      console.error(`[UnityWebBridge.jslib] Error in JsDepositFunds (calling for ${tokenMintOrSol}, Amount ${amount}):`, e);
    }
  },

  JsWithdrawFunds: function(tokenMintOrSolPointer, grossAmount) {
    const tokenMintOrSol = UTF8ToString(tokenMintOrSolPointer);
    try {
      if (window.handleWithdrawFundsRequest && typeof window.handleWithdrawFundsRequest === 'function') {
        console.log(`[UnityWebBridge.jslib] Calling window.handleWithdrawFundsRequest: Asset=${tokenMintOrSol}, GrossAmount=${grossAmount}`);
        window.handleWithdrawFundsRequest(tokenMintOrSol, grossAmount);
      } else {
        console.error("[UnityWebBridge.jslib] window.handleWithdrawFundsRequest is not defined or not a function.");
      }
    } catch (e) {
      console.error(`[UnityWebBridge.jslib] Error in JsWithdrawFunds (calling for ${tokenMintOrSol}, GrossAmount ${grossAmount}):`, e);
    }
  },

  // --- Network Configuration ---
  JsSetNetwork: function(networkPointer) {
    const network = UTF8ToString(networkPointer);
    try {
      if (window.handleSetNetworkRequest && typeof window.handleSetNetworkRequest === 'function') {
        console.log(`[UnityWebBridge.jslib] Calling window.handleSetNetworkRequest: Network=${network}`);
        window.handleSetNetworkRequest(network);
      } else {
        console.error("[UnityWebBridge.jslib] window.handleSetNetworkRequest is not defined or not a function.");
      }
    } catch (e) {
      console.error(`[UnityWebBridge.jslib] Error in JsSetNetwork (calling for ${network}):`, e);
    }
  },

  JsGetCurrentNetwork: function() {
    try {
      if (window.handleGetCurrentNetworkRequest && typeof window.handleGetCurrentNetworkRequest === 'function') {
        console.log("[UnityWebBridge.jslib] Calling window.handleGetCurrentNetworkRequest()");
        const network = window.handleGetCurrentNetworkRequest(); // Expects string return
        const buffer = stringToNewUTF8(network || "devnet"); // Default to devnet if null/undefined
        return buffer;
      } else {
        console.error("[UnityWebBridge.jslib] window.handleGetCurrentNetworkRequest is not defined or not a function.");
        return stringToNewUTF8("devnet"); // Default to devnet
      }
    } catch (e) {
      console.error("[UnityWebBridge.jslib] Error in JsGetCurrentNetwork calling window.handleGetCurrentNetworkRequest:", e);
      return stringToNewUTF8("devnet"); // Default to devnet on error
    }
  }
});
