
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
    private string ownerAddress = ""; // This will be set if found in PlayerPrefs, but asset loading is now reactive
    private const string carCollectionAddress = "qJhfDwLsjzjnjNw3Fz8ESji8zAWVWNP5AYDZXjxF1fd"; // Ensure this is correct
    private const string boosterCollectionAddress = "hUEKA85VywTT43c2s3Vd9Nsem1j1xTWbUPYLppY7Nzb"; // Ensure this is correct
    private bool initialAssetsProcessed = false; 

    // Booster NFT System
    [Header("Booster NFT System")]
    public GameObject boosterNFTPrefab;
    public Transform scrollRectContent;
    private List<BridgeUnityCNft> ownedBoosterNFTs = new List<BridgeUnityCNft>();
    private Dictionary<string, Sprite> boosterSprites = new Dictionary<string, Sprite>();

    // Season management
    private DateTime seasonStartDate;
    private const int seasonLengthDays = 28;

    [Header("Season UI")]
    public TMPro.TMP_Text seasonTimerTxt;
    public TMPro.TMP_Text boostPercentageTxt;
    public TMPro.TMP_Text topSpeedTxt;

    [Header("Debug")]
    public TMPro.TMP_Text debugText;

    [Header("NFT Burning")]
    public GameObject burnConfirmationPanel;
    public TMP_Text burnStatusText;

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

    void Awake()
    {
        // Subscribe to GameBridgeManager events early
        if (GameBridgeManager.Instance != null)
        {
            GameBridgeManager.Instance.OnAssetsLoadedEvent += HandleAssetsLoaded;
            GameBridgeManager.Instance.OnTransactionSubmittedEvent += HandleAssetBurnSuccess; 
            GameBridgeManager.Instance.OnTransactionErrorEvent += HandleAssetBurnError;
        }
        else
        {
            Debug.LogError("ItemSelect: GameBridgeManager.Instance is null in Awake. Asset and transaction events will not be handled initially.");
        }
    }

    void Start()
    {
        if (PlayerPrefs.HasKey("WalletAddress"))
        {
            ownerAddress = PlayerPrefs.GetString("WalletAddress");
            Debug.Log($"ItemSelect: WalletAddress found in PlayerPrefs at Start: {ownerAddress}");
        }
        else
        {
            Debug.LogWarning("ItemSelect: WalletAddress not found in PlayerPrefs at Start. NFT functionalities depend on assets loaded via GameBridgeManager.");
        }

        coinsTXT.text = PlayerPrefs.GetInt("Coins", 0).ToString();

        if (itemType == ItemType.Car)
            id = PlayerPrefs.GetInt("CarID", 0);
        if (itemType == ItemType.Level)
            id = PlayerPrefs.GetInt("LevelID", 0);

        if (itemIcons.Length > 0 && id < itemIcons.Length)
            currentItemImage.sprite = itemIcons[id];
        else if (itemIcons.Length > 0)
            currentItemImage.sprite = itemIcons[0]; 

        if (id != 0 && itemIcons.Length > 1) { PrevCar(); NextCar(); }
        else if (itemIcons.Length > 1) { NextCar(); PrevCar(); }

        canAnim = true;
        
        if (itemsPrice.Length > id && id >=0 && CurentValue != null) CurentValue.text = itemsPrice[id].ToString();
        else if (itemsPrice.Length > 0 && CurentValue != null) CurentValue.text = itemsPrice[0].ToString();


        if (itemType == ItemType.Car) InitializeSeason();
        
        // Attempt to process cached data if GameBridgeManager is available and we haven't processed yet.
        // This handles cases where ItemSelect might Start after assets are already loaded.
        if (!initialAssetsProcessed && GameBridgeManager.Instance != null)
        {
            string cachedData = GameBridgeManager.Instance.GetCachedAssetsJson();
            if (!string.IsNullOrEmpty(cachedData))
            {
                Debug.Log("ItemSelect (Start): Processing cached asset data.");
                HandleAssetsLoaded(cachedData);
            }
        }
        UpdateLockStatus(); // Initial lock status based on possibly no assets processed yet.
    }

    void OnEnable()
    {
        // This is crucial for when the ItemSelect GameObject is activated after assets have been loaded.
        if (!initialAssetsProcessed && GameBridgeManager.Instance != null)
        {
            string cachedData = GameBridgeManager.Instance.GetCachedAssetsJson();
            if (!string.IsNullOrEmpty(cachedData))
            {
                Debug.Log("ItemSelect (OnEnable): Processing cached asset data because initialAssetsProcessed is false.");
                HandleAssetsLoaded(cachedData); // This will set initialAssetsProcessed to true.
            } else {
                 Debug.Log("ItemSelect (OnEnable): No cached asset data found or already processed.");
            }
        } else if (GameBridgeManager.Instance == null) {
            Debug.LogWarning("ItemSelect (OnEnable): GameBridgeManager.Instance is null. Cannot fetch cached assets.");
        }
        // Ensure UI reflects current state, even if re-enabled without new data.
        UpdateLockStatus();
        UpdateBoostMultiplier(); // Recalculate boost UI elements
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
    
    void HandleAssetsLoaded(string jsonData)
    {
        Debug.Log("ItemSelect (HandleAssetsLoaded): Received OnAssetsLoadedEvent. JSON: " + jsonData.Substring(0, Mathf.Min(jsonData.Length, 500)) + (jsonData.Length > 500 ? "..." : ""));
        ownedCarNFTNames.Clear();
        ownedBoosterNFTs.Clear();

        if (string.IsNullOrEmpty(jsonData) || jsonData.Trim() == "{}" || jsonData.Trim() == "null") {
            Debug.LogWarning("ItemSelect: HandleAssetsLoaded received empty or trivial JSON data. No assets to process.");
            initialAssetsProcessed = true; 
            UpdateLockStatus();
            CreateBoosterUI(); 
            SaveNFTData();
            return;
        }

        try
        {
            BridgeAssetCollectionPayload payload = JsonUtility.FromJson<BridgeAssetCollectionPayload>(jsonData);

            if (payload != null)
            {
                 Debug.Log($"ItemSelect: Parsed payload. NFTs count: {(payload.nfts != null ? payload.nfts.Count : 0)}, cNFTs count: {(payload.cnfts != null ? payload.cnfts.Count : 0)}");

                if (payload.nfts != null) 
                {
                    foreach (BridgeUnityNft nft in payload.nfts)
                    {
                        Debug.Log($"ItemSelect: Processing NFT - Name: {nft.name}, ID: {nft.id}, Collection ID: {(nft.collection != null ? nft.collection.id : "N/A")}");
                        if (nft.collection != null && nft.collection.id == carCollectionAddress)
                        {
                            if (!string.IsNullOrEmpty(nft.name))
                            {
                                ownedCarNFTNames.Add(nft.name);
                                Debug.Log($"ItemSelect: Added owned standard car NFT: {nft.name}");
                            } else {
                                Debug.LogWarning($"ItemSelect: Owned standard car NFT from collection {carCollectionAddress} has no name. ID: {nft.id}");
                            }
                        }
                    }
                }
                
                if (payload.cnfts != null) 
                {
                    foreach (BridgeUnityCNft cnft in payload.cnfts)
                    {
                        Debug.Log($"ItemSelect: Processing cNFT - Name: {cnft.name}, ID: {cnft.id}, Collection ID: {(cnft.collection != null ? cnft.collection.id : "N/A")}");
                        if (cnft.collection != null)
                        {
                             if (cnft.collection.id == boosterCollectionAddress)
                             {
                                ownedBoosterNFTs.Add(cnft);
                                Debug.Log($"ItemSelect: Added owned booster cNFT: {cnft.name} (ID: {cnft.id})");
                             }
                             else if (cnft.collection.id == carCollectionAddress) 
                             {
                                 if (!string.IsNullOrEmpty(cnft.name))
                                 {
                                     ownedCarNFTNames.Add(cnft.name);
                                     Debug.Log($"ItemSelect: Added owned compressed car NFT: {cnft.name}");
                                 } else {
                                     Debug.LogWarning($"ItemSelect: Owned compressed car NFT from collection {carCollectionAddress} has no name. ID: {cnft.id}");
                                 }
                             }
                        } else {
                            Debug.LogWarning($"ItemSelect: cNFT {cnft.name} (ID: {cnft.id}) has no collection info. Cannot categorize.");
                        }
                    }
                }
                Debug.Log($"ItemSelect: Finished processing. Total ownedCarNFTNames: {ownedCarNFTNames.Count}, Total ownedBoosterNFTs: {ownedBoosterNFTs.Count}");
            }
            else
            {
                Debug.LogWarning("ItemSelect: JSON payload was null after parsing in HandleAssetsLoaded.");
            }
        }
        catch (Exception e)
        {
            Debug.LogError("ItemSelect: JSON Parse Error in HandleAssetsLoaded: " + e.Message + "\nAttempted to parse JSON: " + jsonData.Substring(0, Mathf.Min(jsonData.Length, 500)) + (jsonData.Length > 500 ? "..." : ""));
        }

        initialAssetsProcessed = true; // Mark that assets have been processed at least once.
        UpdateLockStatus(); // Crucial: Update lock status after processing NFTs
        CreateBoosterUI(); 
        SaveNFTData(); 
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
        UpdateBoostMultiplier(); 
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
            yield return new WaitForSeconds(1f); 
        }
        
        PlayerPrefs.SetString("LastBurnDate", DateTime.Now.ToBinary().ToString());
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
                    burnStatusText.text = $"Burned: {(burnedBooster != null ? burnedBooster.name : result.mint.Substring(0,Math.Min(6, result.mint.Length))+"...")}";
                    burnStatusText.color = Color.green;
                }
                ownedBoosterNFTs.RemoveAll(b => b.id == result.mint);
                
                CreateBoosterUI(); 
                UpdateBoostMultiplier();
                SaveNFTData();
            }
             else if (result == null)
            {
                Debug.LogWarning("ItemSelect: HandleAssetBurnSuccess: Parsed result was null. JSON: " + jsonData);
            }
        }
        catch (Exception e)
        {
            Debug.LogError("ItemSelect: Error parsing burn success JSON: " + e.Message + ". JSON: " + jsonData);
        }
    }
    
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
                    burnStatusText.text = $"Burn Failed: {(string.IsNullOrEmpty(result.mint) ? "Unknown" : result.mint.Substring(0,Math.Min(6, result.mint.Length))+"...")} - {result.error}";
                    burnStatusText.color = Color.red;
                }
            }
            else if (result == null)
            {
                 Debug.LogWarning("ItemSelect: HandleAssetBurnError: Parsed result was null. JSON: " + jsonData);
            }
        }
        catch (Exception e)
        {
            Debug.LogError("ItemSelect: Error parsing burn error JSON: " + e.Message + ". JSON: " + jsonData);
        }
    }


    [ContextMenu("Force Season Reset (Testing)")]
    public void ForceSeasonResetForTesting()
    {
        Debug.Log("Forcing season reset for testing...");
        PlayerPrefs.DeleteKey("LastBurnDate");
        seasonStartDate = DateTime.Now.AddDays(-seasonLengthDays - 1); 
        PlayerPrefs.SetString("SeasonStartDate", seasonStartDate.ToBinary().ToString());

        ownedBoosterNFTs.Clear();
        for (int i = 0; i < 3; i++)
        {
            ownedBoosterNFTs.Add(new BridgeUnityCNft()
            {
                id = "TestcNFT_Booster_" + Guid.NewGuid().ToString(), 
                name = "Test Booster " + i,
                imageUrl = "https://placehold.co/100x100.png", 
                collection = new BridgeUnityCollection { id = boosterCollectionAddress, name = "Test Booster Collection" }
            });
        }
        Debug.Log($"Added {ownedBoosterNFTs.Count} test booster cNFTs");
        CreateBoosterUI(); 
        
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
                    PlayerPrefs.SetInt("SeasonJustReset", 1); 
                    Debug.Log("Season timer expired. Starting new season and burning expired NFTs.");
                    StartNewSeason(); 
                    if (ShouldBurnExpiredNFTs()) 
                    {
                        StartCoroutine(BurnExpiredNFTs());
                    }
                    PlayerPrefs.SetInt("SeasonJustReset", 0); 
                }
            }
        }
        UpdateTopSpeed();
    }

    void UpdateTopSpeed()
    {
        if (topSpeedTxt == null) return;

        int totalRacesCompleted = PlayerPrefs.GetInt("TotalRacesCompleted", 0);
        float baseTopSpeed = CalculateTopSpeedForDay((int)(DateTime.Now - seasonStartDate).TotalDays + 1); 

        float effectiveBoost = GetEffectiveNFTBoost(totalRacesCompleted);
        float actualPower = baseTopSpeed + effectiveBoost;
        actualPower = Mathf.Max(0, actualPower); 

        PlayerPrefs.SetFloat("CurrentTopSpeed", actualPower);
        PlayerPrefs.SetFloat("SpeedMultiplier", actualPower / 100f); 
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

    private float GetTotalNFTBoost() 
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
        day = Mathf.Max(1, day); 
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

    void UpdateBoostMultiplier() 
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

    void SaveNFTData()
    {
        PlayerPrefs.SetInt("OwnedBoosterNFTCount", ownedBoosterNFTs.Count);
        int totalRaces = PlayerPrefs.GetInt("TotalRacesCompleted", 0);
        float effectiveBoost = GetEffectiveNFTBoost(totalRaces);
        PlayerPrefs.SetFloat("EffectiveNFTBoost", effectiveBoost);
        PlayerPrefs.Save(); 
        Debug.Log($"ItemSelect: Saved NFT Data - Booster Count = {ownedBoosterNFTs.Count}, Effective Boost = {effectiveBoost}");
    }

    void CreateBoosterUI()
    {
        if (scrollRectContent == null) {
            Debug.LogWarning("ItemSelect: scrollRectContent is not assigned. Cannot create booster UI.");
            return;
        }
        foreach (Transform child in scrollRectContent)
        {
            Destroy(child.gameObject);
        }

        foreach (BridgeUnityCNft booster in ownedBoosterNFTs) 
        {
            if (boosterNFTPrefab == null) {
                Debug.LogError("ItemSelect: boosterNFTPrefab is not assigned. Cannot instantiate booster UI.");
                continue;
            }
            GameObject boosterUI = Instantiate(boosterNFTPrefab, scrollRectContent);
            Image boosterImage = boosterUI.GetComponentInChildren<Image>(); 
            if(boosterImage == null) {
                 boosterImage = boosterUI.GetComponent<Image>(); // Fallback if not in children
            }
             if(boosterImage == null) { // Still null? Log error and skip image part
                Debug.LogError($"ItemSelect: Booster UI for '{booster.name}' missing Image component. Ensure prefab is correctly set up with an Image component on the root or a child.");
            }


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
                boosterButton.onClick.RemoveAllListeners();
                boosterButton.onClick.AddListener(() =>
                {
                    ToastNotification.Show($"Booster: {boosterName}", "info");
                });
            }
            else Debug.LogWarning("Booster UI Prefab missing Button component.");
            
            if (boosterImage != null) // Check again if it was found
            {
                StartCoroutine(LoadBoosterImage(booster, boosterImage));
            }
        }
        UpdateBoostMultiplier(); 
        SaveNFTData(); 
    }

    IEnumerator LoadBoosterImage(BridgeUnityCNft booster, Image targetImage)
    {
        string imageUrl = booster.imageUrl;
        Debug.Log($"[LoadBoosterImage] Attempting to load image for booster '{booster.name}' from URL: {imageUrl}");

        if (targetImage == null)
        {
            Debug.LogError($"[LoadBoosterImage] Target Image component for booster '{booster.name}' is null. Cannot load image.");
            yield break;
        }

        if (string.IsNullOrEmpty(imageUrl))
        {
            Debug.LogWarning($"[LoadBoosterImage] Image URL for '{booster.name}' is null or empty.");
            if (fallbackSprite != null) SetSpriteToTarget(targetImage, fallbackSprite);
            else Debug.LogWarning($"[LoadBoosterImage] Fallback sprite for '{booster.name}' is not assigned.");
            yield break;
        }

        // Explicitly log if it's a known placeholder domain to avoid confusion with real images
        if (imageUrl.Contains("placehold.co") || imageUrl.Contains("via.placeholder.com")) {
             Debug.Log($"[LoadBoosterImage] Using placeholder image URL directly: {imageUrl} for booster '{booster.name}'");
        }


        using (UnityEngine.Networking.UnityWebRequest imageRequest = UnityEngine.Networking.UnityWebRequestTexture.GetTexture(imageUrl))
        {
            Debug.Log($"[LoadBoosterImage] Sending web request for: {imageUrl} (Booster: {booster.name})");
            yield return imageRequest.SendWebRequest();

            if (imageRequest.result == UnityEngine.Networking.UnityWebRequest.Result.Success)
            {
                Debug.Log($"[LoadBoosterImage] Successfully downloaded image data for: {imageUrl} (Booster: {booster.name})");
                Texture2D texture = UnityEngine.Networking.DownloadHandlerTexture.GetContent(imageRequest);
                if (texture != null)
                {
                    Debug.Log($"[LoadBoosterImage] Texture created successfully for {imageUrl}. Width: {texture.width}, Height: {texture.height} (Booster: {booster.name})");
                    Sprite sprite = Sprite.Create(
                        texture,
                        new Rect(0, 0, texture.width, texture.height),
                        Vector2.one * 0.5f
                    );
                    if (sprite != null)
                    {
                        Debug.Log($"[LoadBoosterImage] Sprite created successfully for {imageUrl}. Assigning to target. (Booster: {booster.name})");
                        SetSpriteToTarget(targetImage, sprite);
                    }
                    else
                    {
                        Debug.LogWarning($"[LoadBoosterImage] Sprite.Create returned null for {imageUrl}. Applying fallback. (Booster: {booster.name})");
                        if (fallbackSprite != null) SetSpriteToTarget(targetImage, fallbackSprite);
                    }
                }
                else
                {
                    Debug.LogWarning($"[LoadBoosterImage] Texture is null after downloading image: {imageUrl}. Applying fallback. (Booster: {booster.name})");
                    if (fallbackSprite != null) SetSpriteToTarget(targetImage, fallbackSprite);
                }
            }
            else
            {
                Debug.LogWarning($"[LoadBoosterImage] Failed to load booster image: {imageUrl}. Error: {imageRequest.error}, Result: {imageRequest.result}. Applying fallback. (Booster: {booster.name})");
                if (fallbackSprite != null) SetSpriteToTarget(targetImage, fallbackSprite);
            }
        }
    }


    void SetSpriteToTarget(Image target, Sprite sprite)
    {
        if (target == null) { Debug.LogError("SetSpriteToTarget: target Image component is null."); return; }
        if (sprite == null) { Debug.LogError("SetSpriteToTarget: sprite is null."); return; }
        target.sprite = sprite;
        Debug.Log($"SetSpriteToTarget: Successfully assigned sprite '{sprite.name}' to Image '{target.gameObject.name}'.");
    }

    bool IsNFTUnlocked(string carName) 
    {
        if (!initialAssetsProcessed) { // Use the new flag
            Debug.LogWarning($"ItemSelect: IsNFTUnlocked called for '{carName}' but initial assets are not yet processed. Returning false.");
            return false;
        }
        
        Debug.Log($"ItemSelect: Checking unlock status for car '{carName}'. Owned car NFT names: {string.Join(", ", ownedCarNFTNames)}");
        foreach (string nftName in ownedCarNFTNames)
        {
            if (nftName.Equals(carName, System.StringComparison.OrdinalIgnoreCase))
            {
                Debug.Log($"ItemSelect: Car '{carName}' IS UNLOCKED because it matches owned NFT '{nftName}'.");
                return true;
            }
        }
        Debug.Log($"ItemSelect: Car '{carName}' IS LOCKED. No matching NFT found in ownedCarNFTNames.");
        return false;
    }

    void UpdateLockStatus()
    {
        if (itemType == ItemType.Car && itemIcons.Length > id && id >= 0)
        {
            string currentCarName = itemIcons[id].name; 
            bool unlocked = IsNFTUnlocked(currentCarName);
            
            Debug.Log($"ItemSelect: UpdateLockStatus for car '{currentCarName}' (ID: {id}). Initial Assets Processed: {initialAssetsProcessed}. Unlocked: {unlocked}");

            if(lockIcon != null) lockIcon.SetActive(!unlocked);

            if(PracticeButton != null) PracticeButton.interactable = unlocked;
            if(MultiplayerButton != null) MultiplayerButton.interactable = unlocked;
        }
        else if (itemType == ItemType.Level)
        {
            if(lockIcon != null) lockIcon.SetActive(false); 
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
            else if (id == itemIcons.Length - 1 && id > 0) 
            {
                nextItemImage.sprite = null;
                nextItemImage.color = Color.clear;
                prevItemImage.color = Color.white;
                prevItemImage.sprite = itemIcons[id - 1];
            }
            else if (id == 0 && itemIcons.Length > 1) 
            {
                prevItemImage.sprite = null;
                prevItemImage.color = Color.clear;
                nextItemImage.color = Color.white;
                nextItemImage.sprite = itemIcons[id + 1];
            }
             else if (itemIcons.Length <= 1) 
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
            else if (id == 0 && itemIcons.Length > 1) 
            {
                prevItemImage.sprite = null;
                prevItemImage.color = Color.clear;
                nextItemImage.color = Color.white;
                nextItemImage.sprite = itemIcons[id + 1];
            }
            else if (itemIcons.Length <= 1) 
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
                bool unlocked = IsNFTUnlocked(carName);

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
                     Debug.Log($"ItemSelect: Attempted to select locked car '{carName}'.");
                }
            }
        }
    }


    public void Buy() 
    {
        if (itemType == ItemType.Level)
        {
            if (PlayerPrefs.GetInt("Level" + id.ToString(), 0) != 3) 
            {
                if (PlayerPrefs.GetInt("Coins", 0) >= itemsPrice[id])
                {
                    PlayerPrefs.SetInt("Coins", PlayerPrefs.GetInt("Coins") - itemsPrice[id]);
                    PlayerPrefs.SetInt("Level" + id.ToString(), 3); 
                    if(lockIcon != null) lockIcon.SetActive(false);
                    if(coinsTXT != null) coinsTXT.text = PlayerPrefs.GetInt("Coins", 0).ToString();
                }
                else
                {
                    if(shopOffer != null) shopOffer.SetActive(true);
                }
            }
        }

        if (itemType == ItemType.Car) 
        {
            if (audioSource != null && audioSource.enabled && errorClip != null) { audioSource.clip = errorClip; audioSource.Play(); }
             Debug.LogWarning("ItemSelect: Buy() called for ItemType.Car. Cars are NFT-locked, not bought with coins in this system.");
        }
    }

    private Dictionary<int, int> nftActivationRaces = new Dictionary<int, int>()
    {
        {1, 17}, {2, 25}, {3, 33}, {4, 41}, {5, 49}
    };

    public float GetEffectiveNFTBoost(int totalRacesCompleted)
    {
        float totalBoost = 0f;
        int nftCount = ownedBoosterNFTs.Count; 

        if (nftCount >= 1 && totalRacesCompleted >= nftActivationRaces[1]) totalBoost += 10f;
        if (nftCount >= 2 && totalRacesCompleted >= nftActivationRaces[2]) totalBoost += 10f;
        if (nftCount >= 3 && totalRacesCompleted >= nftActivationRaces[3]) totalBoost += 10f;
        if (nftCount >= 4 && totalRacesCompleted >= nftActivationRaces[4]) totalBoost += 10f;
        if (nftCount >= 5 && totalRacesCompleted >= nftActivationRaces[5]) totalBoost += 35f;

        return totalBoost;
    }
}

    