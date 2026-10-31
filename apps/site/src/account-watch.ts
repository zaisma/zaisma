import type { Env } from "./env.ts";
import { sendAlert } from "./email.ts";
import { sendPush } from "./push.ts";

/**
 * "Zaisma's own accounts are watched" (docs/DECISIONS.md in the ops repo): a takeover's first move is a lasting key or
 * a new member, and none of these accounts alerts on it. Runs on the site's 5-minute cron: lists the members, keys,
 * apps and tokens of Zaisma's GitHub, npm, Supabase and Cloudflare accounts with read-only tokens, compares each list
 * with the last good read (account_watch_items), and tells Julius of each new item with an emergency push and an
 * email, even when he made it himself. A list's first read is the baseline; a removed item alerts nobody. Cloudflare
 * is pushed from outside Cloudflare (scripts/watch-checks.mjs, checkCloudflareAccount), so here it's email only: a
 * Cloudflare taken over can stop this email, not that push.
 */

export type WatchServiceName = "cloudflare" | "github" | "npm" | "supabase";
export type WatchItemKind = "member" | "outside_collaborator" | "invitation" | "app" | "deploy_key" | "maintainer" | "account_token" | "user_token";
/** One listed watchItem, with the words and page its alert needs. */
export type WatchItem = { itemId: string; itemLabel: string; createdAtMs: number | null; itemWords: string; listPageUrl: string };
type KindListing = { serviceName: WatchServiceName; itemKind: WatchItemKind } & ({ items: WatchItem[] } | { failureText: string });
type NewItem = WatchItem & { serviceName: WatchServiceName };

const MINUTE_MS = 60_000;
export const ACCOUNT_WATCH_LIMITS = {
  /** Alerts one by one in a run; the rest go in one more push and email. */
  maximumAlertCount: 10,
  /** Pages read of one list, at most: far past Zaisma's accounts, and it bounds the cron's requests. */
  maximumPageCount: 20,
  /** A list that can't be read is told after this long, then every 24 hours. */
  failureWaitDurationMin: 60,
  failureReminderIntervalMin: 24 * 60,
} as const;

const GITHUB_ORGANIZATION = "zaisma";
const GITHUB_API_URL = "https://api.github.com";
const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const NPM_ORGANIZATION = "zaisma";
const SUPABASE_API_URL = "https://api.supabase.com";
const CLOUDFLARE_API_URL = "https://api.cloudflare.com/client/v4";

const SERVICE_WORDS: Record<WatchServiceName, string> = { cloudflare: "Cloudflare", github: "GitHub", npm: "npm", supabase: "Supabase" };
const KIND_LIST_WORDS: Record<WatchItemKind, string> = {
  member: "members",
  outside_collaborator: "outside collaborators",
  invitation: "invitations",
  app: "installed apps",
  deploy_key: "deploy keys",
  maintainer: "package maintainers",
  account_token: "account API tokens",
  user_token: "user API tokens",
};

/** What's new in a list and what's gone, against the item ids the last good read kept. */
export function compareWatchItems<Item extends { itemId: string }>(knownItemIds: readonly string[], listedItems: readonly Item[]): { newItems: Item[]; goneItemIds: string[] } {
  const known = new Set(knownItemIds);
  const listed = new Set(listedItems.map((watchItem) => watchItem.itemId));
  return { newItems: listedItems.filter((watchItem) => !known.has(watchItem.itemId)), goneItemIds: knownItemIds.filter((itemId) => !listed.has(itemId)) };
}

export async function watchAccounts(env: Env, nowMs = Date.now()): Promise<void> {
  const listings = (await Promise.all([githubListings(env), npmListings(), supabaseListings(env), cloudflareListings(env)])).flat();
  const newItems: NewItem[] = [];
  for (const listing of listings) {
    try {
      if ("failureText" in listing) await settleFailure(env, listing.serviceName, listing.itemKind, listing.failureText, nowMs);
      else newItems.push(...(await settleListing(env, listing.serviceName, listing.itemKind, listing.items, nowMs)));
    } catch (error) {
      console.error("account watch failed", listing.serviceName, listing.itemKind, error);
    }
  }
  await tellNewItems(env, newItems);
}

/** Records a good read and answers the items to alert on. Each new row is claimed first, so two crons at once alert once. */
async function settleListing(env: Env, serviceName: WatchServiceName, itemKind: WatchItemKind, items: WatchItem[], nowMs: number): Promise<NewItem[]> {
  const firstRead = await env.DB.prepare("INSERT OR IGNORE INTO account_watch_kinds (service_name, item_kind, first_read_at_ms) VALUES (?, ?, ?)").bind(serviceName, itemKind, nowMs).run();
  const isBaseline = firstRead.meta.changes === 1;
  const known = await env.DB.prepare("SELECT item_id FROM account_watch_items WHERE service_name = ? AND item_kind = ?").bind(serviceName, itemKind).all<{ item_id: string }>();
  const { newItems, goneItemIds } = compareWatchItems(
    known.results.map((row) => row.item_id),
    items,
  );
  const statements = [
    env.DB.prepare("DELETE FROM account_watch_failures WHERE service_name = ? AND item_kind = ?").bind(serviceName, itemKind),
    ...goneItemIds.map((itemId) => env.DB.prepare("DELETE FROM account_watch_items WHERE service_name = ? AND item_kind = ? AND item_id = ?").bind(serviceName, itemKind, itemId)),
    ...newItems.map((watchItem) => env.DB.prepare("INSERT OR IGNORE INTO account_watch_items (service_name, item_kind, item_id, item_label, first_seen_at_ms) VALUES (?, ?, ?, ?, ?)").bind(serviceName, itemKind, watchItem.itemId, watchItem.itemLabel, nowMs)),
  ];
  const results = await env.DB.batch(statements);
  if (isBaseline) return [];
  const claimedResults = results.slice(1 + goneItemIds.length);
  return newItems.flatMap((watchItem, index) => (claimedResults[index]?.meta.changes ? [{ ...watchItem, serviceName }] : []));
}

/** A list that can't be read keeps its rows; Julius hears once it has failed an hour, then every 24 hours. */
async function settleFailure(env: Env, serviceName: WatchServiceName, itemKind: WatchItemKind, failureText: string, nowMs: number): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO account_watch_failures (service_name, item_kind, failing_since_ms, last_told_at_ms) VALUES (?, ?, ?, NULL)").bind(serviceName, itemKind, nowMs).run();
  const row = await env.DB.prepare("SELECT failing_since_ms, last_told_at_ms FROM account_watch_failures WHERE service_name = ? AND item_kind = ?").bind(serviceName, itemKind).first<{ failing_since_ms: number; last_told_at_ms: number | null }>();
  if (!row || nowMs - row.failing_since_ms < ACCOUNT_WATCH_LIMITS.failureWaitDurationMin * MINUTE_MS) return;
  if (row.last_told_at_ms !== null && nowMs - row.last_told_at_ms < ACCOUNT_WATCH_LIMITS.failureReminderIntervalMin * MINUTE_MS) return;
  const claimed = await env.DB.prepare("UPDATE account_watch_failures SET last_told_at_ms = ? WHERE service_name = ? AND item_kind = ? AND last_told_at_ms IS ?").bind(nowMs, serviceName, itemKind, row.last_told_at_ms).run();
  if (!claimed.meta.changes) return;
  const title = `Zaisma can't read ${SERVICE_WORDS[serviceName]}'s ${KIND_LIST_WORDS[itemKind]}`;
  const message = `${title}: ${failureText}, for ${durationText(nowMs - row.failing_since_ms)}. New ones there aren't caught until it reads again: check the watch's token.`;
  await sendPush(env, { title, message, priorityNumber: 1 });
  await sendAlert(env, title, message);
}

/** One push (not for Cloudflare: the outside checker pushes those) and one email per new watchItem, the rest in one more of each. */
async function tellNewItems(env: Env, newItems: NewItem[]): Promise<void> {
  const toldItems = newItems.slice(0, ACCOUNT_WATCH_LIMITS.maximumAlertCount);
  const restItems = newItems.slice(ACCOUNT_WATCH_LIMITS.maximumAlertCount);
  for (const watchItem of toldItems) {
    const title = `New on ${SERVICE_WORDS[watchItem.serviceName]}: ${watchItem.itemLabel}`;
    const madeText = watchItem.createdAtMs === null ? "" : `, made ${new Date(watchItem.createdAtMs).toISOString().replace("T", " ").slice(0, 16)} UTC`;
    const message = `${capitalized(watchItem.itemWords)}: ${watchItem.itemLabel}${madeText}. If this wasn't you or Gleb, remove it now: ${watchItem.listPageUrl}`;
    if (watchItem.serviceName !== "cloudflare") await sendPush(env, { title, message, priorityNumber: 2 });
    await sendAlert(env, title, message);
  }
  if (!restItems.length) return;
  const serviceNames = [...new Set(restItems.map((watchItem) => watchItem.serviceName))];
  const listPageUrls = [...new Set(restItems.map((watchItem) => watchItem.listPageUrl))];
  const title = `${restItems.length} more new keys and members`;
  const message = `${restItems.length} more new items on ${serviceNames.map((serviceName) => SERVICE_WORDS[serviceName]).join(", ")} weren't sent one by one. If they weren't you or Gleb, look now: ${listPageUrls.join(" ")}`;
  if (serviceNames.some((serviceName) => serviceName !== "cloudflare")) await sendPush(env, { title, message, priorityNumber: 2 });
  await sendAlert(env, title, message);
}

// The lists. Each kind is read on its own, so one that fails leaves the others' answers standing.

class ListingError extends Error {}

async function readKind(serviceName: WatchServiceName, itemKind: WatchItemKind, read: () => Promise<WatchItem[]>): Promise<KindListing> {
  try {
    return { serviceName, itemKind, items: await read() };
  } catch (error) {
    if (!(error instanceof ListingError)) console.error("account watch read failed", serviceName, itemKind, error);
    return { serviceName, itemKind, failureText: error instanceof ListingError ? error.message : "it didn't answer" };
  }
}

/** Answers the JSON body. Only the status goes into a failure's words, never the body. */
async function readJson(url: string, headers: Record<string, string>): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new ListingError(`it answered ${response.status}`);
  return { response, body: await response.json() };
}

type Row = Record<string, unknown>;
const rowsOf = (answerPart: unknown): Row[] => (Array.isArray(answerPart) ? answerPart.filter((row): row is Row => row !== null && typeof row === "object") : []);
const textOf = (answerPart: unknown): string => (typeof answerPart === "string" ? answerPart : typeof answerPart === "number" ? String(answerPart) : "");
const timeOf = (answerPart: unknown): number | null => {
  const timeMs = Date.parse(textOf(answerPart));
  return Number.isNaN(timeMs) ? null : timeMs;
};

async function githubListings(env: Env): Promise<KindListing[]> {
  const token = env.GITHUB_WATCH_TOKEN;
  if (!token) return [];
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "zaisma-site" };
  // GitHub pages by its Link header; installations come wrapped in { installations }.
  const readAll = async (path: string, pick: (body: unknown) => Row[] = rowsOf): Promise<Row[]> => {
    const rows: Row[] = [];
    let url: string | null = `${GITHUB_API_URL}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    for (let pageNumber = 0; url && pageNumber < ACCOUNT_WATCH_LIMITS.maximumPageCount; pageNumber++) {
      const { response, body } = await readJson(url, headers);
      rows.push(...pick(body));
      url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1] ?? null;
    }
    return rows;
  };
  const organization = GITHUB_ORGANIZATION;
  const peoplePageUrl = `https://github.com/orgs/${organization}/people`;
  return Promise.all([
    readKind("github", "member", async () =>
      (await readAll(`/orgs/${organization}/members`)).map((user) => ({ itemId: textOf(user["id"]), itemLabel: textOf(user["login"]), createdAtMs: null, itemWords: `a new member of GitHub's ${organization} organization`, listPageUrl: peoplePageUrl })),
    ),
    readKind("github", "outside_collaborator", async () =>
      (await readAll(`/orgs/${organization}/outside_collaborators`)).map((user) => ({
        itemId: textOf(user["id"]),
        itemLabel: textOf(user["login"]),
        createdAtMs: null,
        itemWords: `a new outside collaborator on GitHub's ${organization} organization`,
        listPageUrl: `https://github.com/orgs/${organization}/outside-collaborators`,
      })),
    ),
    readKind("github", "invitation", async () =>
      (await readAll(`/orgs/${organization}/invitations`)).map((invitation) => {
        const inviter = (invitation["inviter"] ?? {}) as Row;
        return {
          itemId: textOf(invitation["id"]),
          itemLabel: `${textOf(invitation["login"]) || textOf(invitation["email"])}, invited by ${textOf(inviter["login"]) || "someone"}`,
          createdAtMs: timeOf(invitation["created_at"]),
          itemWords: `a new invitation to GitHub's ${organization} organization`,
          listPageUrl: peoplePageUrl,
        };
      }),
    ),
    readKind("github", "app", async () =>
      (await readAll(`/orgs/${organization}/installations`, (body) => rowsOf((body as Row | null)?.["installations"]))).map((installation) => ({
        itemId: textOf(installation["id"]),
        itemLabel: textOf(installation["app_slug"]),
        createdAtMs: timeOf(installation["created_at"]),
        itemWords: `a new app installed on GitHub's ${organization} organization`,
        listPageUrl: `https://github.com/organizations/${organization}/settings/installations`,
      })),
    ),
    readKind("github", "deploy_key", async () => {
      const repositoryNames = (await readAll(`/orgs/${organization}/repos?type=all`)).map((repository) => textOf(repository["name"])).filter(Boolean);
      const keysPerRepository = await Promise.all(
        repositoryNames.map(async (repositoryName) =>
          (await readAll(`/repos/${organization}/${encodeURIComponent(repositoryName)}/keys`)).map((key) => ({
            itemId: `${repositoryName}/${textOf(key["id"])}`,
            itemLabel: `${textOf(key["title"])} (${key["read_only"] === false ? "can write" : "read only"})`,
            createdAtMs: timeOf(key["created_at"]),
            itemWords: `a new deploy key on ${organization}/${repositoryName}`,
            listPageUrl: `https://github.com/${organization}/${repositoryName}/settings/keys`,
          })),
        ),
      );
      return keysPerRepository.flat();
    }),
  ]);
}

/** npm answers a scope's packages and each package's maintainers with no token; its members need a login, so they aren't watched. */
async function npmListings(): Promise<KindListing[]> {
  const headers = { accept: "application/json", "user-agent": "zaisma-site" };
  return [
    await readKind("npm", "maintainer", async () => {
      const { body } = await readJson(`${NPM_REGISTRY_URL}/-/org/${NPM_ORGANIZATION}/package`, headers);
      const packageNames = Object.keys((body ?? {}) as Row);
      const maintainersPerPackage = await Promise.all(
        packageNames.map(async (packageName) => {
          const { body: packageBody } = await readJson(`${NPM_REGISTRY_URL}/${packageName.replace("/", "%2f")}`, headers);
          return rowsOf((packageBody as Row | null)?.["maintainers"]).map((maintainer) => ({
            itemId: `${packageName}/${textOf(maintainer["name"])}`,
            itemLabel: `${textOf(maintainer["name"])} on ${packageName}`,
            createdAtMs: null,
            itemWords: `a new npm maintainer of ${packageName}`,
            listPageUrl: `https://www.npmjs.com/package/${packageName}/access`,
          }));
        }),
      );
      return maintainersPerPackage.flat();
    }),
  ];
}

async function supabaseListings(env: Env): Promise<KindListing[]> {
  const token = env.SUPABASE_WATCH_TOKEN;
  const organizationSlug = env.SUPABASE_ORGANIZATION_SLUG;
  if (!token || !organizationSlug) return [];
  return [
    await readKind("supabase", "member", async () => {
      const { body } = await readJson(`${SUPABASE_API_URL}/v1/organizations/${encodeURIComponent(organizationSlug)}/members`, { authorization: `Bearer ${token}`, accept: "application/json" });
      return rowsOf(body).map((member) => ({
        itemId: textOf(member["user_id"]),
        itemLabel: `${textOf(member["user_name"]) || textOf(member["email"])} (${textOf(member["role_name"]) || "no role"})`,
        createdAtMs: null,
        itemWords: "a new member of Zaisma's Supabase organization",
        listPageUrl: `https://supabase.com/dashboard/org/${organizationSlug}/team`,
      }));
    }),
  ];
}

async function cloudflareListings(env: Env): Promise<KindListing[]> {
  const token = env.CLOUDFLARE_WATCH_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) return [];
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  // Cloudflare pages by page number, with the page count in result_info.
  const readAll = async (path: string): Promise<Row[]> => {
    const rows: Row[] = [];
    for (let pageNumber = 1; pageNumber <= ACCOUNT_WATCH_LIMITS.maximumPageCount; pageNumber++) {
      const { body } = await readJson(`${CLOUDFLARE_API_URL}${path}?per_page=50&page=${pageNumber}`, headers);
      const answer = (body ?? {}) as Row;
      if (answer["success"] === false) throw new ListingError("it answered with errors");
      rows.push(...rowsOf(answer["result"]));
      const totalPageCount = Number(((answer["result_info"] ?? {}) as Row)["total_pages"] ?? 1);
      if (!(pageNumber < totalPageCount)) break;
    }
    return rows;
  };
  return Promise.all([
    readKind("cloudflare", "member", async () =>
      (await readAll(`/accounts/${accountId}/members`)).map((member) => {
        const user = (member["user"] ?? {}) as Row;
        return { itemId: textOf(member["id"]), itemLabel: `${textOf(user["email"])} (${textOf(member["status"]) || "member"})`, createdAtMs: null, itemWords: "a new member of Zaisma's Cloudflare account", listPageUrl: `https://dash.cloudflare.com/${accountId}/members` };
      }),
    ),
    readKind("cloudflare", "account_token", async () =>
      (await readAll(`/accounts/${accountId}/tokens`)).map((apiToken) => ({
        itemId: textOf(apiToken["id"]),
        itemLabel: textOf(apiToken["name"]),
        createdAtMs: timeOf(apiToken["issued_on"]),
        itemWords: "a new API token on Zaisma's Cloudflare account",
        listPageUrl: `https://dash.cloudflare.com/${accountId}/api-tokens`,
      })),
    ),
    readKind("cloudflare", "user_token", async () =>
      (await readAll("/user/tokens")).map((apiToken) => ({
        itemId: textOf(apiToken["id"]),
        itemLabel: textOf(apiToken["name"]),
        createdAtMs: timeOf(apiToken["issued_on"]),
        itemWords: "a new API token on Julius's Cloudflare profile",
        listPageUrl: "https://dash.cloudflare.com/profile/api-tokens",
      })),
    ),
  ]);
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function durationText(durationMs: number): string {
  const durationMin = Math.max(1, Math.round(durationMs / MINUTE_MS));
  return durationMin < 120 ? `${durationMin} min` : `${Math.round(durationMin / 60)} hours`;
}
