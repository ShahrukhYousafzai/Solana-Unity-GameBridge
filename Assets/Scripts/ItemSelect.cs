
using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;
using TMPro;
using System;
using System.Collections;
// Removed: using Solana.Unity.SDK;
// Removed: using Solana.Unity.Wallet;
// Removed: using Solana.Unity.Rpc.Core.Http;
// Removed: using System.Threading.Tasks;
// Removed: using UnityEngine.Networking; // Assuming UnityWebRequest is no longer used for Helius directly

public enum ItemType
{
    Level,
    Car
}

// New data structures for parsing JSON from the bridge
[System.Serializable]
public class BridgeAssetCollectionPayload
{
    public List<BridgeUnityCNft> cnfts;
    public List<BridgeUnityNft> nfts; // Standard NFTs if also needed
    // Add tokens and solBalance if ItemSelect needs them
}

[System.Serializable]
public class BridgeUnityAssetBase
{
    public string id;
    public string name;
    public string imageUrl;
    public string symbol; // Optional
    // public string uri; // Optional
    // public BridgeUnityCreator[] creators; // Optional
}

[System.Serializable]
public class BridgeUnityNft : BridgeUnityAssetBase
{
    public BridgeUnityCollection collection;
    // public bool isVerifiedCollection;
}

[System.Serializable]
public class BridgeUnityCNft : BridgeUnityAssetBase
{
    public BridgeUnityCollection collection;
    // public bool isVerifiedCollection;
}

[System.Serializable]
public class BridgeUnityCollection
{
    public string id;
    public string name;
}

// [System.Serializable]
// public class BridgeUnityCreator
// {
//     public string address;
//     public bool verified;
//     public int share;
// }

[System.Serializable]
public class BridgeTransactionResultPayload
{
    public string action; // e.g., "burn_asset", "transfer_nft"
    public string signature;
    public string explorerUrl;
    public string mint; // The ID of the asset involved in the transaction
    public string error; // Populated on error
    public string message; // Can be populated on error or for other info
    // public bool success; // This field was more for withdrawal, check 'error' field for general success
}


// Old Helius data structures - can be removed if direct Helius call is fully gone
// but parts might be useful if the new BridgeUnityCNft structure needs to be expanded based on rawHeliusAsset details.
// For now, commenting them out as the bridge sends simplified data.
/*
[System.Serializable]
public class HeliusResponse { ... }
[System.Serializable]
public class HeliusResult { ... }
[System.Serializable]
public class HeliusItem { ... }
// ... (rest of Helius specific classes) ...
*/


public class ItemSelect : MonoBehaviour
{
    public ItemType itemType;

    [Header("Icons")]
    public Sprite[] itemIcons;
    public Image currentItemImage;
    public Image prevItemImage;
    public Image nextItemImage;

    [Header("Current Item Animation")]
    public Animator currentAnimator;

    [Header("Sounds")]
    public AudioSource audioSource;
    public AudioClip okClip;
    public AudioClip errorClip;

    [Header("Texts")]
    public TMP_Text CurentValue;
    public TMP_Text coinsTXT;

    [Header("Windows")]
    public GameObject shopOffer;
    public GameObject lockIcon;
    public GameObject nextMen;

    public int[] itemsPrice;

    // NFT Ownership tracking
    private List<string> ownedCarNFTNames = new List<string>(); // Stores names of owned car NFTs (standard or cNFTs)
    private string ownerAddress = "";
    private const string carCollectionAddress = "qJhfDwLsjzjnjNw3Fz8ESji8zAWVWNP5AYDZXjxF1fd";
    private const string boosterCollectionAddress = "hUEKA85VywTT43c2s3Vd9Nsem1j1xTWbUPYLppY7Nzb";
    // Removed: private const string apiKey = "ce2bbb77-5585-4ce4-bfb3-8feb9860222a"; // API key is used on server/web page now
    private bool assetsInitialized = false; // Renamed from nftsFetched

    // Booster NFT System
    [Header("Booster NFT System")]
    public GameObject boosterNFTPrefab;
    public Transform scrollRectContent;
    private List<BridgeUnityCNft> ownedBoosterNFTs = new List<BridgeUnityCNft>(); // Changed type
    private Dictionary<string, Sprite> boosterSprites = new Dictionary<string, Sprite>();

    // Season management
    private DateTime seasonStartDate;
    private const int seasonLengthDays = 28;
    // private float currentBoostMultiplier = 1f; // This seems to be calculated dynamically

    // Top Speed System
    // private float currentTopSpeed = 100f; // This seems to be calculated dynamically

    [Header("Season UI")]
    public TMPro.TMP_Text seasonTimerTxt;
    public TMPro.TMP_Text boostPercentageTxt;
    public TMPro.TMP_Text topSpeedTxt;

    [Header("Debug")]
    public TMPro.TMP_Text debugText;

    [Header("NFT Burning")]
    public GameObject burnConfirmationPanel;
    public TMP_Text burnStatusText;
    // Removed: private const string BURN_ADDRESS = "1nc1nerator11111111111111111111111111111111"; // Burn address is handled by JS bridge now for cNFTs or SPL

    public Button PracticeButton;
    public Button MultiplayerButton;

    // WebGL fallback sprite
    [Header("WebGL Fallback")]
    public Sprite fallbackSprite;

    // Season timer tracking
    private float seasonTimerUpdateAccumulator;
    private const float seasonTimerUpdateInterval = 1.0f; // Update every second
    private DateTime? lastSeasonCheck;

    int id;
    bool canAnim;
    bool animaState;

    void Start()
    {
        if (PlayerPrefs.HasKey("WalletAddress"))
        {
            ownerAddress = PlayerPrefs.GetString("WalletAddress");
        }
        else
        {
            Debug.LogWarning("ItemSelect: WalletAddress not found in PlayerPrefs at Start. NFT functionalities might be limited until address is set.");
            // Potentially disable NFT related UI or show a "Connect Wallet" prompt
        }

        coinsTXT.text = PlayerPrefs.GetInt("Coins", 0).ToString();

        if (itemType == ItemType.Car)
            id = PlayerPrefs.GetInt("CarID", 0);
        if (itemType == ItemType.Level)
            id = PlayerPrefs.GetInt("LevelID", 0);

        if (itemIcons.Length > 0 && id < itemIcons.Length)
            currentItemImage.sprite = itemIcons[id];
        else if (itemIcons.Length > 0)
            currentItemImage.sprite = itemIcons[0]; // Fallback to first icon

        if (id != 0 && itemIcons.Length > 1)
        {
            PrevCar();
            NextCar();
        }
        else if (itemIcons.Length > 1)
        {
            NextCar();
            PrevCar();
        }

        canAnim = true;
        UpdateLockStatus(); // Initial lock status based on no NFTs fetched

        if (itemsPrice.Length > id)
            CurentValue.text = itemsPrice[id].ToString();
        else if (itemsPrice.Length > 0)
             CurentValue.text = itemsPrice[0].ToString();


        if (itemType == ItemType.Car)
        {
            InitializeSeason();
            // UpdateBoostMultiplier(); // Called within InitializeSeason and HandleAssetsLoaded
            StartCoroutine(InitializeAssets());
        }
        
        // Subscribe to GameBridgeManager events
        if (GameBridgeManager.Instance != null)
        {
            GameBridgeManager.Instance.OnAssetsLoadedEvent += HandleAssetsLoaded;
            GameBridgeManager.Instance.OnTransactionSubmittedEvent += HandleAssetBurnSuccess; // Assuming burn success uses this
            GameBridgeManager.Instance.OnTransactionErrorEvent += HandleAssetBurnError; // Assuming burn error uses this
        }
        else
        {
            Debug.LogError("ItemSelect: GameBridgeManager.Instance is null in Start. Asset and transaction events will not be handled.");
        }
    }

    void OnDestroy()
    {
        if (GameBridgeManager.Instance != null)
        {
            GameBridgeManager.Instance.OnAssetsLoadedEvent -= HandleAssetsLoaded;
            GameBridgeManager.Instance.OnTransactionSubmittedEvent -= HandleAssetBurnSuccess;
            GameBridgeManager.Instance.OnTransactionErrorEvent -= HandleAssetBurnError;
        }
    }
    
    IEnumerator InitializeAssets()
    {
        if (string.IsNullOrEmpty(ownerAddress))
        {
            Debug.LogWarning("ItemSelect: Owner address is empty, cannot fetch assets. Waiting for wallet connection.");
            yield break; // Or retry later, or wait for an event indicating wallet is connected
        }

        // Request assets via the bridge. The actual data will come via OnAssetsLoadedEvent.
        if (WebWalletBridge.Instance != null)
        {
            Debug.Log("ItemSelect: Requesting user assets (NFTs and Tokens) via bridge.");
            WebWalletBridge.Instance.BridgeGetUserNFTs(); // This could be a generic "GetAllAssets" if available
            WebWalletBridge.Instance.BridgeGetUserTokens(); // Or combine them
        }
        else
        {
            Debug.LogError("ItemSelect: WebWalletBridge.Instance is null. Cannot request assets.");
        }
        // assetsInitialized will be set to true in HandleAssetsLoaded
        yield return null; // Wait for events
    }


    void HandleAssetsLoaded(string jsonData)
    {
        Debug.Log("ItemSelect: Received OnAssetsLoadedEvent: " + jsonData);
        ownedCarNFTNames.Clear();
        ownedBoosterNFTs.Clear();

        try
        {
            BridgeAssetCollectionPayload payload = JsonUtility.FromJson<BridgeAssetCollectionPayload>(jsonData);

            if (payload != null)
            {
                if (payload.nfts != null) // Process standard NFTs (potentially for cars)
                {
                    foreach (BridgeUnityNft nft in payload.nfts)
                    {
                        if (nft.collection != null && nft.collection.id == carCollectionAddress)
                        {
                            if (!string.IsNullOrEmpty(nft.name))
                            {
                                ownedCarNFTNames.Add(nft.name);
                                Debug.Log($"Added owned car NFT: {nft.name}");
                            }
                        }
                    }
                }
                
                if (payload.cnfts != null) // Process cNFTs (for boosters and potentially cars if they are cNFTs)
                {
                    foreach (BridgeUnityCNft cnft in payload.cnfts)
                    {
                        if (cnft.collection != null)
                        {
                             if (cnft.collection.id == boosterCollectionAddress)
                             {
                                ownedBoosterNFTs.Add(cnft);
                                Debug.Log($"Added owned booster cNFT: {cnft.name} (ID: {cnft.id})");
                             }
                             else if (cnft.collection.id == carCollectionAddress) // If cars can also be cNFTs
                             {
                                 if (!string.IsNullOrEmpty(cnft.name))
                                 {
                                     ownedCarNFTNames.Add(cnft.name);
                                     Debug.Log($"Added owned car cNFT: {cnft.name}");
                                 }
                             }
                        }
                    }
                }
            }
        }
        catch (Exception e)
        {
            Debug.LogError("ItemSelect: JSON Parse Error in HandleAssetsLoaded: " + e.Message + "\nJSON: " + jsonData);
        }

        assetsInitialized = true;
        UpdateLockStatus();
        CreateBoosterUI(); // This also calls UpdateBoostMultiplier
        SaveNFTData(); // Save counts and effective boost
    }


    void InitializeSeason()
    {
        if (PlayerPrefs.HasKey("SeasonStartDate"))
        {
            long temp = Convert.ToInt64(PlayerPrefs.GetString("SeasonStartDate"));
            seasonStartDate = DateTime.FromBinary(temp);
            if ((DateTime.Now - seasonStartDate).TotalDays >= seasonLengthDays)
            {
                StartNewSeason();
            }
        }
        else
        {
            StartNewSeason();
        }

        // UpdateBoostMultiplier(); // Called by CreateBoosterUI after assets are processed
        UpdateTopSpeed();

        if (ShouldBurnExpiredNFTs())
        {
            StartCoroutine(BurnExpiredNFTs());
        }
    }

    bool ShouldBurnExpiredNFTs()
    {
        if (!PlayerPrefs.HasKey("LastBurnDate")) return true;
        long lastBurnBinary = Convert.ToInt64(PlayerPrefs.GetString("LastBurnDate"));
        DateTime lastBurnDate = DateTime.FromBinary(lastBurnBinary);
        return (DateTime.Now - lastBurnDate).TotalDays >= seasonLengthDays;
    }

    void StartNewSeason()
    {
        seasonStartDate = DateTime.Now;
        PlayerPrefs.SetString("SeasonStartDate", seasonStartDate.ToBinary().ToString());
        Debug.Log("New season started!");
        UpdateBoostMultiplier(); // Recalculate boost as season might affect it
    }

    IEnumerator BurnExpiredNFTs()
    {
        if (ownedBoosterNFTs.Count == 0)
        {
            PlayerPrefs.SetString("LastBurnDate", DateTime.Now.ToBinary().ToString());
            Debug.Log("No booster NFTs to burn for expired season.");
            yield break;
        }

        Debug.Log($"Starting to burn {ownedBoosterNFTs.Count} expired booster NFTs.");
        burnConfirmationPanel.SetActive(true);
        
        // Create a temporary list to iterate over, as ownedBoosterNFTs might be modified by event handlers
        List<BridgeUnityCNft> boostersToBurn = new List<BridgeUnityCNft>(ownedBoosterNFTs);

        foreach (BridgeUnityCNft booster in boostersToBurn)
        {
            if (burnStatusText != null)
            {
                burnStatusText.text = $"Requesting burn for: {booster.name}...";
                burnStatusText.color = Color.white;
            }
            Debug.Log($"Requesting burn for cNFT: {booster.name} (ID: {booster.id})");
            if (WebWalletBridge.Instance != null)
            {
                // Assuming BridgeBurnAsset handles both NFT and cNFT, amount 1 for non-fungibles
                WebWalletBridge.Instance.BridgeBurnAsset(booster.id, 1); 
            }
            else
            {
                Debug.LogError("WebWalletBridge.Instance is null. Cannot burn NFT.");
                if (burnStatusText != null)
                {
                    burnStatusText.text = $"Error: Bridge not ready.";
                    burnStatusText.color = Color.red;
                }
            }
            yield return new WaitForSeconds(1f); // Small delay between burn requests if needed, or wait for event
        }
        
        // Note: The actual removal from ownedBoosterNFTs and UI updates
        // will happen in HandleAssetBurnSuccess.
        // We set LastBurnDate after initiating all burns.
        PlayerPrefs.SetString("LastBurnDate", DateTime.Now.ToBinary().ToString());

        // The panel might be hidden by the event handlers after the last successful burn.
        // Consider a flag or counter if you want it to hide only after all are processed.
        // For now, let's assume individual burn messages are sufficient.
        // yield return new WaitForSeconds(3f); // This delay might be premature
        // burnConfirmationPanel.SetActive(false); // Let event handlers manage this better
    }

    void HandleAssetBurnSuccess(string jsonData)
    {
        Debug.Log("ItemSelect: HandleAssetBurnSuccess: " + jsonData);
        try
        {
            BridgeTransactionResultPayload result = JsonUtility.FromJson<BridgeTransactionResultPayload>(jsonData);
            if (result != null && result.action == "burn_asset" && !string.IsNullOrEmpty(result.mint))
            {
                Debug.Log($"Successfully burned asset: {result.mint} | TX: {result.signature}");
                if (burnStatusText != null)
                {
                    BridgeUnityCNft burnedBooster = ownedBoosterNFTs.Find(b => b.id == result.mint);
                    burnStatusText.text = $"Burned: {(burnedBooster != null ? burnedBooster.name : result.mint.Substring(0,6)+"...")}";
                    burnStatusText.color = Color.green;
                }
                ownedBoosterNFTs.RemoveAll(b => b.id == result.mint);
                
                // If all intended burns are done, update UI and potentially hide panel
                // This needs more logic if tracking multiple burns from BurnExpiredNFTs
                CreateBoosterUI(); // Refresh booster UI
                UpdateBoostMultiplier();
                SaveNFTData();

                // Optional: Hide burn panel if no more boosters are pending burn from the "expired" batch
                // This part is tricky without knowing if this is the *last* burn confirmation.
                // For now, let the user close it or it times out.
                // if (ownedBoosterNFTs.Count == 0 && burnConfirmationPanel.activeSelf) {
                //     StartCoroutine(DelayedHideBurnPanel(2f));
                // }
            }
        }
        catch (Exception e)
        {
            Debug.LogError("ItemSelect: Error parsing burn success JSON: " + e.Message);
        }
    }
    
    // IEnumerator DelayedHideBurnPanel(float delay)
    // {
    //     yield return new WaitForSeconds(delay);
    //     if (burnConfirmationPanel != null) burnConfirmationPanel.SetActive(false);
    // }

    void HandleAssetBurnError(string jsonData)
    {
        Debug.Log("ItemSelect: HandleAssetBurnError: " + jsonData);
        try
        {
            BridgeTransactionResultPayload result = JsonUtility.FromJson<BridgeTransactionResultPayload>(jsonData);
            if (result != null && result.action == "burn_asset")
            {
                Debug.LogError($"Failed to burn asset {result.mint}: {result.error} - {result.message}");
                if (burnStatusText != null)
                {
                    burnStatusText.text = $"Burn Failed: {result.mint?.Substring(0,6)+"..."} - {result.error}";
                    burnStatusText.color = Color.red;
                }
                // Don't remove from ownedBoosterNFTs on error, as it wasn't burned.
            }
        }
        catch (Exception e)
        {
            Debug.LogError("ItemSelect: Error parsing burn error JSON: " + e.Message);
        }
    }


    [ContextMenu("Force Season Reset (Testing)")]
    public void ForceSeasonResetForTesting()
    {
        Debug.Log("Forcing season reset for testing...");
        PlayerPrefs.DeleteKey("LastBurnDate");
        seasonStartDate = DateTime.Now.AddDays(-seasonLengthDays - 1); // Ensure season is definitely over
        PlayerPrefs.SetString("SeasonStartDate", seasonStartDate.ToBinary().ToString());

        // Clear current boosters and add some test ones
        ownedBoosterNFTs.Clear();
        for (int i = 0; i < 3; i++)
        {
            ownedBoosterNFTs.Add(new BridgeUnityCNft()
            {
                id = "TestcNFT_Booster_" + Guid.NewGuid().ToString(), // Unique ID for testing
                name = "Test Booster " + i,
                imageUrl = "https://placehold.co/100x100.png", // Placeholder image
                collection = new BridgeUnityCollection { id = boosterCollectionAddress, name = "Test Booster Collection" }
            });
        }
        Debug.Log($"Added {ownedBoosterNFTs.Count} test booster cNFTs");
        CreateBoosterUI(); // Update UI with test NFTs
        
        // Now check if they should be burned (they should)
        if (ShouldBurnExpiredNFTs())
        {
            StartCoroutine(BurnExpiredNFTs());
        }
    }

    void Update()
    {
        if (debugText != null)
        {
            int daysPassed = (int)(DateTime.Now - seasonStartDate).TotalDays;
            debugText.text = $"Owned Boosters: {ownedBoosterNFTs.Count}\n" +
                            // $"Multiplier: {currentBoostMultiplier:F2}x\n" + // currentBoostMultiplier is not a field
                            $"Season Day: {daysPassed + 1}\n" +
                            $"Base Speed: {CalculateTopSpeedForDay(daysPassed + 1)}%\n";
        }

        seasonTimerUpdateAccumulator += Time.deltaTime;
        if (seasonTimerUpdateAccumulator >= seasonTimerUpdateInterval)
        {
            seasonTimerUpdateAccumulator = 0;
            UpdateSeasonTimer();
        }
    }

    void UpdateSeasonTimer()
    {
        if (seasonTimerTxt == null) return;

        TimeSpan remaining = seasonStartDate.AddDays(seasonLengthDays) - DateTime.Now;
        if (remaining.TotalSeconds > 0)
        {
            seasonTimerTxt.text = $"Season ends in: {remaining.Days}d {remaining.Hours:00}h {remaining.Minutes:00}m";
        }
        else
        {
            seasonTimerTxt.text = "Season Ended";
        }


        if (lastSeasonCheck == null || (DateTime.Now - lastSeasonCheck.Value).TotalMinutes >= 1)
        {
            lastSeasonCheck = DateTime.Now;
            if (remaining.TotalSeconds <= 0)
            {
                if (!PlayerPrefs.HasKey("SeasonJustReset") || PlayerPrefs.GetInt("SeasonJustReset") == 0)
                {
                    PlayerPrefs.SetInt("SeasonJustReset", 1); // Flag to prevent multiple resets in short succession
                    Debug.Log("Season timer expired. Starting new season and burning expired NFTs.");
                    StartNewSeason(); // This will re-evaluate ShouldBurnExpiredNFTs
                    if (ShouldBurnExpiredNFTs()) // Check again after new season starts
                    {
                        StartCoroutine(BurnExpiredNFTs());
                    }
                    PlayerPrefs.SetInt("SeasonJustReset", 0); // Reset flag
                }
            }
        }
        UpdateTopSpeed();
    }

    void UpdateTopSpeed()
    {
        if (topSpeedTxt == null) return;

        int totalRacesCompleted = PlayerPrefs.GetInt("TotalRacesCompleted", 0);
        float baseTopSpeed = CalculateTopSpeedForDay((int)(DateTime.Now - seasonStartDate).TotalDays + 1); // Use current season day for base speed

        float effectiveBoost = GetEffectiveNFTBoost(totalRacesCompleted);
        float actualPower = baseTopSpeed + effectiveBoost;
        actualPower = Mathf.Max(0, actualPower); // Ensure power is not negative

        PlayerPrefs.SetFloat("CurrentTopSpeed", actualPower);
        PlayerPrefs.SetFloat("SpeedMultiplier", actualPower / 100f); // Assuming 100% is the reference for multiplier
        topSpeedTxt.text = $"Top Speed: {actualPower:F2}%";

        if (debugText != null)
        {
            int daysPassed = (int)(DateTime.Now - seasonStartDate).TotalDays;
            debugText.text = $"Owned Boosters: {ownedBoosterNFTs.Count}\n" +
                            $"Effective Boost: {effectiveBoost}%\n" +
                            $"Season Day: {daysPassed + 1}\n" +
                            $"Races Completed: {totalRacesCompleted}\n" +
                            $"Base Speed (Day {daysPassed + 1}): {baseTopSpeed:F2}%\n" +
                            $"Actual Power: {actualPower:F2}%";
        }
    }

    private float GetTotalNFTBoost() // This function seems to calculate max potential boost, not currently used for effective boost directly
    {
        int nftCount = ownedBoosterNFTs.Count;
        float totalBoost = 0f;
        if (nftCount >= 1) totalBoost += 10f;
        if (nftCount >= 2) totalBoost += 10f;
        if (nftCount >= 3) totalBoost += 10f;
        if (nftCount >= 4) totalBoost += 10f;
        if (nftCount >= 5) totalBoost += 35f;
        return totalBoost;
    }

    float CalculateTopSpeedForDay(int day)
    {
        day = Mathf.Max(1, day); // Ensure day is at least 1
        switch (day)
        {
            case 1: return 100f; case 2: return 98.75f; case 3: return 97.5f; case 4: return 96.25f;
            case 5: return 95f; case 6: return 93.75f; case 7: return 92.5f; case 8: return 91.25f;
            case 9: return 90f; case 10: return 88.75f; case 11: return 87.5f; case 12: return 86.25f;
            case 13: return 85f; case 14: return 83.75f; case 15: return 82.5f; case 16: return 81.25f;
            case 17: return 80f; case 18: return 78.75f; case 19: return 77.5f; case 20: return 76.25f;
            case 21: return 75f; case 22: return 73.75f; case 23: return 72.5f; case 24: return 71.25f;
            case 25: return 70f; case 26: return 68.75f; case 27: return 67.5f; case 28: return 66.25f;
            default: return Mathf.Max(0f, 66.25f - (day - 28) * 1.25f);
        }
    }

    void UpdateBoostMultiplier() // This updates the UI text for boost
    {
        if (boostPercentageTxt == null) return;
        int totalRacesCompleted = PlayerPrefs.GetInt("TotalRacesCompleted", 0);
        float effectiveBoost = GetEffectiveNFTBoost(totalRacesCompleted);

        if (effectiveBoost > 0)
        {
            boostPercentageTxt.text = $"+{effectiveBoost:F2}% Power";
        }
        else if (ownedBoosterNFTs.Count > 0)
        {
            int nextActivationRace = int.MaxValue;
            foreach (var kvp in nftActivationRaces)
            {
                if (kvp.Key <= ownedBoosterNFTs.Count && kvp.Value > totalRacesCompleted && kvp.Value < nextActivationRace)
                {
                    nextActivationRace = kvp.Value;
                }
            }
            if (nextActivationRace < int.MaxValue)
            {
                int racesUntilActivation = nextActivationRace - totalRacesCompleted;
                boostPercentageTxt.text = $"Boost in {racesUntilActivation} races";
            }
            else
            {
                boostPercentageTxt.text = "No Active Boost";
            }
        }
        else
        {
            boostPercentageTxt.text = "No Power Boost";
        }
    }

    // Removed FetchNFTs coroutine - handled by GameBridgeManager.OnAssetsLoadedEvent now

    // ProcessNFTResponse is now HandleAssetsLoaded

    void SaveNFTData()
    {
        PlayerPrefs.SetInt("OwnedBoosterNFTCount", ownedBoosterNFTs.Count); // Changed to save booster count
        int totalRaces = PlayerPrefs.GetInt("TotalRacesCompleted", 0);
        float effectiveBoost = GetEffectiveNFTBoost(totalRaces);
        PlayerPrefs.SetFloat("EffectiveNFTBoost", effectiveBoost);
        PlayerPrefs.Save(); // Good practice to call Save
        Debug.Log($"Saved NFT Data: Booster Count = {ownedBoosterNFTs.Count}, Effective Boost = {effectiveBoost}");
    }

    // GetCollectionAddress is now used within HandleAssetsLoaded

    void CreateBoosterUI()
    {
        foreach (Transform child in scrollRectContent)
        {
            Destroy(child.gameObject);
        }

        foreach (BridgeUnityCNft booster in ownedBoosterNFTs) // Changed type
        {
            GameObject boosterUI = Instantiate(boosterNFTPrefab, scrollRectContent);
            Image boosterImage = boosterUI.GetComponentInChildren<Image>(); // Assuming image is a child
            if(boosterImage == null) boosterImage = boosterUI.GetComponent<Image>(); // Fallback if image is on root

            string boosterName = booster.name;

            TMP_Text boosterNameText = boosterUI.GetComponentInChildren<TMP_Text>();
            if (boosterNameText != null)
            {
                boosterNameText.text = boosterName;
            }
            else Debug.LogWarning("Booster UI Prefab missing TMP_Text component for name.");


            Button boosterButton = boosterUI.GetComponent<Button>();
            if (boosterButton != null)
            {
                 // Remove all previous listeners to prevent multiple calls if UI is rebuilt
                boosterButton.onClick.RemoveAllListeners();
                boosterButton.onClick.AddListener(() =>
                {
                    ToastNotification.Show($"Booster: {boosterName}", "info"); // Changed to use standard toast
                    // If you want a burn button here, it would call:
                    // ShowBurnConfirmationFor(booster);
                });
            }
            else Debug.LogWarning("Booster UI Prefab missing Button component.");


            // COMMENTED OUT: Burning every NFT when UI is created is likely not intended.
            // Implement a separate button/mechanism for individual burns.
            // StartCoroutine(BurnNFT(booster.id)); 
            
            if (boosterImage != null)
            {
                StartCoroutine(LoadBoosterImage(booster, boosterImage));
            } else {
                 Debug.LogWarning($"Booster UI for {boosterName} missing Image component.");
            }
        }
        UpdateBoostMultiplier(); // Update text after UI is created/recreated
        SaveNFTData(); 
    }

    IEnumerator LoadBoosterImage(BridgeUnityCNft booster, Image targetImage) // Changed type
    {
        string imageUrl = booster.imageUrl;

        if (string.IsNullOrEmpty(imageUrl))
        {
            if (fallbackSprite != null) SetSpriteToTarget(targetImage, fallbackSprite);
            else Debug.LogWarning("Fallback sprite is not assigned.");
            yield break;
        }

        // Simple check for common placeholder services if direct image URL is not working well
        if (imageUrl.Contains("placehold.co") || imageUrl.Contains("via.placeholder.com")) {
             // These usually work fine, but good to be aware if issues arise
        }


        using (UnityEngine.Networking.UnityWebRequest imageRequest = UnityEngine.Networking.UnityWebRequestTexture.GetTexture(imageUrl))
        {
            // Removed: DownloadHandlerTexture texHandler = new DownloadHandlerTexture(true); // This is default now
            // Removed: imageRequest.downloadHandler = texHandler;

            yield return imageRequest.SendWebRequest();

            if (imageRequest.result == UnityEngine.Networking.UnityWebRequest.Result.Success)
            {
                Texture2D texture = UnityEngine.Networking.DownloadHandlerTexture.GetContent(imageRequest);
                if (texture != null)
                {
                    Sprite sprite = Sprite.Create(
                        texture,
                        new Rect(0, 0, texture.width, texture.height),
                        Vector2.one * 0.5f
                    );
                    SetSpriteToTarget(targetImage, sprite);

                    // Removed: if (!boosterSprites.ContainsKey(booster.name)) // boosterSprites dictionary seems unused elsewhere
                    // Removed: {
                    // Removed:     boosterSprites.Add(booster.name, sprite);
                    // Removed: }
                }
                else
                {
                    Debug.LogWarning($"Texture is null after downloading image: {imageUrl}");
                    if (fallbackSprite != null) SetSpriteToTarget(targetImage, fallbackSprite);
                }
            }
            else
            {
                Debug.LogWarning($"Failed to load booster image: {imageUrl}. Error: {imageRequest.error}");
                if (fallbackSprite != null) SetSpriteToTarget(targetImage, fallbackSprite);
            }
        }
    }


    void SetSpriteToTarget(Image target, Sprite sprite)
    {
        if (target == null) { Debug.LogError("SetSpriteToTarget: target Image is null."); return; }
        if (sprite == null) { Debug.LogError("SetSpriteToTarget: sprite is null."); return; }

        // This logic seems overly complex if the Image component is directly on boosterUI
        // or directly on a known child. Assuming 'targetImage' is the correct one.
        target.sprite = sprite;
    }

    bool IsNFTUnlocked(string carName) // This checks against standard car NFTs (ownedCarNFTNames)
    {
        // This logic now depends on how ownedCarNFTNames is populated from HandleAssetsLoaded
        // It currently stores names. Ensure names from NFT metadata match expected car names.
        foreach (string nftName in ownedCarNFTNames)
        {
            if (nftName.Equals(carName, System.StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    void UpdateLockStatus()
    {
        if (itemType == ItemType.Car && itemIcons.Length > id && id >= 0)
        {
            string currentCarName = itemIcons[id].name; // Assumes sprite names match car names for locking
            bool unlocked = assetsInitialized && IsNFTUnlocked(currentCarName);
            
            if(lockIcon != null) lockIcon.SetActive(!unlocked);

            if(PracticeButton != null) PracticeButton.interactable = unlocked;
            if(MultiplayerButton != null) MultiplayerButton.interactable = unlocked;
        }
        else if (itemType == ItemType.Level)
        {
            if(lockIcon != null) lockIcon.SetActive(false); // Levels are not NFT locked in this script
        }
    }

    public void NextCar()
    {
        if (id < itemIcons.Length - 1)
        {
            id++;
            if (canAnim) PlayAnim();
            if (audioSource != null && audioSource.enabled && okClip != null) { audioSource.clip = okClip; audioSource.Play(); }
        }

        if (itemIcons.Length > id && id >=0) currentItemImage.sprite = itemIcons[id];

        if (prevItemImage != null && nextItemImage != null)
        {
            if (id < itemIcons.Length - 1 && id > 0)
            {
                prevItemImage.color = Color.white;
                nextItemImage.color = Color.white;
                nextItemImage.sprite = itemIcons[id + 1];
                prevItemImage.sprite = itemIcons[id - 1];
            }
            else if (id == itemIcons.Length - 1 && id > 0) // Last item
            {
                nextItemImage.sprite = null;
                nextItemImage.color = Color.clear;
                prevItemImage.color = Color.white;
                prevItemImage.sprite = itemIcons[id - 1];
            }
            else if (id == 0 && itemIcons.Length > 1) // First item
            {
                prevItemImage.sprite = null;
                prevItemImage.color = Color.clear;
                nextItemImage.color = Color.white;
                nextItemImage.sprite = itemIcons[id + 1];
            }
             else if (itemIcons.Length <= 1) // Only one or zero items
            {
                prevItemImage.sprite = null;
                prevItemImage.color = Color.clear;
                nextItemImage.sprite = null;
                nextItemImage.color = Color.clear;
            }
        }


        if (itemType == ItemType.Car) PlayerPrefs.SetInt("CarID", id);
        if (itemType == ItemType.Level) PlayerPrefs.SetInt("LevelID", id);

        UpdateLockStatus();

        if (itemsPrice.Length > id && id >=0 && CurentValue != null) CurentValue.text = itemsPrice[id].ToString();
    }

    public void PrevCar()
    {
        if (id > 0)
        {
            --id;
            if (canAnim) PlayAnim();
            if (audioSource != null && audioSource.enabled && okClip != null) { audioSource.clip = okClip; audioSource.Play(); }
        }

        if (itemIcons.Length > id && id >=0) currentItemImage.sprite = itemIcons[id];
        
        if (prevItemImage != null && nextItemImage != null)
        {
            if (id > 0)
            {
                prevItemImage.color = Color.white;
                nextItemImage.color = Color.white;
                prevItemImage.sprite = itemIcons[id - 1];
                if (id + 1 < itemIcons.Length) nextItemImage.sprite = itemIcons[id + 1]; else { nextItemImage.sprite = null; nextItemImage.color = Color.clear; }
            }
            else if (id == 0 && itemIcons.Length > 1) // First item
            {
                prevItemImage.sprite = null;
                prevItemImage.color = Color.clear;
                nextItemImage.color = Color.white;
                nextItemImage.sprite = itemIcons[id + 1];
            }
            else if (itemIcons.Length <= 1) // Only one or zero items
            {
                 prevItemImage.sprite = null;
                 prevItemImage.color = Color.clear;
                 nextItemImage.sprite = null;
                 nextItemImage.color = Color.clear;
            }
        }

        if (itemType == ItemType.Level) PlayerPrefs.SetInt("LevelID", id);
        if (itemType == ItemType.Car) PlayerPrefs.SetInt("CarID", id);

        UpdateLockStatus();
        if (itemsPrice.Length > id && id >=0 && CurentValue != null) CurentValue.text = itemsPrice[id].ToString();
    }


    void PlayAnim()
    {
        if (currentAnimator == null) return;
        animaState = !animaState;
        if (animaState)
            currentAnimator.CrossFade("Next", .003f);
        else
            currentAnimator.CrossFade("Prev", .003f);
    }

    public void SelectCurrent()
    {
        if (itemType == ItemType.Level)
        {
            // Assuming PlayerPrefs "LevelX" stores unlock state (3 means unlocked)
            if (PlayerPrefs.GetInt("Level" + id.ToString(), 0) == 3)
            {
                if(gameObject != null) gameObject.SetActive(false);
                if(nextMen != null) nextMen.SetActive(true);
                PlayerPrefs.SetInt("SelectedLevel", id);
            }
            else
            {
                if (audioSource != null && audioSource.enabled && errorClip != null) { audioSource.clip = errorClip; audioSource.Play(); }
            }
        }

        if (itemType == ItemType.Car)
        {
            if (itemIcons.Length > id && id >= 0)
            {
                string carName = itemIcons[id].name;
                bool unlocked = assetsInitialized && IsNFTUnlocked(carName);

                if (unlocked)
                {
                    if(gameObject != null) gameObject.SetActive(false);
                    if(nextMen != null) nextMen.SetActive(true);
                    PlayerPrefs.SetInt("SelectedCar", id);

                    if (MainMenuManager.Instance != null) MainMenuManager.Instance.UpdateSelectedCar();
                }
                else
                {
                    if (audioSource != null && audioSource.enabled && errorClip != null) { audioSource.clip = errorClip; audioSource.Play(); }
                }
            }
        }
    }


    public void Buy() // This seems to be for non-NFT items (levels)
    {
        if (itemType == ItemType.Level)
        {
            if (PlayerPrefs.GetInt("Level" + id.ToString(), 0) != 3) // Not already unlocked
            {
                if (PlayerPrefs.GetInt("Coins", 0) >= itemsPrice[id])
                {
                    PlayerPrefs.SetInt("Coins", PlayerPrefs.GetInt("Coins") - itemsPrice[id]);
                    PlayerPrefs.SetInt("Level" + id.ToString(), 3); // Mark as unlocked
                    if(lockIcon != null) lockIcon.SetActive(false);
                    if(coinsTXT != null) coinsTXT.text = PlayerPrefs.GetInt("Coins", 0).ToString();
                }
                else
                {
                    if(shopOffer != null) shopOffer.SetActive(true);
                }
            }
        }

        if (itemType == ItemType.Car) // Cars are NFT locked, not bought with coins in this logic
        {
            if (audioSource != null && audioSource.enabled && errorClip != null) { audioSource.clip = errorClip; audioSource.Play(); }
        }
    }

    private Dictionary<int, int> nftActivationRaces = new Dictionary<int, int>()
    {
        {1, 17}, {2, 25}, {3, 33}, {4, 41}, {5, 49}
    };

    public float GetEffectiveNFTBoost(int totalRacesCompleted)
    {
        float totalBoost = 0f;
        int nftCount = ownedBoosterNFTs.Count; // Use current count of owned boosters

        if (nftCount >= 1 && totalRacesCompleted >= nftActivationRaces[1]) totalBoost += 10f;
        if (nftCount >= 2 && totalRacesCompleted >= nftActivationRaces[2]) totalBoost += 10f;
        if (nftCount >= 3 && totalRacesCompleted >= nftActivationRaces[3]) totalBoost += 10f;
        if (nftCount >= 4 && totalRacesCompleted >= nftActivationRaces[4]) totalBoost += 10f;
        if (nftCount >= 5 && totalRacesCompleted >= nftActivationRaces[5]) totalBoost += 35f;

        return totalBoost;
    }
}


    