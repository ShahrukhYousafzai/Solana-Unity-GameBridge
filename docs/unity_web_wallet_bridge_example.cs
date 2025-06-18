
using UnityEngine;
using System.Runtime.InteropServices; // Required for DllImport

/// <summary>
/// This script acts as a bridge between C# in Unity and JavaScript functions
/// defined in a .jslib file (e.g., UnityWebBridge.jslib).
/// It uses DllImport to declare external JavaScript functions and provides
/// C# wrapper methods to call them.
///
/// To use:
/// 1. Ensure you have a .jslib file (e.g., UnityWebBridge.jslib) in your
///    Unity Project's Assets/Plugins/WebGL/ folder. This .jslib file should
///    define the JavaScript functions being imported (e.g., JsConnectWallet).
/// 2. Attach this WebWalletBridge.cs script to a GameObject in your scene
///    (e.g., the same GameObject as GameBridgeManager or a dedicated one).
/// 3. Other C# scripts can then call the public methods of this bridge,
///    for example: WebWalletBridge.Instance.BridgeConnectWallet();
/// </summary>
public class WebWalletBridge : MonoBehaviour
{
    // --- Singleton Instance ---
    private static WebWalletBridge _instance;
    public static WebWalletBridge Instance
    {
        get
        {
            if (_instance == null)
            {
                _instance = FindObjectOfType<WebWalletBridge>();
                if (_instance == null)
                {
                    GameObject go = new GameObject("WebWalletBridge_AutoCreated");
                    _instance = go.AddComponent<WebWalletBridge>();
                    Debug.LogWarning("WebWalletBridge instance was not found in scene, auto-created one. Ensure a WebWalletBridge object exists in your scene.");
                }
            }
            return _instance;
        }
    }

    void Awake()
    {
        if (_instance == null)
        {
            _instance = this;
            // Optional: DontDestroyOnLoad(gameObject); // If this bridge should persist across scenes
        }
        else if (_instance != this)
        {
            Debug.LogWarning("Another instance of WebWalletBridge found, destroying this one.");
            Destroy(gameObject);
        }
    }

    // --- Wallet Connection ---
    [DllImport("__Internal")]
    private static extern void JsConnectWallet();
    public void BridgeConnectWallet()
    {
        Debug.Log("[WebWalletBridge C#] Calling JsConnectWallet...");
        JsConnectWallet();
    }

    [DllImport("__Internal")]
    private static extern int JsIsWalletConnected(); // Returns 0 for false, 1 for true
    public bool BridgeIsWalletConnected()
    {
        int result = JsIsWalletConnected();
        Debug.Log($"[WebWalletBridge C#] JsIsWalletConnected returned: {result}");
        return result == 1;
    }

    [DllImport("__Internal")]
    private static extern string JsGetPublicKey();
    public string BridgeGetPublicKey()
    {
        string pk = JsGetPublicKey();
        Debug.Log($"[WebWalletBridge C#] JsGetPublicKey returned: {pk}");
        return pk;
    }

    [DllImport("__Internal")]
    private static extern void JsDisconnectWallet();
    public void BridgeDisconnectWallet()
    {
        Debug.Log("[WebWalletBridge C#] Calling JsDisconnectWallet...");
        JsDisconnectWallet();
    }

    [DllImport("__Internal")]
    private static extern string JsGetAvailableWallets(); // Returns a JSON string
    public string BridgeGetAvailableWallets()
    {
        string walletsJson = JsGetAvailableWallets();
        Debug.Log($"[WebWalletBridge C#] JsGetAvailableWallets returned: {walletsJson}");
        return walletsJson;
    }

    [DllImport("__Internal")]
    private static extern void JsSelectWallet(string walletName);
    public void BridgeSelectWallet(string walletName)
    {
        Debug.Log($"[WebWalletBridge C#] Calling JsSelectWallet with wallet: {walletName}");
        JsSelectWallet(walletName);
    }


    // --- Asset Fetching ---
    // These will trigger JavaScript to fetch data and send it back via SendMessage
    // to your GameBridgeManager (or equivalent).
    [DllImport("__Internal")]
    private static extern void JsGetUserNFTs();
    public void BridgeGetUserNFTs()
    {
        Debug.Log("[WebWalletBridge C#] Calling JsGetUserNFTs. Expect result via SendMessage.");
        JsGetUserNFTs();
    }

    [DllImport("__Internal")]
    private static extern void JsGetUserTokens();
    public void BridgeGetUserTokens()
    {
        Debug.Log("[WebWalletBridge C#] Calling JsGetUserTokens. Expect result via SendMessage.");
        JsGetUserTokens();
    }

    [DllImport("__Internal")]
    private static extern void JsGetSolBalance();
    public void BridgeGetSolBalance()
    {
        Debug.Log("[WebWalletBridge C#] Calling JsGetSolBalance. Expect result via SendMessage.");
        JsGetSolBalance();
    }


    // --- Asset Operations ---
    // These will trigger JavaScript to perform transactions and send results back via SendMessage.
    [DllImport("__Internal")]
    private static extern void JsTransferSOL(double amountSol, string toAddress);
    public void BridgeTransferSOL(double amountSol, string toAddress)
    {
        Debug.Log($"[WebWalletBridge C#] Calling JsTransferSOL: Amount={amountSol}, To={toAddress}");
        JsTransferSOL(amountSol, toAddress);
    }

    [DllImport("__Internal")]
    private static extern void JsTransferToken(string mint, double amount, string toAddress);
    public void BridgeTransferToken(string mint, double amount, string toAddress)
    {
        Debug.Log($"[WebWalletBridge C#] Calling JsTransferToken: Mint={mint}, Amount={amount}, To={toAddress}");
        JsTransferToken(mint, amount, toAddress);
    }

    [DllImport("__Internal")]
    private static extern void JsTransferNFT(string mint, string toAddress);
    public void BridgeTransferNFT(string mint, string toAddress)
    {
        Debug.Log($"[WebWalletBridge C#] Calling JsTransferNFT: Mint={mint}, To={toAddress}");
        JsTransferNFT(mint, toAddress);
    }

    [DllImport("__Internal")]
    private static extern void JsBurnSOL(double amountSol);
    public void BridgeBurnSOL(double amountSol)
    {
        Debug.Log($"[WebWalletBridge C#] Calling JsBurnSOL: Amount={amountSol}");
        JsBurnSOL(amountSol);
    }

    [DllImport("__Internal")]
    private static extern void JsBurnNFT(string mint, double amount); // For NFTs, 'amount' is typically 1. For SPL tokens, actual amount.
    public void BridgeBurnAsset(string mint, double amount = 1) // Default amount to 1 for NFTs
    {
        Debug.Log($"[WebWalletBridge C#] Calling JsBurnNFT (for asset): Mint={mint}, Amount={amount}");
        JsBurnNFT(mint, amount);
    }

    [DllImport("__Internal")]
    private static extern void JsMintNFT(string name, string symbol, string metadataUri);
    public void BridgeMintNFT(string name, string symbol, string metadataUri)
    {
        Debug.Log($"[WebWalletBridge C#] Calling JsMintNFT: Name={name}, Symbol={symbol}, URI={metadataUri}");
        JsMintNFT(name, symbol, metadataUri);
    }

    [DllImport("__Internal")]
    private static extern void JsSwapTokens(); // Placeholder, actual implementation needed in JS
    public void BridgeSwapTokens()
    {
        Debug.Log("[WebWalletBridge C#] Calling JsSwapTokens (Placeholder).");
        JsSwapTokens();
    }

    // --- Custodial Operations ---
    [DllImport("__Internal")]
    private static extern void JsDepositFunds(string tokenMintOrSol, double amount);
    public void BridgeDepositFunds(string tokenMintOrSol, double amount)
    {
        Debug.Log($"[WebWalletBridge C#] Calling JsDepositFunds: Asset={tokenMintOrSol}, Amount={amount}");
        JsDepositFunds(tokenMintOrSol, amount);
    }

    [DllImport("__Internal")]
    private static extern void JsWithdrawFunds(string tokenMintOrSol, double grossAmount);
    public void BridgeWithdrawFunds(string tokenMintOrSol, double grossAmount)
    {
        Debug.Log($"[WebWalletBridge C#] Calling JsWithdrawFunds: Asset={tokenMintOrSol}, GrossAmount={grossAmount}");
        JsWithdrawFunds(tokenMintOrSol, grossAmount);
    }

    // --- Network Configuration ---
    [DllImport("__Internal")]
    private static extern void JsSetNetwork(string network); // e.g., "mainnet-beta", "devnet"
    public void BridgeSetNetwork(string network)
    {
        Debug.Log($"[WebWalletBridge C#] Calling JsSetNetwork: Network={network}");
        JsSetNetwork(network);
    }

    [DllImport("__Internal")]
    private static extern string JsGetCurrentNetwork();
    public string BridgeGetCurrentNetwork()
    {
        string network = JsGetCurrentNetwork();
        Debug.Log($"[WebWalletBridge C#] JsGetCurrentNetwork returned: {network}");
        return network;
    }

    void Start()
    {
        Debug.Log("[WebWalletBridge C#] WebWalletBridge Started. Instance is set up.");
    }
}

