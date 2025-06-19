
using System.Collections;
using PlayFab;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

// You'll need a WebWalletBridge script in your project that contains
// the DllImport declarations for the .jslib functions and public methods
// to call them, accessible via WebWalletBridge.Instance or similar.
// For example:
// public class WebWalletBridge : MonoBehaviour {
//     public static WebWalletBridge Instance { get; private set; }
//     private void Awake() { /* Singleton logic */ }
//
//     [System.Runtime.InteropServices.DllImport("__Internal")]
//     private static extern void JsConnectWallet();
//     public void BridgeConnectWallet() => JsConnectWallet();
//
//     [System.Runtime.InteropServices.DllImport("__Internal")]
//     private static extern void JsDisconnectWallet();
//     public void BridgeDisconnectWallet() => JsDisconnectWallet();
//     // ... other bridge methods
// }


public class MainMenuManager : MonoBehaviour
{
    public Button connectButton;
    public GameObject LoadingPanel;
    public Slider loadingSlider;
    public GameObject LobbyPanel;
    public Image CurrentSelectedCarImage;
    public ItemSelect caritemSelect; // Assuming ItemSelect is a defined class
    public static MainMenuManager Instance;
    public TMP_Text UserProfileNameText;
    public GameObject walletConnectPanel;

    public string _publicKey = "";
    private bool _isWalletConnected = false;

    // Helper class for parsing JSON from wallet events
    [System.Serializable]
    private class WalletPublicKeyData
    {
        public string publicKey;
    }
    [System.Serializable]
    private class WalletErrorData
    {
        public string error;
        // Add other fields if your error JSON from JS is more complex
    }


    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
        else if (Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        // DontDestroyOnLoad(gameObject); // Optional: if MainMenuManager should persist
    }

    void Start()
    {
        UpdateSelectedCar();

        if (PlayerPrefs.HasKey("WalletAddress"))
        {
            _publicKey = PlayerPrefs.GetString("WalletAddress");
            UserProfileNameText.text = FormatWalletAddress(_publicKey);
            _isWalletConnected = true; 
            if(connectButton) connectButton.gameObject.SetActive(false); 
            StartCoroutine(ShowGameMenu(true)); 
        } else {
            StartCoroutine(ShowGameMenu(false)); 
        }

        if (GameBridgeManager.Instance != null)
        {
            GameBridgeManager.Instance.OnWalletConnectedEvent += HandleWalletConnected;
            GameBridgeManager.Instance.OnWalletDisconnectedEvent += HandleWalletDisconnected;
            GameBridgeManager.Instance.OnWalletConnectionErrorEvent += HandleWalletError;
        }
        else
        {
            Debug.LogError("MainMenuManager: GameBridgeManager.Instance is null in Start(). Ensure GameBridgeManager is in the scene and initialized before MainMenuManager.");
        }
    }

    private void OnDestroy()
    {
        if (GameBridgeManager.Instance != null)
        {
            GameBridgeManager.Instance.OnWalletConnectedEvent -= HandleWalletConnected;
            GameBridgeManager.Instance.OnWalletDisconnectedEvent -= HandleWalletDisconnected;
            GameBridgeManager.Instance.OnWalletConnectionErrorEvent -= HandleWalletError;
        }
    }

    public void UpdateSelectedCar()
    {
        if (caritemSelect != null && caritemSelect.itemIcons != null && caritemSelect.itemIcons.Length > 0)
        {
            int selectedCarIndex = PlayerPrefs.GetInt("SelectedCar", 0);
            if (selectedCarIndex >= 0 && selectedCarIndex < caritemSelect.itemIcons.Length)
            {
                CurrentSelectedCarImage.sprite = caritemSelect.itemIcons[selectedCarIndex];
            }
            else
            {
                Debug.LogWarning("SelectedCar index out of bounds. Defaulting to 0.");
                CurrentSelectedCarImage.sprite = caritemSelect.itemIcons[0];
                PlayerPrefs.SetInt("SelectedCar",0);
            }
        }
        else
        {
            Debug.LogError("caritemSelect or its itemIcons are not properly assigned in MainMenuManager.");
        }
    }

    public void ConnectWallet()
    {
        Debug.Log("MainMenuManager: ConnectWallet called. Attempting via WebWalletBridge.");
        if (WebWalletBridge.Instance != null)
        {
            WebWalletBridge.Instance.BridgeConnectWallet();
        }
        else
        {
            Debug.LogError("WebWalletBridge.Instance is null. Cannot connect wallet.");
            ToastNotification.Show("Wallet bridge not ready.", "error"); 
            return;
        }
        if(LoadingPanel) LoadingPanel.SetActive(true);
    }

    private void HandleWalletConnected(string jsonData)
    {
        Debug.Log("MainMenuManager: HandleWalletConnected JSON Data: " + jsonData);
        WalletPublicKeyData data = null;
        try {
            data = JsonUtility.FromJson<WalletPublicKeyData>(jsonData);
        } catch (System.Exception e) {
            Debug.LogError($"MainMenuManager: Failed to parse WalletConnected JSON: {e.Message}. JSON was: {jsonData}");
            HandleWalletError("Internal error processing connection data.");
            return;
        }


        if (data == null || string.IsNullOrEmpty(data.publicKey))
        {
            Debug.LogError("MainMenuManager: Parsed publicKey is null or empty from JSON: " + jsonData);
            HandleWalletError("Failed to retrieve public key on connection.");
            return;
        }

        _publicKey = data.publicKey;
        _isWalletConnected = true;
        UserProfileNameText.text = FormatWalletAddress(_publicKey);

        PlayFabClientAPI.LoginWithCustomID(new PlayFab.ClientModels.LoginWithCustomIDRequest
        {
            CustomId = _publicKey, 
            CreateAccount = true
        }, result =>
        {
            if(connectButton) connectButton.gameObject.SetActive(false);
            ToastNotification.Show($"Connected: {FormatWalletAddress(_publicKey)}", "success");
            PlayerPrefs.SetString("WalletAddress", _publicKey);
            StartCoroutine(ShowGameMenu(true)); 
        }, error =>
        {
            Debug.LogError("MainMenuManager: PlayFab Login Error: " + error.GenerateErrorReport());
            ToastNotification.Show($"PlayFab Login Failed: {error.ErrorMessage}", "error");
            Logout(); 
        });
    }

    private void HandleWalletDisconnected(string jsonData) 
    {
        Debug.Log("MainMenuManager: HandleWalletDisconnected. JSON Data: " + jsonData);
        _isWalletConnected = false;
        _publicKey = "";
        Logout(); 
        ToastNotification.Show("Wallet disconnected.", "info");
    }

    private void HandleWalletError(string jsonData)
    {
        Debug.LogError("MainMenuManager: HandleWalletError JSON Data: " + jsonData);
        string errorMessage = "An unknown wallet error occurred.";
        try {
            if (jsonData.StartsWith("{") && jsonData.EndsWith("}")) {
                 WalletErrorData errorData = JsonUtility.FromJson<WalletErrorData>(jsonData);
                 if (errorData != null && !string.IsNullOrEmpty(errorData.error)) {
                     errorMessage = errorData.error;
                 }
            } else if (!string.IsNullOrEmpty(jsonData)) {
                errorMessage = jsonData; 
            }
        } catch (System.Exception e) {
             Debug.LogWarning($"MainMenuManager: Could not parse error JSON, using raw data. Error: {e.Message}. JSON was: {jsonData}");
             if (!string.IsNullOrEmpty(jsonData)) errorMessage = jsonData;
        }

        ToastNotification.Show($"Wallet error: {errorMessage}", "error");
        if(LoadingPanel) LoadingPanel.SetActive(false);
    }

    private string FormatWalletAddress(string address)
    {
        if (string.IsNullOrEmpty(address) || address.Length < 8)
            return address;
        return $"{address.Substring(0, 4)}...{address.Substring(address.Length - 4)}";
    }

    IEnumerator ShowGameMenu(bool fetchAssets)
    {
        if (fetchAssets && _isWalletConnected && !string.IsNullOrEmpty(_publicKey))
        {
            RequestUserAssetsFromBridge(); 
        }
        
        if (loadingSlider != null) {
            float duration = 3f;
            float elapsed = 0f;
            while (elapsed < duration)
            {
                loadingSlider.value = Mathf.Lerp(0, 100, elapsed / duration);
                elapsed += Time.deltaTime;
                yield return null;
            }
            loadingSlider.value = 100;
        }


        yield return new WaitForSeconds(0.5f);
        if(LoadingPanel) LoadingPanel.SetActive(false);
        if(LobbyPanel) LobbyPanel.SetActive(true);
        if(walletConnectPanel) walletConnectPanel.SetActive(false); 
    }

    private void RequestUserAssetsFromBridge()
    {
        if (WebWalletBridge.Instance != null)
        {
            if (_isWalletConnected && !string.IsNullOrEmpty(_publicKey))
            {
                Debug.Log("MainMenuManager: Requesting user assets (NFTs and Tokens) from bridge.");
                WebWalletBridge.Instance.BridgeGetUserNFTs(); 
                WebWalletBridge.Instance.BridgeGetUserTokens(); 
            }
            else
            {
                Debug.LogWarning("MainMenuManager: Cannot request assets - wallet not connected or public key is missing.");
            }
        }
        else
        {
            Debug.LogError("MainMenuManager: WebWalletBridge.Instance is null. Cannot request assets.");
        }
    }

    public void Logout()
    {
        Debug.Log("MainMenuManager: Logout called. Attempting via WebWalletBridge.");
        if (WebWalletBridge.Instance != null)
        {
            WebWalletBridge.Instance.BridgeDisconnectWallet();
        }
        else
        {
            Debug.LogError("WebWalletBridge.Instance is null. Cannot disconnect wallet properly via bridge.");
        }

        PlayerPrefs.DeleteKey("WalletAddress");
        _publicKey = "";
        _isWalletConnected = false;

        UserProfileNameText.text = "Guest";
        if(connectButton) connectButton.gameObject.SetActive(true);
        if(LobbyPanel) LobbyPanel.SetActive(false);
        if(walletConnectPanel) walletConnectPanel.SetActive(true);

        PlayFabClientAPI.ForgetAllCredentials();
        ToastNotification.Show("Logged out.", "info");
    }
}
