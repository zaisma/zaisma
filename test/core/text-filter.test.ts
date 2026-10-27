import { describe, expect, it } from "vitest";
import { checkChatText, checkText, tidyText } from "../../packages/core/src/text-filter.ts";

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

describe("chat filter rules", () => {
  const chat = (text: string, recentTexts: string[] = []) => checkChatText(text, recentTexts);

  it("blocks contact details in any disguise, moving apps and meeting up", () => {
    for (const t of ["add me on snap", "five five five one two three four", "meet up irl", "meet in person saturday", "d i s c o r d", "lets talk on another app", "what's your number"]) {
      expect([t, chat(t)]).toEqual([t, { verdict: "blocked", reason: "contact_details", hasSwearing: false, hasSlur: false }]);
    }
    // A number sent a few digits at a time, and an app's name split over messages.
    expect(chat("4567", ["555", "123"]).reason).toBe("contact_details");
    expect(chat("cord", ["join my dis"]).reason).toBe("contact_details");
    // A message after one that was blocked already isn't blocked for it.
    expect(chat("ok sorry", ["add me on snap"]).verdict).toBe("allowed");
  });

  it("blocks personal details and sexual content", () => {
    expect(chat("what school do you go to").reason).toBe("personal_details");
    expect(chat("i live on 12 oak street").reason).toBe("personal_details");
    expect(chat("send me a selfie").reason).toBe("personal_details");
    expect(chat("wanna see my d1ldo").reason).toBe("sexual");
    expect(chat("send nudes").reason).toBe("sexual");
  });

  it("flags swearing without blocking it, and leaves game talk alone", () => {
    expect(chat("that jump is fucking impossible")).toEqual({ verdict: "allowed", reason: null, hasSwearing: true, hasSlur: false });
    expect(chat("this level is shit")).toEqual({ verdict: "allowed", reason: null, hasSwearing: true, hasSlur: false });
    for (const t of ["how old are you", "gg ez", "go to 120 455", "Scunthorpe United", "Assassin's den", ""]) {
      expect([t, chat(t)]).toEqual([t, { verdict: "allowed", reason: null, hasSwearing: false, hasSlur: false }]);
    }
  });

  it("flags slurs and never blocks them: the game's call (Oct 26, 2026), while the four kinds still block", () => {
    expect(chat("you f a g")).toEqual({ verdict: "allowed", reason: null, hasSwearing: false, hasSlur: true });
    expect(chat("gg you retard")).toMatchObject({ verdict: "allowed", reason: null, hasSlur: true });
    expect(chat("you f a g, add me on snap")).toMatchObject({ verdict: "blocked", reason: "contact_details", hasSlur: true });
    expect(chat("what school do you go to").reason).toBe("personal_details");
    expect(chat("send nudes").reason).toBe("sexual");
    expect(chat("meet me irl").reason).toBe("contact_details");
    // A meeting place that could be in the game is the AI's to tell, a narrow second look that sends when in doubt.
    expect(chat("meet me at the old mill").verdict).toBe("unclear");
    expect(chat("westfield mall saturday").verdict).toBe("allowed");
    expect(chat("meet irl at westfield saturday, my mom can drive").reason).toBe("contact_details");
    expect(chat("meet at 120 45 at 9:30").verdict).not.toBe("blocked");
    // A phone number spelled out over two messages is caught by the rules, before any AI.
    expect(chat("seven seven seven", ["five five five one two"]).reason).toBe("contact_details");
  });

  it("sends what the rules can't tell to the AI", () => {
    for (const t of ["score 1234567", "where are you", "¿Dónde vives? Tengo trece años", "Привет как дела", "are your parents home"]) {
      expect([t, chat(t)]).toEqual([t, { verdict: "unclear", reason: null, hasSwearing: false, hasSlur: false }]);
    }
  });

  it("leaves Zaisma's own pages' filter as it was", () => {
    expect(checkText("this level is shit").reason).toBe("words");
  });
});
