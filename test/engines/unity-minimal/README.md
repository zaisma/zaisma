# Unity sample, Minimal template

The same Unity 6 project as `../unity` (`../unity/source`), exported with Unity's Minimal page template instead of the default: the game alone, with no logo, name or full-screen button under it. Like the default, it draws at a fixed 960×600 on a computer and fills the screen only on phones and tablets.

Rebuild it with the same Unity as `../unity`:

```bash
"/Applications/Unity/Hub/Editor/<version>/Unity.app/Contents/MacOS/Unity" -batchmode -quit -nographics -projectPath test/engines/unity/source -executeMethod Build.WebMinimal -logFile -
```
