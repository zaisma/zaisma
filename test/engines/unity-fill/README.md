# Unity sample, filling the frame

The same Unity 6 project as `../unity` (`../unity/source`), exported with a page template of its own, `Assets/WebGLTemplates/Fill`: Unity's Minimal template with the game filling the whole page on every screen, so it fills Zaisma's frame. Unity's own templates draw the game at a fixed size on a computer.

Rebuild it with the same Unity as `../unity`:

```bash
"/Applications/Unity/Hub/Editor/<version>/Unity.app/Contents/MacOS/Unity" -batchmode -quit -nographics -projectPath test/engines/unity/source -executeMethod Build.WebFill -logFile -
```
