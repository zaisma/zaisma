# Unity sample

A Unity 6 web export (6000.6.6f1), as the editor writes it with its default page template: crates rain onto a floor in a lit 3D scene with shadows and physics, the camera orbits with the arrow keys or a drag, and the biggest pile is kept in the game's own save (`PlayerPrefs`).

- `source/`: the project. `Assets/Editor/Build.cs` makes the scene and the export; `Assets/Plugins/WebGL/Sample.jslib` says the game started.
- `build/`: its export: gzip-compressed, the default, which `zaisma upload` unpacks; no threads, the default, as `zaisma check` asks.

`../unity-minimal` is the same project with Unity's Minimal page template.

Rebuild it after changing `source/`, with Unity 6 and its Web Build Support installed and signed in:

```bash
"/Applications/Unity/Hub/Editor/<version>/Unity.app/Contents/MacOS/Unity" -batchmode -quit -nographics -projectPath test/engines/unity/source -executeMethod Build.Web -logFile -
```
