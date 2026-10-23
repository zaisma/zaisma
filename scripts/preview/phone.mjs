// The preview on a phone (background.mjs): when this Mac is on a tailnet with HTTPS on, Tailscale Serve answers the ports a
// browser opens at https://<this Mac's tailnet name>:<the same port> and hands them on to the preview here. Only the tailnet's
// own devices reach it, never the internet, so the stand-in sign-in and test data stay private. Without Tailscale, or with
// --local, the preview stays on localhost as before.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// The Mac app's command line, or the one Homebrew or the app's "Install CLI" put on the PATH.
const APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const cli = () => (spawnSync("tailscale", ["version"], { encoding: "utf8" }).status === 0 ? "tailscale" : existsSync(APP_CLI) ? APP_CLI : null);

/** The ports a browser opens, for an offset (in step with run.mjs's PORTS): the site, games, rooms and the mailbox. */
export const phonePortsFor = (offset) => [8800, 8801, 8802, 8795].map((port) => port + offset);

/**
 * This Mac's tailnet name (like "julius-mac.tail1234.ts.net") when Tailscale is running here and the tailnet gives it an
 * HTTPS certificate, else null with why: { host, reason }.
 */
export function tailnetHost() {
  const command = cli();
  if (!command) return { host: null, reason: "Tailscale isn't installed" };
  const answer = spawnSync(command, ["status", "--json"], { encoding: "utf8", timeout: 10_000 });
  let status;
  try {
    status = JSON.parse(answer.stdout);
  } catch {
    return { host: null, reason: "Tailscale didn't answer" };
  }
  if (status.BackendState !== "Running") return { host: null, reason: `Tailscale is ${String(status.BackendState).toLowerCase()}` };
  const host = String(status.Self?.DNSName ?? "").replace(/\.$/, "");
  if (!host || !(status.CertDomains ?? []).includes(host)) return { host: null, reason: "HTTPS certificates are off in the tailnet's DNS settings" };
  return { host, reason: null };
}

/** Has Tailscale Serve answer each phone port over HTTPS and hand it on here. Returns null, or what Tailscale said when it couldn't. */
export function serveOnTailnet(offset) {
  const command = cli();
  for (const port of phonePortsFor(offset)) {
    const answer = spawnSync(command, ["serve", "--bg", "--yes", `--https=${port}`, `http://127.0.0.1:${port}`], { encoding: "utf8", timeout: 30_000 });
    if (answer.status !== 0) return `${answer.stdout ?? ""}${answer.stderr ?? ""}`.trim() || `tailscale serve ended with ${answer.status}`;
  }
  return null;
}

/** Turns those ports off again on the tailnet (any that weren't on are skipped). */
export function stopServingOnTailnet(offset) {
  const command = cli();
  if (!command) return;
  for (const port of phonePortsFor(offset)) spawnSync(command, ["serve", `--https=${port}`, "off"], { encoding: "utf8", timeout: 10_000 });
}
