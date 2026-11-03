import { describe, expect, it } from "vitest";
import { GALLERY_SHEETS } from "../../apps/site/src/components/gallery-sheet.ts";
import "../../apps/site/src/over-a-game.ts";
import "../../apps/site/src/buy-sheet.ts";

/*
 * What a real sheet's script can show, the gallery shows: a part hidden until a live moment that no state ever shows is a sheet that looks
 * finished in the gallery with half of it missing (the room code and QR code of Invite, the moments of Buy).
 */
describe("Every moment of a real sheet", () => {
  it("has its sheets declared", () => {
    expect(GALLERY_SHEETS.length).toBeGreaterThanOrEqual(9);
  });
  for (const sheet of GALLERY_SHEETS) {
    it(`${sheet.name} shows every part it hides`, () => {
      const states = sheet.hiddenIdsIn();
      const neverShown = sheet.hiddenIds().filter((id) => !sheet.partsOnlyLive.includes(id) && states.every((hidden) => hidden.includes(id)));
      expect(neverShown, "Give it a state in its gallerySheet that shows these, or name why only a live page can in partsOnlyLive").toEqual([]);
    });
  }
});
