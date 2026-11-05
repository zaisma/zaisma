import type { CheckedPage, CheckedPageName } from "./components/checked-pages.ts";

/**
 * The pages still in the old look (Steel, html.ts), each screen by name: every page says which screen it is (layout's checkedPage), so each has
 * a button on the Screens bench or a written reason (scripts/preview/bench/places.ts). The layout check doesn't measure these, so they're
 * kept apart from its list. A page rebuilt in Zaisma's look has to move to CHECKED_PAGE_LIST (components/checked-pages.ts), since only a name
 * there goes with a pageShape, and it's measured from then on.
 */
const STEEL_PAGE_LIST = [
  { name: "A message, in the old look", path: "/no-such-page" },
  { name: "Check your email, in the old look", path: "/account", account: "Moss_Runner" },
  { name: "Your account", path: "/account", account: "Moss_Runner" },
  { name: "A player's profile", path: "/@Moss_Runner" },
  { name: "Report a player", path: "/@Moss_Runner/report", account: "Preview_Studio" },
  { name: "Friends", path: "/friends", account: "Preview_Studio" },
  { name: "A friend invite", path: "/friends/add/no-such-invite" },
  { name: "Your games", path: "/dashboard", account: "Preview_Studio" },
  { name: "Your games, banned", path: "/dashboard", account: "Banned_Dev" },
  { name: "A game not found", path: "/dashboard/no-such-game", account: "Preview_Studio" },
  { name: "A game's overview", path: "/dashboard/tiny-farm", account: "Preview_Studio" },
  { name: "A game's versions", path: "/dashboard/tiny-farm/versions", account: "Preview_Studio" },
  { name: "A game's details", path: "/dashboard/tiny-farm/details", account: "Preview_Studio" },
  { name: "A game's players", path: "/dashboard/tiny-farm/players", account: "Preview_Studio" },
  { name: "A game's database", path: "/dashboard/tiny-farm/database", account: "Preview_Studio" },
  { name: "Cover guide", path: "/developers/covers" },
  { name: "DMCA notices", path: "/legal/dmca" },
  { name: "Defamation notices", path: "/legal/defamation" },
  { name: "Forum", path: "/forum" },
  { name: "A forum topic", path: "/forum" },
  { name: "Forum, not found", path: "/forum/topic_nosuchtopic" },
  { name: "Forum, not a link", path: "/forum/out?to=nope" },
  { name: "Forum, leaving Zaisma", path: "/forum/out?to=https://example.test/" },
  { name: "Forum, report a post", path: "/forum" },
  { name: "Forum, new topic", path: "/forum/new", account: "Preview_Studio" },
  { name: "Forum, message Zaisma", path: "/forum/messages/new", account: "Preview_Studio" },
  { name: "Admin", path: "/admin" },
  { name: "Admin, a game", path: "/admin/games/game_previewsharddash001" },
  { name: "Admin, audit log", path: "/admin/audit" },
  { name: "Admin, profiles", path: "/admin/profiles" },
  { name: "Admin, chat reviews", path: "/admin/chat-reviews" },
  { name: "Admin, publishing", path: "/admin/publishing" },
  { name: "Admin, reports", path: "/admin/reports" },
  { name: "Admin, precedents", path: "/admin/precedents" },
  { name: "Admin, review precedents", path: "/admin/review-precedents" },
  { name: "Admin, feedback", path: "/admin/feedback" },
  { name: "Admin, a feedback note", path: "/admin/feedback" },
] as const satisfies readonly Pick<CheckedPage, "name" | "path" | "account">[];
export const STEEL_PAGES: readonly Pick<CheckedPage, "name" | "path" | "account">[] = STEEL_PAGE_LIST;
/** A page in the old look's name (layout's checkedPage). */
export type SteelPageName = (typeof STEEL_PAGE_LIST)[number]["name"];
/** The screen a page says it is, in either look. */
export type PageName = CheckedPageName | SteelPageName;
