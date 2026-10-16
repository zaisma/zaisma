import { describe, expect, it } from "vitest";
import { checkText, tidyText } from "../../packages/core/src/text-filter.ts";

const blocked = (t: string) => checkText(t).reason;

describe("text filter", () => {
  it("lets ordinary room names and labels through", () => {
    for (const t of ["Ana's castle", "Signal Hill", "Line Rider 2", "Snap Dash", "Kiki's world", "Round 3 of 5", "Team 1234", "Classic", "Docks", "Scunthorpe United", "Assassin's den", "Cocktail bar", "Grasshopper", "🔥 Lava run 🔥", "A B C team", "S.W.A.T. base", ""]) {
      expect([t, checkText(t).isAllowed]).toEqual([t, true]);
    }
  });

  it("blocks ways to reach someone somewhere else, however they're spelled", () => {
    for (const t of ["add me on snap", "dm me", "discord.gg/abcd", "d i s c o r d", "disc0rd server", "my insta is coolkid", "snap: coolkid", "@coolkid12", "call 555 123 4567", "a.b@mail.co", "www.example", "example dot com", "whats app me", "teleGRAM"]) {
      expect([t, blocked(t)]).toEqual([t, "contact"]);
    }
  });

  it("blocks words that aren't allowed, dressed up or not", () => {
    for (const t of ["fuck this", "f u c k", "f.u.c.k off", "fvck", "free porn", "p0rn room"]) {
      expect([t, blocked(t)]).toEqual([t, "words"]);
    }
  });

  it("drops hidden and direction-flipping characters and extra spaces", () => {
    expect(tidyText("  Ana​'s ‮castle\n\n ", 40)).toBe("Ana's castle");
    expect(tidyText("x".repeat(50), 40)).toHaveLength(40);
    expect(blocked("dis​cord")).toBe("contact");
  });
});
