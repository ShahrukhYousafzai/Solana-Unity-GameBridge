
using UnityEngine;
using System; // Required for Action

// If you want to parse JSON, you might use Unity's JsonUtility or a library like Newtonsoft.Json.
// For JsonUtility, you'd define C# classes/structs matching the JSON structure.

public class GameManager : MonoBehaviour
{
    // --- Singleton Instance ---
    private static GameManager _instance;
    public static GameManager Instance
    {
        get
        {
            if (_instance == null)
            {
                _instance = FindObjectOfType<GameManager>();
                if (_instance == null)
                {
                    GameObject go = new GameObject("GameManager_AutoCreated");
                    _instance = go.AddComponent<GameManager>();
                    Debug.LogWarning("[GameManager C#] GameManager instance was not found in scene, auto-created one. Ensure a GameManager object exists in your scene.");
                }
            }
            return _instance;
        }
    }

    // --- Wallet Connection Events ---
    public event Action<string> OnWalletConnectedEvent;
    public event Action<string> OnWalletDisconnectedEvent;
    public event Action<string> OnWalletSelectionNeededEvent;
    public event Action<string> OnWalletConnectionErrorEvent;
    public event Action<string> OnWalletConnectionStatusEvent;
    public event Action<string> OnPublicKeyReceivedEvent;
    public event Action<string> OnAvailableWalletsReceivedEvent;
    public event Action<string> OnWalletSelectAttemptedEvent;

    // --- Asset & Balance Events ---
    public event Action<string> OnAssetsLoadingStateChangedEvent;
    public event Action<string> OnSolBalanceUpdatedEvent;
    public event Action<string> OnSolBalanceUpdateFailedEvent;
    public event Action<string> OnAssetsLoadedEvent;
    public event Action<string> OnHeliusWarningEvent;
    public event Action<string> OnAssetsLoadFailedEvent;
    public event Action<string> OnUserNFTsRequestedEvent;
    public event Action<string> OnUserTokensRequestedEvent;

    // --- Transaction Events ---
    public event Action<string> OnTransactionSubmittingEvent;
    public event Action<string> OnTransactionSubmittedEvent;
    public event Action<string> OnTransactionErrorEvent;
    public event Action<string> OnWithdrawalResponseEvent;

    // --- Network Events ---
    public event Action<string> OnNetworkChangedEvent;
    public event Action<string> OnCurrentNetworkReceivedEvent;

    // --- Unity Lifecycle Events from Web ---
    public event Action<string> OnUnityReadyEvent; // jsonData is usually empty {}
    public event Action<string> OnUnityLoadErrorEvent;

    // --- WebGL Context Events ---
    public event Action<string> OnWebGLContextLostEvent; // jsonData is usually empty {}
    public event Action<string> OnWebGLContextRestoredEvent; // jsonData is usually empty {}


    void Awake()
    {
        if (_instance == null)
        {
            _instance = this;
            // Optional: DontDestroyOnLoad(gameObject); // If GameManager should persist
        }
        else if (_instance != this)
        {
            Debug.LogWarning("[GameManager C#] Another instance of GameManager found, destroying this one.");
            Destroy(gameObject);
        }
    }

    // --- Wallet Connection Callbacks (invoked by Unity's SendMessage) ---
    public void OnWalletConnected(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWalletConnected received: {jsonData}");
        OnWalletConnectedEvent?.Invoke(jsonData);
        // Expected JSON: {"publicKey":"USER_WALLET_ADDRESS_STRING"}
    }

    public void OnWalletDisconnected(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWalletDisconnected received: {jsonData}");
        OnWalletDisconnectedEvent?.Invoke(jsonData);
        // Expected JSON: {} (empty object)
    }

    public void OnWalletSelectionNeeded(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWalletSelectionNeeded received: {jsonData}");
        OnWalletSelectionNeededEvent?.Invoke(jsonData);
        // Expected JSON: {"message":"Please select a wallet using the Connect Wallet button on the page."} or similar if modal opens
    }

    public void OnWalletConnectionError(string jsonData)
    {
        Debug.LogWarning($"[GameManager C#] OnWalletConnectionError received: {jsonData}");
        OnWalletConnectionErrorEvent?.Invoke(jsonData);
        // Expected JSON: {"error":"Error message string", "details":"optional details", "action":"action_that_failed"}
    }

    public void OnWalletConnectionStatus(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWalletConnectionStatus received: {jsonData}");
        OnWalletConnectionStatusEvent?.Invoke(jsonData);
        // Expected JSON: {"isConnected":true/false, "publicKey":"USER_WALLET_ADDRESS_STRING_OR_NULL"}
    }

    public void OnPublicKeyReceived(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnPublicKeyReceived received: {jsonData}");
        OnPublicKeyReceivedEvent?.Invoke(jsonData);
        // Expected JSON: {"publicKey":"USER_WALLET_ADDRESS_STRING_OR_NULL"}
    }

    public void OnAvailableWalletsReceived(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnAvailableWalletsReceived received: {jsonData}");
        OnAvailableWalletsReceivedEvent?.Invoke(jsonData);
        // Expected JSON: {"wallets":[{"name":"Phantom","icon":"...","readyState":"Installed"}, ...]}
    }
    
    public void OnWalletSelectAttempted(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWalletSelectAttempted received: {jsonData}");
        OnWalletSelectAttemptedEvent?.Invoke(jsonData);
        // Expected JSON: {"walletName":"Selected Wallet Name"}
    }

    // --- Asset & Balance Callbacks ---
    public void OnAssetsLoadingStateChanged(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnAssetsLoadingStateChanged received: {jsonData}");
        OnAssetsLoadingStateChangedEvent?.Invoke(jsonData);
        // Expected JSON: {"isLoading":true/false}
    }

    public void OnSolBalanceUpdated(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnSolBalanceUpdated received: {jsonData}");
        OnSolBalanceUpdatedEvent?.Invoke(jsonData);
        // Expected JSON: {"solBalance":123.45}
    }

    public void OnSolBalanceUpdateFailed(string jsonData)
    {
        Debug.LogWarning($"[GameManager C#] OnSolBalanceUpdateFailed received: {jsonData}");
        OnSolBalanceUpdateFailedEvent?.Invoke(jsonData);
        // Expected JSON: {"error":"Error message string"}
    }
    
    public void OnAssetsLoaded(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnAssetsLoaded received: {jsonData}");
        OnAssetsLoadedEvent?.Invoke(jsonData);
        // Expected JSON: {"nfts":[...],"cnfts":[...],"tokens":[...],"solBalance":...}
    }

    public void OnHeliusWarning(string jsonData)
    {
        Debug.LogWarning($"[GameManager C#] OnHeliusWarning received: {jsonData}");
        OnHeliusWarningEvent?.Invoke(jsonData);
        // Expected JSON: {"warning":"Warning message string", "isError":true/false }
    }

    public void OnAssetsLoadFailed(string jsonData)
    {
        Debug.LogError($"[GameManager C#] OnAssetsLoadFailed received: {jsonData}");
        OnAssetsLoadFailedEvent?.Invoke(jsonData);
        // Expected JSON: {"error":"Error message string"}
    }

    public void OnUserNFTsRequested(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnUserNFTsRequested received: {jsonData}");
        OnUserNFTsRequestedEvent?.Invoke(jsonData);
        // Expected JSON: {"error":"optional_error_string", "nfts":[...],"cnfts":[...]}
    }

    public void OnUserTokensRequested(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnUserTokensRequested received: {jsonData}");
        OnUserTokensRequestedEvent?.Invoke(jsonData);
        // Expected JSON: {"error":"optional_error_string", "tokens":[...],"solBalance":...}
    }

    // --- Transaction Callbacks ---
    public void OnTransactionSubmitting(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnTransactionSubmitting received: {jsonData}");
        OnTransactionSubmittingEvent?.Invoke(jsonData);
        // Expected JSON: {"action":"action_name", "submitting":true/false, "mint":"optional_mint_string", "tokenMint":"optional_token_mint_string"}
    }

    public void OnTransactionSubmitted(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnTransactionSubmitted received: {jsonData}");
        OnTransactionSubmittedEvent?.Invoke(jsonData);
        // Expected JSON: {"action":"action_name", "signature":"TX_SIGNATURE", "explorerUrl":"URL_TO_EXPLORER", ...other_optional_fields}
    }

    public void OnTransactionError(string jsonData)
    {
        Debug.LogError($"[GameManager C#] OnTransactionError received: {jsonData}");
        OnTransactionErrorEvent?.Invoke(jsonData);
        // Expected JSON: {"action":"action_name", "error":"Error message string", ...other_optional_fields}
    }
    
    public void OnWithdrawalResponse(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWithdrawalResponse received: {jsonData}");
        OnWithdrawalResponseEvent?.Invoke(jsonData);
        // Expected JSON: {"success":true/false, "message":"...", "signature":"optional_tx_sig", "action":"withdraw_funds", "tokenMint":"...", "explorerUrl":"optional_url"}
    }

    // --- Network Callbacks ---
    public void OnNetworkChanged(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnNetworkChanged received: {jsonData}");
        OnNetworkChangedEvent?.Invoke(jsonData);
        // Expected JSON: {"network":"devnet"} // or "mainnet-beta", "testnet"
    }

    public void OnCurrentNetworkReceived(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnCurrentNetworkReceived received: {jsonData}");
        OnCurrentNetworkReceivedEvent?.Invoke(jsonData);
        // Expected JSON: {"network":"devnet"}
    }

    // --- Unity Lifecycle Callbacks from Web ---
    public void OnUnityReady(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnUnityReady (from web) received: {jsonData}");
        OnUnityReadyEvent?.Invoke(jsonData);
        // This message means the JavaScript bridge (window.unityBridge or jslib functions) is set up and ready.
    }

    public void OnUnityLoadError(string jsonData)
    {
        Debug.LogError($"[GameManager C#] OnUnityLoadError received: {jsonData}");
        OnUnityLoadErrorEvent?.Invoke(jsonData);
        // Expected JSON: {"error":"Error message string"}
    }

    // --- WebGL Context Callbacks ---
    public void OnWebGLContextLost(string jsonData)
    {
        Debug.LogWarning($"[GameManager C#] OnWebGLContextLost received: {jsonData}");
        OnWebGLContextLostEvent?.Invoke(jsonData);
        // Expected JSON: {}
    }

    public void OnWebGLContextRestored(string jsonData)
    {
        Debug.Log($"[GameManager C#] OnWebGLContextRestored received: {jsonData}");
        OnWebGLContextRestoredEvent?.Invoke(jsonData);
        // Expected JSON: {}
    }

    // --- Example data structures for JSON parsing (using Unity's JsonUtility) ---
    /*
    [System.Serializable]
    public class WalletData { public string publicKey; }
    [System.Serializable]
    public class AssetLoadingData { public bool isLoading; }
    [System.Serializable]
    public class SolBalanceData { public float solBalance; }
    // Add more structures as needed for other events...
    
    // Example subscription in another script:
    // void Start() {
    //     if (GameManager.Instance != null) {
    //         GameManager.Instance.OnWalletConnectedEvent += HandleWalletConnected;
    //     }
    // }
    // void OnDestroy() {
    //     if (GameManager.Instance != null) {
    //         GameManager.Instance.OnWalletConnectedEvent -= HandleWalletConnected;
    //     }
    // }
    // private void HandleWalletConnected(string jsonData) {
    //     Debug.Log("AnotherScript: Wallet Connected! Data: " + jsonData);
    //     try {
    //         WalletData data = JsonUtility.FromJson<WalletData>(jsonData);
    //         if (data != null) {
    //             Debug.Log("AnotherScript: Parsed publicKey: " + data.publicKey);
    //         }
    //     } catch (Exception e) {
    //         Debug.LogError("AnotherScript: Failed to parse WalletConnected JSON: " + e.Message);
    //     }
    // }
    */

    void Start()
    {
        Debug.Log("[GameManager C#] GameManager Started. Instance is set up. Waiting for OnUnityReady from web.");
        // Avoid calling bridge functions here directly until OnUnityReady is received,
        // or ensure the web page is fully loaded if making calls immediately.
    }
}
