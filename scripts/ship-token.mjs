// The Cloudflare API token npm run ship deploys with. It lives in the macOS keychain, never in a file,
// the repo or the output, so ship never depends on wrangler's own sign-in (one sign-in shared by every
// session on the Mac, renewed by whichever process gets there first).
import { spawnSync } from "node:child_process";

export const SHIP_TOKEN_SERVICE = "zaisma-ship-cloudflare-api-token";
// Zaisma's Cloudflare account (not a secret; the account's name is "Zaisma").
export const ZAISMA_ACCOUNT_ID = "effa24b1867c31d94c59b885dc471fc3";

/** What the token needs, as the dashboard's "Create Custom Token" rows. Kept in step with docs/SHIPPING.md in ops. */
export const SHIP_TOKEN_PERMISSIONS = [
  "Account > Workers Scripts > Edit",
  "Account > D1 > Edit",
  "Account > Queues > Edit",
  "Account > Workers R2 Storage > Edit",
  "Account > Cloudchamber > Edit",
  "Zone > Workers Routes > Edit",
  "Zone > DNS > Edit",
  "Zone > Zone > Read",
];

/** The token from the keychain, or null when there is none. Never printed or logged. */
export function readShipToken() {
  const result = spawnSync("security", ["find-generic-password", "-s", SHIP_TOKEN_SERVICE, "-w"], { encoding: "utf8" });
  const token = (result.stdout ?? "").trim();
  return result.status === 0 && token ? token : null;
}

/** The steps for making the token, for the message when there is none. */
export function missingShipTokenHelp() {
  return [
    "No Cloudflare API token for ship in the keychain, so nothing was deployed and wrangler's own sign-in is not used.",
    "Make one: Cloudflare dashboard > My Profile > API Tokens > Create Token > Create Custom Token, with these permissions:",
    ...SHIP_TOKEN_PERMISSIONS.map((permission) => `  ${permission}`),
    "Account Resources: Include > Zaisma. Zone Resources: Include > All zones from account Zaisma. No IP filter, no expiry.",
    "Then store it (the command asks for the token without showing it):",
    `  security add-generic-password -a "$USER" -s ${SHIP_TOKEN_SERVICE} -w`,
    "Details: docs/SHIPPING.md in ops.",
  ].join("\n");
}

/** Puts the token in this process's environment, so every wrangler call (and its children) uses it. Returns false when there is none. */
export function useShipToken(environment = process.env) {
  const token = readShipToken();
  if (!token) return false;
  environment.CLOUDFLARE_API_TOKEN = token;
  environment.CLOUDFLARE_ACCOUNT_ID = ZAISMA_ACCOUNT_ID;
  return true;
}
