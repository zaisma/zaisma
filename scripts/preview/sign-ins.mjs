// The preview's test accounts that sign in with a password, for the seed (run.mjs) and the start
// command (background.mjs). Admin pages need no sign-in on localhost.

// Every preview account's password.
export const PASSWORD = "preview password";

export const SIGN_INS = [
  { username: "Preview_Studio", about: "owns the test games and the forum's developer posts" },
  { username: "Moss_Runner", about: "a friend, adult, open and social, playing Shard Dodge (16 and up); no saved card or PIN, so Tiny Farm's shop starts from nothing" },
  { username: "Quiet_Comet", about: "a friend, 14, private to friends" },
  { username: "Bright_Reed", about: "16, open and social, not a friend" },
  { username: "Chat_Owl", about: "an adult, open and social, to chat with Moss_Runner in Chat Test" },
  { username: "Tall_Pine", about: "a friend with custom social settings" },
  { username: "Kit_Spark", about: "a friend in a full Four in a Row room" },
  { username: "Key_Maker", about: "no passkey yet: make an API key to see the wizard add one first" },
  { username: "Waiting_Key", about: "its newest passkey waits a day before it can make keys" },
  { username: "New_Passkey", about: "its only passkey waits a day: the connect page for AI apps says when it can connect them" },
  { username: "Guessed_At", about: "locked out by wrong passwords: get in with Forgot password, guessed@example.test" },
  { username: "Saved_Farmer", about: "no passkey or email, back to a Tiny Farm save: the home page asks once to protect the account, and Tiny Farm's shop says to add a passkey or email before saving a card" },
  { username: "Quiet_Builder", about: "no email, with an API key: security alerts wait on its account page and dashboard, and it's asked for an email" },
  { username: "Gone_Dev", about: "owns two games: delete the account to see them deleted with it" },
  { username: "Loud_Lynx", about: "reported in Arena for a real-life threat and following after a block" },
  { username: "Stopped_Fox", about: "its social side was turned off after a report: see /account#social and /friends" },
  { username: "Card_Keeper", about: "a saved Visa 4242 and owns Straw Hat (granted): Tiny Farm's shop buys Revive with one press (no confirm: no PIN, signed in just now, small spend), and Straw Hat says it's owned" },
  { username: "Pin_Keeper", about: "purchase PIN 246810 and no saved card: Tiny Farm's shop asks for the PIN on every buy once a card is saved, after adding a Test card" },
  { username: "Mia_Plays", about: "played Cave Crew and has a row in its database: delete her account to see it erased" },
  // The stress accounts (docs/DESIGN.md, Pages under stress): the layout check opens the pages that list things as each.
  { username: "Longest_Names_Here", about: "every name as long as its field allows: a 30-letter display name, a full bio, and an unlisted game with an 80-letter title and a 500-letter description" },
  { username: "Empty_Handed", about: "an adult with nothing yet: no games played, no friends, no saves, and a developer with no games" },
  { username: "Many_Things", about: "a great many things: 60 games played, 120 friends, and a developer with 40 unlisted games and 10 webhooks, as many as an account can have" },
];
