
using UnityEngine;
// If you want to parse JSON, you might use Unity's JsonUtility or a library like Newtonsoft.Json.
// For JsonUtility, you'd define C# classes/structs matching the JSON structure.

public class GameManager : MonoBehaviour
{
    // --- Wallet Connection Callbacks ---

    public void OnWalletConnected(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWalletConnected received: {jsonData}");
        // Expected JSON: {"publicKey":"USER_WALLET_ADDRESS_STRING"}
        // Example parsing (using a hypothetical helper or JsonUtility):
        // var data = JsonUtility.FromJson<WalletConnectedData>(jsonData);
        // Debug.Log($"Wallet connected: {data.publicKey}");
    }

    public void OnWalletDisconnected(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWalletDisconnected received: {jsonData}");
        // Expected JSON: {} (empty object)
    }

    public void OnWalletSelectionNeeded(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWalletSelectionNeeded received: {jsonData}");
        // Expected JSON: {"message":"Please select a wallet using the Connect Wallet button on the page."}
        // Inform the user in-game.
    }

    public void OnWalletConnectionError(string jsonData)
    {
        Debug.LogWarning($"[GameManager C#] OnWalletConnectionError received: {jsonData}");
        // Expected JSON: {"error":"Error message string", "details":"optional details", "action":"action_that_failed"}
    }

    public void OnWalletConnectionStatus(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWalletConnectionStatus received: {jsonData}");
        // Expected JSON: {"isConnected":true/false, "publicKey":"USER_WALLET_ADDRESS_STRING_OR_NULL"}
    }

    public void OnPublicKeyReceived(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnPublicKeyReceived received: {jsonData}");
        // Expected JSON: {"publicKey":"USER_WALLET_ADDRESS_STRING_OR_NULL"}
    }

    public void OnAvailableWalletsReceived(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnAvailableWalletsReceived received: {jsonData}");
        // Expected JSON: {"wallets":[{"name":"Phantom","icon":"...","readyState":"Installed"}, ...]}
        // You might want to display these options to the user if they need to select a wallet type.
    }
    
    public void OnWalletSelectAttempted(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWalletSelectAttempted received: {jsonData}");
        // Expected JSON: {"walletName":"Selected Wallet Name"}
    }

    // --- Asset & Balance Callbacks ---

    public void OnAssetsLoadingStateChanged(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnAssetsLoadingStateChanged received: {jsonData}");
        // Expected JSON: {"isLoading":true/false}
        // Update your game's UI to show/hide a loading indicator.
    }

    public void OnSolBalanceUpdated(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnSolBalanceUpdated received: {jsonData}");
        // Expected JSON: {"solBalance":123.45}
    }

    public void OnSolBalanceUpdateFailed(string jsonData)
    {
        Debug.LogWarning($"[GameManager C#] OnSolBalanceUpdateFailed received: {jsonData}");
        // Expected JSON: {"error":"Error message string"}
    }
    
    public void OnAssetsLoaded(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnAssetsLoaded received: {jsonData}");
        // Expected JSON: {"nfts":[...],"cnfts":[...],"tokens":[...],"solBalance":...}
        // Parse this data to update your game's inventory.
        // Note: The structure of Nft, CNft, SplToken needs to be defined in C# for JsonUtility
        // or handled by a more flexible JSON parser.
    }

    public void OnHeliusWarning(string jsonData)
    {
        Debug.LogWarning($"[GameManager C#] OnHeliusWarning received: {jsonData}");
        // Expected JSON: {"warning":"Warning message string", "isError":true/false }
    }

    public void OnAssetsLoadFailed(string jsonData)
    {
        Debug.LogError($"[GameManager C#] OnAssetsLoadFailed received: {jsonData}");
        // Expected JSON: {"error":"Error message string"}
    }

    public void OnUserNFTsRequested(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnUserNFTsRequested received: {jsonData}");
        // Expected JSON: {"error":"optional_error_string", "nfts":[...],"cnfts":[...]}
    }

    public void OnUserTokensRequested(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnUserTokensRequested received: {jsonData}");
        // Expected JSON: {"error":"optional_error_string", "tokens":[...],"solBalance":...}
    }

    // --- Transaction Callbacks ---

    public void OnTransactionSubmitting(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnTransactionSubmitting received: {jsonData}");
        // Expected JSON: {"action":"action_name", "submitting":true/false, "mint":"optional_mint_string", "tokenMint":"optional_token_mint_string"}
        // Show a "processing" indicator in your game.
    }

    public void OnTransactionSubmitted(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnTransactionSubmitted received: {jsonData}");
        // Expected JSON: {"action":"action_name", "signature":"TX_SIGNATURE", "explorerUrl":"URL_TO_EXPLORER", ...other_optional_fields}
        // Inform the user of success, maybe provide a link to the explorer.
    }

    public void OnTransactionError(string jsonData)
    {
        Debug.LogError($"[GameManager C#] OnTransactionError received: {jsonData}");
        // Expected JSON: {"action":"action_name", "error":"Error message string", ...other_optional_fields}
        // Inform the user of the failure.
    }
    
    public void OnWithdrawalResponse(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWithdrawalResponse received: {jsonData}");
        // Expected JSON: {"success":true/false, "message":"...", "signature":"optional_tx_sig", "action":"withdraw_funds", "tokenMint":"...", "explorerUrl":"optional_url"}
    }

    // --- Network Callbacks ---

    public void OnNetworkChanged(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnNetworkChanged received: {jsonData}");
        // Expected JSON: {"network":"devnet"} // or "mainnet-beta", "testnet"
    }

    public void OnCurrentNetworkReceived(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnCurrentNetworkReceived received: {jsonData}");
        // Expected JSON: {"network":"devnet"}
    }

    // --- Unity Lifecycle Callbacks from Web ---
    public void OnUnityReady(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnUnityReady (from web) received: {jsonData}");
        // This message means the JavaScript bridge (window.unityBridge) is set up and ready.
        // You can now safely make calls from Unity to JavaScript using the .jslib functions.
        // For example, you might want to automatically try to connect or fetch initial data here.
    }

    public void OnUnityLoadError(string jsonData)
    {
        Debug.LogError($"[GameManager C#] OnUnityLoadError received: {jsonData}");
        // Expected JSON: {"error":"Error message string"}
        // Handle critical Unity load failures.
    }

    // --- WebGL Context Callbacks ---
    public void OnWebGLContextLost(string jsonData)
    {
        Debug.LogWarning($"[GameManager C#] OnWebGLContextLost received: {jsonData}");
        // Expected JSON: {}
        // You might need to pause game logic or inform the user.
    }

    public void OnWebGLContextRestored(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWebGLContextRestored received: {jsonData}");
        // Expected JSON: {}
        // Resume game logic. You might need to re-initialize some WebGL related resources if they were lost.
    }

    // --- Helper for parsing (Example - You'll need to define these data structures) ---
    /*
    [System.Serializable]
    public class WalletConnectedData
    {
        public string publicKey;
    }

    [System.Serializable]
    public class AssetData // Placeholder
    {
        public string id;
        public string name;
        // Add other fields based on Nft, CNft, SplToken types in your page.tsx
    }

    [System.Serializable]
    public class AssetsLoadedData
    {
        public AssetData[] nfts;
        public AssetData[] cnfts;
        public AssetData[] tokens; // Define SplTokenData if different
        public float solBalance;
    }
    */

    void Start()
    {
        Debug.Log("[GameManager C#] GameManager Started. Waiting for OnUnityReady from web.");
        // Avoid calling bridge functions here directly, wait for OnUnityReady or user action.
    }
}

    