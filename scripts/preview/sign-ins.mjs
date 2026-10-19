// The preview's test accounts that sign in with a password, for the seed (run.mjs) and the start
// command (background.mjs). Admin pages need no sign-in on localhost.

// Every preview account's password.
export const PASSWORD = "preview password";

export const SIGN_INS = [
  { username: "Preview_Studio", about: "owns the test games and the forum's developer posts" },
  { username: "Moss_Runner", about: "a friend, adult, open and social, playing Shard Dodge (16 and up)" },
  { username: "Quiet_Comet", about: "a friend, 14, private to friends" },
  { username: "Bright_Reed", about: "16, open and social, not a friend" },
  { username: "Tall_Pine", about: "a friend with custom social settings" },
  { username: "Kit_Spark", about: "a friend in a full Four in a Row room" },
  { username: "Key_Maker", about: "no passkey yet: make an API key to see the wizard add one first" },
  { username: "Waiting_Key", about: "its newest passkey waits a day before it can make keys" },
  { username: "New_Passkey", about: "its only passkey waits a day: the connect page for AI apps says when it can connect them" },
  { username: "Guessed_At", about: "locked out by wrong passwords: get in with Forgot password, guessed@example.test" },
  { username: "Saved_Farmer", about: "no passkey or email, back to a Tiny Farm save: the home page asks once to protect the account" },
  { username: "Gone_Dev", about: "owns two games: delete the account to see them deleted with it" },
  { username: "Mia_Plays", about: "played Cave Crew and has a row in its database: delete her account to see it erased" },
];
