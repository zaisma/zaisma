import type { IconName } from "./foundations.ts";

/**
 * The one list: everything you press that has an icon, with its one word and one icon. A button, tab, menu item or sidebar place takes both from
 * here through action(), and can't be given an icon any other way. Change a line and it changes everywhere. Something pressed with only words
 * isn't listed: it just has its words. pressedIcon is what a two-state one shows while on.
 */
const LIST = {
  // Into a game. Join takes Play's icon because it starts a game the same way.
  play: { words: "Play", icon: "play" },
  join: { words: "Join", icon: "play" },
  watch: { words: "Watch", icon: "eye" },
  leave: { words: "Leave", icon: "door" },
  buy: { words: "Buy", icon: "cart" },
  update: { words: "Update", icon: "download" },
  zaisma: { words: "Zaisma", icon: "zaisma" },
  // People.
  invite: { words: "Invite", icon: "send" },
  inviteToGame: { words: "Invite to a game", icon: "send" },
  addFriend: { words: "Add friend", icon: "person-plus" },
  removeFriend: { words: "Remove friend", icon: "ban" },
  mute: { words: "Mute", icon: "speaker", pressedIcon: "speaker-off" },
  players: { words: "Players", icon: "people" },
  follow: { words: "Follow", icon: "bell" },
  like: { words: "Like", icon: "heart" },
  favorite: { words: "Favorite", icon: "star" },
  report: { words: "Report", icon: "flag" },
  // Things to do to something.
  change: { words: "Change", icon: "pencil" },
  remove: { words: "Remove", icon: "trash" },
  delete: { words: "Delete", icon: "trash" },
  copy: { words: "Copy", icon: "copy" },
  share: { words: "Share", icon: "share" },
  add: { words: "Add", icon: "plus" },
  make: { words: "Make", icon: "plus" },
  addCredit: { words: "Add credit", icon: "coin" },
  startPlan: { words: "Start a monthly plan", icon: "repeat" },
  stopPlan: { words: "Stop plan", icon: "pause" },
  turnOff: { words: "Turn off", icon: "pause" },
  newVersion: { words: "New version", icon: "upload" },
  refresh: { words: "Refresh", icon: "refresh" },
  sendTest: { words: "Send a test", icon: "send" },
  newSecret: { words: "New secret", icon: "lock" },
  deliveries: { words: "Deliveries", icon: "clock" },
  openStripe: { words: "Open Stripe", icon: "out-of-page" },
  // Moving around a page.
  back: { words: "Back", icon: "chevron-back" },
  close: { words: "Close", icon: "close" },
  more: { words: "More", icon: "more" },
  showAll: { words: "Show all", icon: "chevron-down" },
  previousPage: { words: "Previous page", icon: "chevron-back" },
  nextPage: { words: "Next page", icon: "chevron-forward" },
  search: { words: "Search", icon: "search" },
  filter: { words: "Filter", icon: "filter" },
  sidebar: { words: "Sidebar", icon: "sidebar" },
  lightDark: { words: "Light or dark", icon: "light-dark" },
  fullScreen: { words: "Full screen", icon: "full-screen", pressedIcon: "full-screen-exit" },
  playVideo: { words: "Play", icon: "play", pressedIcon: "pause" },
  // Showing and hiding: an open eye while it's visible, a crossed-out eye while it's hidden. A password rests hidden, so it's on while it's shown.
  hide: { words: "Hide", icon: "eye", pressedIcon: "eye-off" },
  showPassword: { words: "Show", icon: "eye-off", pressedIcon: "eye" },
  // Signing in.
  signIn: { words: "Sign in", icon: "sign-in" },
  signOut: { words: "Sign out", icon: "sign-out" },
  purchasePin: { words: "Purchase PIN", icon: "keypad" },
  password: { words: "Password", icon: "lock" },
  passkey: { words: "Passkey", icon: "passkey" },
  // Places.
  home: { words: "Home", icon: "home" },
  browse: { words: "Browse", icon: "compass" },
  yourGames: { words: "Your games", icon: "gamepad" },
  yourProfile: { words: "Your profile", icon: "person" },
  profile: { words: "Profile", icon: "person" },
  friends: { words: "Friends", icon: "friends" },
  developer: { words: "Developer", icon: "code" },
  settings: { words: "Settings", icon: "gear" },
  forum: { words: "Forum", icon: "forum" },
  inbox: { words: "Inbox", icon: "mail" },
  replies: { words: "Replies", icon: "reply" },
  mentions: { words: "Mentions", icon: "at-sign" },
  room: { words: "Room", icon: "closed-door" },
  thisGame: { words: "This game", icon: "gamepad" },
  hosting: { words: "Hosting", icon: "gauge" },
  pro: { words: "Pro", icon: "diamond" },
  payments: { words: "Payments", icon: "card" },
  webhooks: { words: "Webhooks", icon: "hook" },
  signInApps: { words: "Sign-in apps", icon: "apps" },
  keys: { words: "Keys", icon: "key" },
  genre: { words: "Genre", icon: "genre" },
  price: { words: "Price", icon: "price-tag" },
} as const satisfies Record<string, { words: string; icon: IconName; pressedIcon?: IconName }>;

export type ActionName = keyof typeof LIST;
/** An icon from the list: the only kind a button, tab, menu item or sidebar place takes. */
export type ListedIcon = IconName & { readonly isFromTheList: true };
export interface ListedAction {
  label: string;
  icon: ListedIcon;
  pressedIcon?: ListedIcon;
}

/**
 * An action's word and icon. words replaces its word where the page has to say more ("Mute Liam", "Report the room Northwatch"), never its icon.
 */
export const action = (name: ActionName, words?: string): ListedAction => {
  const listed: { words: string; icon: IconName; pressedIcon?: IconName } = LIST[name];
  return { label: words ?? listed.words, icon: listed.icon as ListedIcon, ...(listed.pressedIcon ? { pressedIcon: listed.pressedIcon as ListedIcon } : {}) };
};

/** Every action on the list, for the gallery. */
export const ACTION_NAMES = Object.keys(LIST) as ActionName[];
