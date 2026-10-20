// A Unity sample for Zaisma's engine tests: a lit 3D scene with shadows and physics. Crates rain onto a
// floor and pile up, the camera orbits with the arrow keys or a drag, and the biggest pile is kept in the
// game's own save (PlayerPrefs, which Unity keeps in the browser's IndexedDB).
using System.Runtime.InteropServices;
using UnityEngine;

public class Sample : MonoBehaviour
{
    // Made in the editor (Assets/Editor/Build.cs), so the build keeps the colliders, physics and shader they use.
    public GameObject crateTemplate;
    public Camera view;

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] static extern void SayStarted(string version);
#endif

    float yaw = 0.6f;
    float spawnTimer;
    int crateCount;
    int bestCrateCount;

    void Start()
    {
        bestCrateCount = PlayerPrefs.GetInt("best_crate_count", 0);
#if UNITY_WEBGL && !UNITY_EDITOR
        SayStarted(Application.unityVersion);
#endif
    }

    void DropCrate()
    {
        var crate = Instantiate(crateTemplate, new Vector3(Random.Range(-3f, 3f), 12, Random.Range(-3f, 3f)), Random.rotation);
        crate.GetComponent<Renderer>().material.color = Color.HSVToRGB(Random.value, 0.5f, 0.9f);
        crate.SetActive(true);
        crateCount++;
        if (crateCount > bestCrateCount)
        {
            bestCrateCount = crateCount;
            PlayerPrefs.SetInt("best_crate_count", bestCrateCount);
        }
    }

    void Update()
    {
        yaw += Input.GetAxis("Horizontal") * Time.deltaTime * 1.5f;
        if (Input.GetMouseButton(0)) yaw -= Input.GetAxis("Mouse X") * 0.05f;
        view.transform.position = new Vector3(Mathf.Sin(yaw) * 16, 9, Mathf.Cos(yaw) * 16);
        view.transform.LookAt(new Vector3(0, 1, 0));
        spawnTimer -= Time.deltaTime;
        if (spawnTimer <= 0 && crateCount < 120)
        {
            spawnTimer = 0.25f;
            DropCrate();
        }
    }
}
