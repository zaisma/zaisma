// Makes the sample's scene and its web export from the command line (see ../../README.md).
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class Build
{
    // The default page template, as an export with nothing changed: test/engines/unity/build.
    public static void Web() => Export("APPLICATION:Default", "../build");

    // A page template of the project's own (Assets/WebGLTemplates/Fill), Unity's Minimal with the game
    // filling the page, so it fills Zaisma's frame: test/engines/unity-fill/build.
    public static void WebFill() => Export("PROJECT:Fill", "../../unity-fill/build");

    static void Export(string template, string folder)
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
        RenderSettings.ambientLight = new Color(0.35f, 0.38f, 0.45f);

        var sun = new GameObject("Sun").AddComponent<Light>();
        sun.type = LightType.Directional;
        sun.shadows = LightShadows.Soft;
        sun.intensity = 1.2f;
        sun.transform.rotation = Quaternion.Euler(55, 35, 0);

        var floor = GameObject.CreatePrimitive(PrimitiveType.Cube);
        floor.name = "Floor";
        floor.transform.localScale = new Vector3(30, 1, 30);
        floor.transform.position = new Vector3(0, -0.5f, 0);
        floor.GetComponent<Renderer>().sharedMaterial = SavedMaterial("Floor", new Color(0.18f, 0.22f, 0.28f));

        var crate = GameObject.CreatePrimitive(PrimitiveType.Cube);
        crate.name = "Crate";
        crate.GetComponent<Renderer>().sharedMaterial = SavedMaterial("Crate", Color.white);
        crate.AddComponent<Rigidbody>();
        crate.SetActive(false);

        var view = new GameObject("Camera").AddComponent<Camera>();
        view.clearFlags = CameraClearFlags.SolidColor;
        view.backgroundColor = new Color(0.06f, 0.07f, 0.1f);

        var sample = new GameObject("Sample").AddComponent<Sample>();
        sample.crateTemplate = crate;
        sample.view = view;
        EditorSceneManager.SaveScene(scene, "Assets/Sample.unity");

        PlayerSettings.productName = "Unity sample";
        // Gzip, the default, so the upload command's unpacking is checked on a real build; no threads, the default.
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Gzip;
        PlayerSettings.WebGL.decompressionFallback = false;
        PlayerSettings.WebGL.threadsSupport = false;
        PlayerSettings.WebGL.nameFilesAsHashes = false;
        PlayerSettings.WebGL.template = template;

        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { "Assets/Sample.unity" },
            locationPathName = folder,
            target = BuildTarget.WebGL,
            options = BuildOptions.None,
        });
        if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) EditorApplication.Exit(1);
    }

    static Material SavedMaterial(string name, Color color)
    {
        var path = $"Assets/{name}.mat";
        var material = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (material != null) return material;
        material = new Material(Shader.Find("Standard")) { color = color };
        AssetDatabase.CreateAsset(material, path);
        return material;
    }
}
