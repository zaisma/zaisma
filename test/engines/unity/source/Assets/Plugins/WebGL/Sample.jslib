// Tells Zaisma's engine tests the game started (scripts/engines/play.mjs).
mergeInto(LibraryManager.library, {
  SayStarted: function (version) {
    window.zaismaEngineSample = { engine: "unity", version: UTF8ToString(version), started: true };
  },
});
