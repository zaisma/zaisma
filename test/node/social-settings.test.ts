import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  SOCIAL_SETTINGS,
  chatBandGroup,
  isWithinAgeLimits,
  socialModeOf,
  socialModeSettings,
  socialSettingChoicesFor,
  socialSettingsInNewBand,
  withinAgeLimits,
  type SocialSettings,
} from "../../packages/core/src/social-settings.ts";
import { ageBandOn, birthDateText, birthdayToday } from "../../packages/core/src/accounts.ts";

/** Social settings: the presets, the age limits, and migration 0048 moving every account over from its social mode. */

const SOLO_FOCUSED: SocialSettings = { who_can_chat: "nobody", who_can_join: "friends", who_sees_playing_now: "friends", who_sees_played_games: "friends", who_sees_online: "friends", who_can_send_friend_requests: "nobody", who_sees_profile: "friends" };
const FRIENDS_FOCUSED: SocialSettings = { ...SOLO_FOCUSED, who_can_chat: "friends" };
const OPEN_AND_SOCIAL_ADULT: SocialSettings = { who_can_chat: "anyone", who_can_join: "anyone", who_sees_playing_now: "anyone", who_sees_played_games: "anyone", who_sees_online: "friends", who_can_send_friend_requests: "anyone", who_sees_profile: "anyone" };
const OPEN_AND_SOCIAL_TEEN: SocialSettings = { ...FRIENDS_FOCUSED, who_can_chat: "anyone", who_can_send_friend_requests: "anyone", who_sees_profile: "anyone" };

describe("social settings", () => {
  it("sets everything from a preset, within the band's limits", () => {
    expect(socialModeSettings("solo_focused", "18+")).toEqual(SOLO_FOCUSED);
    expect(socialModeSettings("friends_focused", "13-15")).toEqual(FRIENDS_FOCUSED);
    expect(socialModeSettings("open_and_social", "18+")).toEqual(OPEN_AND_SOCIAL_ADULT);
    expect(socialModeSettings("open_and_social", "16-17")).toEqual(OPEN_AND_SOCIAL_TEEN);
  });

  it("names the preset settings match, or custom", () => {
    expect(socialModeOf(SOLO_FOCUSED, "13-15")).toBe("solo_focused");
    expect(socialModeOf(OPEN_AND_SOCIAL_TEEN, "16-17")).toBe("open_and_social");
    expect(socialModeOf(OPEN_AND_SOCIAL_TEEN, "18+")).toBe("custom");
    expect(socialModeOf({ ...FRIENDS_FOCUSED, who_sees_online: "nobody" }, "18+")).toBe("custom");
  });

  it("keeps hard age limits: online never past friends, under 18 joining and what they play with friends, 13–15 chat with friends and invites only", () => {
    for (const band of ["13-15", "16-17", "18+"] as const) expect(socialSettingChoicesFor(band, "who_sees_online")).toEqual(["nobody", "friends"]);
    expect(socialSettingChoicesFor("13-15", "who_can_chat")).toEqual(["nobody", "friends"]);
    expect(socialSettingChoicesFor("13-15", "who_can_send_friend_requests")).toEqual(["nobody"]);
    expect(socialSettingChoicesFor("16-17", "who_can_chat")).toEqual(["nobody", "friends", "anyone"]);
    for (const setting of ["who_can_join", "who_sees_playing_now", "who_sees_played_games"] as const) {
      expect(socialSettingChoicesFor("16-17", setting)).toEqual(["nobody", "friends"]);
      expect(socialSettingChoicesFor("18+", setting)).toEqual(["nobody", "friends", "anyone"]);
    }
    expect(isWithinAgeLimits(OPEN_AND_SOCIAL_ADULT, "16-17")).toBe(false);
    expect(isWithinAgeLimits(OPEN_AND_SOCIAL_TEEN, "13-15")).toBe(false);
    expect(isWithinAgeLimits(OPEN_AND_SOCIAL_TEEN, "16-17")).toBe(true);
    // The backstop brings anything past a limit back to it, and anything unknown to the strictest choice.
    // Every band can open its profile to anyone: it starts at friends under 18, from the presets.
    expect(withinAgeLimits(OPEN_AND_SOCIAL_ADULT, "13-15")).toEqual({ ...FRIENDS_FOCUSED, who_sees_profile: "anyone" });
    for (const band of ["13-15", "16-17", "18+"] as const) expect(socialSettingChoicesFor(band, "who_sees_profile")).toEqual(["friends", "anyone"]);
    expect(withinAgeLimits({ ...OPEN_AND_SOCIAL_ADULT, who_sees_online: "anyone" as never, who_can_join: "everyone" as never }, "18+")).toEqual({ ...OPEN_AND_SOCIAL_ADULT, who_sees_online: "nobody", who_can_join: "nobody" });
  });

  it("keeps a preset when moving up a band, and Custom as it was", () => {
    expect(socialSettingsInNewBand({ ...OPEN_AND_SOCIAL_TEEN, age_band: "16-17" }, "18+")).toEqual(OPEN_AND_SOCIAL_ADULT);
    expect(socialSettingsInNewBand({ ...FRIENDS_FOCUSED, age_band: "13-15" }, "16-17")).toEqual(FRIENDS_FOCUSED);
    const custom = { ...FRIENDS_FOCUSED, who_can_chat: "anyone" as const };
    expect(socialSettingsInNewBand({ ...custom, age_band: "16-17" }, "18+")).toEqual(custom);
  });

  it("puts every account that chats at all in its own band's group, friends included, and nobody in none", () => {
    expect(chatBandGroup({ age_band: "16-17", who_can_chat: "anyone" })).toBe("16-17");
    expect(chatBandGroup({ age_band: "18+", who_can_chat: "anyone" })).toBe("18+");
    expect(chatBandGroup({ age_band: "18+", who_can_chat: "friends" })).toBe("18+");
    expect(chatBandGroup({ age_band: "13-15", who_can_chat: "friends" })).toBe("13-15");
    expect(chatBandGroup({ age_band: "18+", who_can_chat: "nobody" })).toBeNull();
  });
});

describe("birthdays", () => {
  it("reads a kept birth date's band on a day, the same as the age question", () => {
    expect(birthDateText({ yearNumber: 2011, monthNumber: 3, dayNumber: 9 })).toBe("2011-03-09");
    expect(ageBandOn("2010-10-17", new Date(Date.UTC(2026, 9, 16)))).toBe("13-15");
    expect(ageBandOn("2010-10-17", new Date(Date.UTC(2026, 9, 17)))).toBe("16-17");
    // Born on 29 February: a year older on 1 March when there's no 29th.
    expect(ageBandOn("2012-02-29", new Date(Date.UTC(2030, 1, 28)))).toBe("16-17");
    expect(ageBandOn("2012-02-29", new Date(Date.UTC(2030, 2, 1)))).toBe("18+");
    expect(ageBandOn("2020-01-01", new Date(Date.UTC(2026, 9, 17)))).toBeNull();
    expect(ageBandOn("not a date", new Date())).toBeNull();
  });

  it("counts a birthday only once it has come in the last time zone", () => {
    expect(birthdayToday(Date.UTC(2027, 0, 1, 11, 59)).toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(birthdayToday(Date.UTC(2027, 0, 1, 12)).toISOString().slice(0, 10)).toBe("2027-01-01");
  });
});

const MIGRATIONS = join(import.meta.dirname, "../../migrations");

describe("migrations 0048 and 0051", () => {
  /**
   * A database with every migration before 0048, an account on each social mode in each band, and then
   * 0048 and the rest (0051 adds who sees my profile, anyone for accounts on open and social).
   */
  function migrated(): DatabaseSync {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
    const at = files.findIndex((name) => name.startsWith("0048_"));
    for (const file of files.slice(0, at)) database.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    const insert = database.prepare("INSERT INTO accounts (id, player_id, username, age_band, social_mode, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 1, 2)");
    for (const [id, band, socialMode] of [
      ["young-solo", "13-15", "solo_focused"],
      ["young-friends", "13-15", "friends_focused"],
      ["teen-friends", "16-17", "friends_focused"],
      ["teen-open", "16-17", "open_and_social"],
      ["adult-solo", "18+", "solo_focused"],
      ["adult-open", "18+", "open_and_social"],
    ]) insert.run(id!, `player_${id!.replace("-", "")}aaaaaaaaaa`, id!, band!, socialMode!);
    database.exec("INSERT INTO owners (id, kind, account_id, created_at_ms) VALUES ('owner_owner1aaaaaaaaaaaaaaa', 'person', 'adult-open', 1)");
    // D1 runs a migration as one transaction.
    for (const file of files.slice(at)) database.exec(`BEGIN; ${readFileSync(join(MIGRATIONS, file), "utf8")}\nCOMMIT;`);
    return database;
  }

  it("keeps every account on the preset it was on, and drops the social mode", () => {
    const database = migrated();
    const settingsOf = (id: string) => database.prepare(`SELECT ${SOCIAL_SETTINGS.join(", ")} FROM accounts WHERE id = ?`).get(id);
    expect(settingsOf("young-solo")).toEqual(SOLO_FOCUSED);
    expect(settingsOf("young-friends")).toEqual(FRIENDS_FOCUSED);
    expect(settingsOf("teen-friends")).toEqual(FRIENDS_FOCUSED);
    expect(settingsOf("teen-open")).toEqual(OPEN_AND_SOCIAL_TEEN);
    expect(settingsOf("adult-solo")).toEqual(SOLO_FOCUSED);
    expect(settingsOf("adult-open")).toEqual(OPEN_AND_SOCIAL_ADULT);
    const columns = (database.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]).map((column) => column.name);
    expect(columns).not.toContain("social_mode");
    expect(database.prepare("SELECT updated_at_ms FROM accounts WHERE id = 'adult-open'").get()).toEqual({ updated_at_ms: 2 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("refuses choices a setting doesn't have, and starts new rows solo-focused", () => {
    const database = migrated();
    const insert = (setting: string, choice: string) => database.prepare(`INSERT INTO accounts (id, player_id, username, age_band, ${setting}, created_at_ms, updated_at_ms) VALUES (?, ?, ?, '18+', ?, 1, 1)`).run(`id-${setting}-${choice}`, `player_${setting.length}${choice}`, `X_${setting.length}${choice}`, choice);
    expect(() => insert("who_sees_online", "anyone")).toThrow(/CHECK/);
    expect(() => insert("who_can_send_friend_requests", "friends")).toThrow(/CHECK/);
    expect(() => insert("who_can_chat", "open_and_social")).toThrow(/CHECK/);
    expect(() => insert("who_sees_profile", "nobody")).toThrow(/CHECK/);
    database.prepare("INSERT INTO accounts (id, player_id, username, age_band, created_at_ms, updated_at_ms) VALUES ('fresh', 'player_fresh', 'Fresh', '18+', 1, 1)").run();
    expect(database.prepare(`SELECT ${SOCIAL_SETTINGS.join(", ")} FROM accounts WHERE id = 'fresh'`).get()).toEqual(SOLO_FOCUSED);
  });
});
