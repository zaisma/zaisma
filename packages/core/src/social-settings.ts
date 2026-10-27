import type { AgeBand } from "./accounts.ts";

/**
 * Who can do what with a player (docs/DECISIONS.md, "Social settings, with the social modes as presets"):
 * separate settings in the Social section of the account page, each a choice of who, fewest people
 * first. The three social modes are presets that set them all at once; settings that match none are
 * Custom. Age limits are hard: neither a preset nor Custom gets past them.
 */
export interface SocialSettings {
  /** Text and voice, in games that have chat. Anyone reaches only the player's own band group, and only others who chat with anyone. */
  who_can_chat: "nobody" | "friends" | "anyone";
  /** Who can join the game the player is in, from Zaisma. */
  who_can_join: "nobody" | "friends" | "anyone";
  /** Who sees the game the player is in right now. */
  who_sees_playing_now: "nobody" | "friends" | "anyone";
  /** Who sees the games the player played lately. */
  who_sees_played_games: "nobody" | "friends" | "anyone";
  /** Who sees that the player has zaisma.com open. Never anyone: a stranger can do nothing with it. */
  who_sees_online: "nobody" | "friends";
  /**
   * Who can send the player a friend request: nobody means friends come by invites only, played_with the
   * players they were in a room with now or within the last hour. Anyone and played_with reach only the
   * player's own band group.
   */
  who_can_send_friend_requests: "nobody" | "played_with" | "anyone";
  /** Who gets past the profile's header (name, @username and published games always show). */
  who_sees_profile: "friends" | "anyone";
}

export type SocialSetting = keyof SocialSettings;

/** Each setting's choices, fewest people first. A new setting goes here, in every preset and in every band's limits. */
export const SOCIAL_SETTING_CHOICES: { readonly [setting in SocialSetting]: readonly SocialSettings[setting][] } = {
  who_can_chat: ["nobody", "friends", "anyone"],
  who_can_join: ["nobody", "friends", "anyone"],
  who_sees_playing_now: ["nobody", "friends", "anyone"],
  who_sees_played_games: ["nobody", "friends", "anyone"],
  who_sees_online: ["nobody", "friends"],
  who_can_send_friend_requests: ["nobody", "played_with", "anyone"],
  who_sees_profile: ["friends", "anyone"],
};

export const SOCIAL_SETTINGS = Object.keys(SOCIAL_SETTING_CHOICES) as SocialSetting[];

/** The presets: solo-focused, friends-focused, or open and social. */
export type SocialMode = "solo_focused" | "friends_focused" | "open_and_social";

export const SOCIAL_MODES: readonly SocialMode[] = ["solo_focused", "friends_focused", "open_and_social"];

export const isSocialMode = (given: unknown): given is SocialMode => SOCIAL_MODES.includes(given as SocialMode);

/** What each preset sets, before the band's limits. */
const SOCIAL_MODE_SETTINGS: Record<SocialMode, SocialSettings> = {
  solo_focused: { who_can_chat: "nobody", who_can_join: "friends", who_sees_playing_now: "friends", who_sees_played_games: "friends", who_sees_online: "friends", who_can_send_friend_requests: "nobody", who_sees_profile: "friends" },
  // Friends-focused keeps every way to reach the player with friends, but anyone can offer friendship (Julius, Oct 27, 2026).
  friends_focused: { who_can_chat: "friends", who_can_join: "friends", who_sees_playing_now: "friends", who_sees_played_games: "friends", who_sees_online: "friends", who_can_send_friend_requests: "anyone", who_sees_profile: "friends" },
  open_and_social: { who_can_chat: "anyone", who_can_join: "anyone", who_sees_playing_now: "anyone", who_sees_played_games: "anyone", who_sees_online: "friends", who_can_send_friend_requests: "anyone", who_sees_profile: "anyone" },
};

/**
 * The most each band can open each setting to. Under 18, joining and what they play or played stay
 * with friends; 13–15 also chat only with friends and take friend requests at most from players they play with. Every band can open its profile
 * to anyone (it starts at friends under 18, from the presets).
 */
const AGE_LIMITS: Record<AgeBand, SocialSettings> = {
  "13-15": { who_can_chat: "friends", who_can_join: "friends", who_sees_playing_now: "friends", who_sees_played_games: "friends", who_sees_online: "friends", who_can_send_friend_requests: "played_with", who_sees_profile: "anyone" },
  "16-17": { who_can_chat: "anyone", who_can_join: "friends", who_sees_playing_now: "friends", who_sees_played_games: "friends", who_sees_online: "friends", who_can_send_friend_requests: "anyone", who_sees_profile: "anyone" },
  "18+": { who_can_chat: "anyone", who_can_join: "anyone", who_sees_playing_now: "anyone", who_sees_played_games: "anyone", who_sees_online: "friends", who_can_send_friend_requests: "anyone", who_sees_profile: "anyone" },
};

/** Where a choice sits in its setting's list, fewest people first; -1 for one that isn't there. */
const choiceIndexOf = (setting: SocialSetting, choice: unknown) => (SOCIAL_SETTING_CHOICES[setting] as readonly unknown[]).indexOf(choice);

/** The choices a band has for a setting, fewest people first. */
export function socialSettingChoicesFor<Setting extends SocialSetting>(band: AgeBand, setting: Setting): readonly SocialSettings[Setting][] {
  return SOCIAL_SETTING_CHOICES[setting].slice(0, choiceIndexOf(setting, AGE_LIMITS[band][setting]) + 1);
}

/** Whether a choice is one of the band's for that setting. */
export function isSocialSettingChoice(band: AgeBand, setting: SocialSetting, given: unknown): boolean {
  return (socialSettingChoicesFor(band, setting) as readonly unknown[]).includes(given);
}

/** Whether every setting is a choice the band has. */
export function isWithinAgeLimits(settings: SocialSettings, band: AgeBand): boolean {
  return SOCIAL_SETTINGS.every((setting) => isSocialSettingChoice(band, setting, settings[setting]));
}

/** Each setting brought within the band's limits, and anything unknown to its strictest choice: the backstop wherever settings are used. */
export function withinAgeLimits(settings: SocialSettings, band: AgeBand): SocialSettings {
  const limited = {} as Record<SocialSetting, string>;
  for (const setting of SOCIAL_SETTINGS) {
    const choiceIndex = choiceIndexOf(setting, settings[setting]);
    limited[setting] = choiceIndex < 0 ? SOCIAL_SETTING_CHOICES[setting][0]! : SOCIAL_SETTING_CHOICES[setting][Math.min(choiceIndex, choiceIndexOf(setting, AGE_LIMITS[band][setting]))]!;
  }
  return limited as SocialSettings;
}

/** Just the settings, from an account row or a form. */
export function pickSocialSettings(source: SocialSettings): SocialSettings {
  return Object.fromEntries(SOCIAL_SETTINGS.map((setting) => [setting, source[setting]])) as unknown as SocialSettings;
}

/** An account's settings as they apply: within its band's limits, whatever its row says. */
export function socialSettingsOf(account: SocialSettings & { age_band: AgeBand }): SocialSettings {
  return withinAgeLimits(account, account.age_band);
}

/** The social modes a band can choose: 13–15 never open and social. */
export function socialModesFor(band: AgeBand): readonly SocialMode[] {
  return band === "13-15" ? ["solo_focused", "friends_focused"] : SOCIAL_MODES;
}

/** Where a new account starts: 13–15 with no chat, everyone else with friends only. */
export function defaultSocialMode(band: AgeBand): SocialMode {
  return band === "13-15" ? "solo_focused" : "friends_focused";
}

/**
 * What a preset sets for a band, within its limits: open and social at 16–17 keeps joining and what they play with friends.
 * At 13–15 every preset takes friends by invites only, so People I play with is only ever their own choice under Custom
 * (Julius, Oct 27, 2026: "they can turn on People I play with, default stays Invites only").
 */
export function socialModeSettings(socialMode: SocialMode, band: AgeBand): SocialSettings {
  const settings = withinAgeLimits(SOCIAL_MODE_SETTINGS[socialMode], band);
  return band === "13-15" ? { ...settings, who_can_send_friend_requests: "nobody" } : settings;
}

export const sameSocialSettings = (first: SocialSettings, second: SocialSettings) => SOCIAL_SETTINGS.every((setting) => first[setting] === second[setting]);

/** The preset these settings match for the band, or custom when they match none. */
export function socialModeOf(settings: SocialSettings, band: AgeBand): SocialMode | "custom" {
  return socialModesFor(band).find((socialMode) => sameSocialSettings(socialModeSettings(socialMode, band), settings)) ?? "custom";
}

/**
 * The settings after moving up a band: an account on a preset keeps it, so open and social opens up
 * further at 18; Custom stays as it was.
 */
export function socialSettingsInNewBand(account: SocialSettings & { age_band: AgeBand }, band: AgeBand): SocialSettings {
  const settings = socialSettingsOf(account);
  const socialMode = socialModeOf(settings, account.age_band);
  return socialMode === "custom" ? withinAgeLimits(settings, band) : socialModeSettings(socialMode, band);
}

/**
 * The chat group an account chats in: its own age band, whatever its setting, so chat never leaves the
 * band, friends included (Julius, Oct 26, 2026: "No matter what setting you pick, everyone's in your age
 * band"). Null when it chats with nobody. Never leaves Zaisma as it is: passes carry an opaque chat group
 * made from it (chatGroupId), so games never learn an age.
 */
export function chatBandGroup(account: Pick<SocialSettings, "who_can_chat"> & { age_band: AgeBand }): AgeBand | null {
  if (account.who_can_chat === "nobody") return null;
  return account.age_band;
}
