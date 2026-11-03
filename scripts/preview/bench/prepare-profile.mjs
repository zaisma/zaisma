// npm run bench:prepare -- <username> "<what it's for>": puts a test account a session made for its work on the Screens bench, under
// "Prepared for this work". Per checkout: it goes with the worktree. Make the account in the preview's seed (scripts/preview/run.mjs), with the preview password.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PREPARED_PROFILES_FILE } from "./bench-files.mjs";

const [username, about] = process.argv.slice(2);
if (!/^[A-Za-z0-9_]+$/.test(username ?? "") || !about) {
  console.error(`npm run bench:prepare -- <username> "<what it's for>"`);
  process.exit(1);
}
let prepared = [];
try { prepared = JSON.parse(readFileSync(PREPARED_PROFILES_FILE, "utf8")); } catch { /* the first one */ }
mkdirSync(dirname(PREPARED_PROFILES_FILE), { recursive: true });
writeFileSync(PREPARED_PROFILES_FILE, JSON.stringify([...prepared.filter((each) => each.username !== username), { username, about }]));
console.log(`${username} is on the bench's profile menu, under Prepared for this work.`);
