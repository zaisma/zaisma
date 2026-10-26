import { ApiError, CREDIT_LIMITS, PRO_PRICE_CENTS_PER_MONTH, accountById, gameBySlug, hostingUseThisMonth, gameHostingMonth, apiKeysFor, createApiKey, checkKeyScope, revokeApiKey, passkeysFor, liveApiKeyCount, MAXIMUM_API_KEY_COUNT, ACCESS_AREAS, ACCESS_LEVELS, AREA_ACCESS_CHOICES, WEBHOOK_EVENT_KINDS, type Account, type ApiKey, type Game } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import { AREA_LABELS, CHOICE_LABELS, LEVEL_LABELS, keyMakingState, keyScopeFromForm, keyScopeText, keyStandingText, passkeyTapFromForm } from "./account.ts";
import { apiCall, callerFor, hostingUseJson, type Caller } from "./developer.ts";
import { withSpendingConfirmation } from "./credit-api.ts";
import type { Env } from "./env.ts";
import { esc, html, layout, openingScriptTags, raw, scriptTags, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { PASSKEY_SCRIPT, checkPasskeyTap, keyRefusal, usedChallengeCookie } from "./passkeys.ts";
import { logAccountChange, seedKeyPlace } from "./security-log.ts";
import { recordProof } from "./session-proofs.ts";
import { answerSpendingRequest, spendingRequestAnswer } from "./spending-requests.ts";
import { stripeAccountRow, stripeAccountWithBalance } from "./stripe-account-api.ts";
import { waitEndsText } from "./email-codes.ts";
import { cutButton, deleteButton, runButton, textButton, textLink } from "./components/actions.ts";
import { glassPane, icon, tag } from "./components/foundations.ts";
import { row, stack, type LayoutItem } from "./components/layout.ts";
import { sidePlaces } from "./components/navigation.ts";
import { banner, confirmSheet, notice, sheet } from "./components/panes.ts";
import { checkField, choiceCards, codeField, cutField, longField, selectField, toggle } from "./components/inputs.ts";
import { emptyState, listRows, numbers, problemState, table, usageMeter, type ListRow } from "./components/data.ts";
import { facts, foldedPart } from "./components/reading.ts";

/**
 * Developer settings, /dashboard/settings (docs/DECISIONS.md, "The dashboard is three kinds of page"): what applies across a developer's
 * games, on one scroll of glass panes with jump tabs: Hosting, Pro, Payments, Webhooks, Sign-in apps and Keys. Every read and every change
 * goes through the developer API as the signed-in developer (apiCall), so the page has no logic of its own and an AI sees all it shows;
 * only making a key is the page's own (a key is made only on a page, with a passkey tap).
 */

const PAGE = "/dashboard/settings";
const TAB_PANES = [
  { id: "hosting", label: "Hosting", icon: "gauge" },
  { id: "pro", label: "Pro", icon: "plus" },
  { id: "payments", label: "Payments", icon: "card" },
  { id: "webhooks", label: "Webhooks", icon: "bell" },
  { id: "sign-in-apps", label: "Sign-in apps", icon: "person" },
  { id: "keys", label: "Keys", icon: "key" },
] as const;

/** What the page tells the developer after a change, by the key its redirect carries. */
const DONE_WORDS: Record<string, string> = {
  budget: "Budget saved.",
  "budget-cleared": "Paid hosting is off for that game.",
  automatic: "Automatic top-up saved.",
  refunded: "Refunded to its card.",
  approved: "Approved. The change is made.",
  declined: "Declined. Nothing changed.",
  cancelled: "Zaisma Pro will end at the end of the paid month.",
  resumed: "Zaisma Pro will renew as before.",
  tax: "Stripe Tax saved.",
  disconnected: "Stripe is disconnected. Players can't buy until you connect again.",
  webhook: "Webhook saved.",
  "webhook-deleted": "Webhook deleted.",
  tested: "Test event sent.",
  app: "Sign-in app saved.",
  "app-deleted": "Sign-in app deleted.",
  "key-removed": "Key removed.",
  connected: "Stripe is connected.",
};

const EVENT_WORDS: Record<(typeof WEBHOOK_EVENT_KINDS)[number], string> = {
  bug_reported: "A bug is reported",
  player_reported: "A player is reported",
  scan_status_changed: "A version's check finishes",
  live_version_changed: "The live version changes",
  review_status_changed: "A review decides",
  country_blocks_changed: "Country blocks change",
  game_server_error_found: "The game server errors",
  alert_raised: "An alert is raised",
  account_deleted: "A player deletes their account",
  security_alert: "A security alert",
  purchase_completed: "A purchase completes",
  purchase_refunded: "A purchase is refunded",
};

type SignedIn = NonNullable<Awaited<ReturnType<typeof currentSession>>>;

const redirect = (to: string, cookies: string[] = []): Response => {
  const response = new Response(null, { status: 303, headers: { Location: to } });
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
};

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const money = (minorUnits: number, currencyCode: string | null) => {
  try {
    return (minorUnits / 100).toLocaleString("en-US", { style: "currency", currency: (currencyCode ?? "usd").toUpperCase() });
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${(currencyCode ?? "").toUpperCase()}`;
  }
};
const shownDate = (isoText: string | null) => (isoText ? new Date(isoText).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Dollars typed in a field as cents: "40" and "$40.50" work; anything else is NaN, which the API refuses with its own words. */
const centsOf = (typed: string): number => (typed.trim() === "" ? NaN : Math.round(Number(typed.replace(/[$,\s]/g, "")) * 100));

/** Secrets, tokens and other things shown once, after the call that made them. */
interface ShownOnce {
  title: string;
  lines: { label: string; code: string }[];
  text: string;
}

interface PageState {
  done?: string;
  problem?: string;
  shownOnce?: ShownOnce;
  /** A spending request to answer, opened over the Hosting pane. */
  spendingRequestId?: string;
  /** A webhook whose deliveries are open, and where its next page starts. */
  deliveriesOf?: { webhookId: string; cursor: string | null };
}

interface CreditJson {
  balance_cents: number;
  automatic_top_up: { is_enabled: boolean; top_up_below_cents: number | null; top_up_amount_cents: number | null; monthly_top_up_limit_cents: number | null; topped_up_this_month_cents: number };
  top_ups: { id: string; amount_cents: number; refundable_cents: number; refund_ends_at: string | null; created_at: string }[];
  games: { slug: string; last_month_beyond_free_cents: number }[];
  entries: { id: string; entry_kind: string; amount_cents: number; game_slug: string | null; created_at: string }[];
}

interface WebhookJson {
  id: string;
  destination_kind: "endpoint_url" | "game_server";
  endpoint_url: string | null;
  event_kinds: string[];
  game_slugs: string[] | null;
  pending_delivery_count: number;
  failed_delivery_count: number;
}

interface DeliveryJson {
  webhook_event: { kind?: string };
  delivery_status: string;
  attempt_count: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  failure_message: string | null;
  created_at: string;
}

interface SignInAppJson {
  id: string;
  name: string;
  kind: "confidential" | "public";
  redirect_urls: string[];
  issuer_url: string;
}

interface ProJson {
  plan: "free" | "pro";
  pro_ends_at: string | null;
  is_pro_cancelled: boolean;
  limits: Record<"free" | "pro", Record<string, number>>;
  used_today: Record<string, number>;
}

interface GameHosting {
  game: Game;
  hosting: ReturnType<typeof hostingUseJson>;
  lastMonthBeyondFreeCents: number;
}

/** Everything the page shows, read through the same API calls an AI makes (the games' meters through the code that answers get_game's). */
async function readSettings(env: Env, caller: Caller) {
  const read = <Answer>(path: string) => apiCall(env, caller, "GET", path) as Promise<Answer>;
  const [{ credit }, { pro }, stripeRow, { webhooks }, { sign_in_apps: signInApps }, games] = await Promise.all([
    read<{ credit: CreditJson }>("/credit"),
    read<{ pro: ProJson }>("/pro"),
    stripeAccountRow(env, caller.ownerId),
    read<{ webhooks: WebhookJson[] }>("/webhooks"),
    read<{ sign_in_apps: SignInAppJson[] }>("/sign-in-apps"),
    env.DB.prepare("SELECT * FROM games WHERE owner_id = ? ORDER BY title").bind(caller.ownerId).all<Game>(),
  ]);
  const lastMonth = new Map(credit.games.map((game) => [game.slug, game.last_month_beyond_free_cents]));
  const gameHostings: GameHosting[] = await Promise.all(
    games.results.map(async (game) => {
      const [use, month] = await Promise.all([hostingUseThisMonth(env.DB, game.id), gameHostingMonth(env.DB, game.id)]);
      return { game, hosting: hostingUseJson(game, use, month), lastMonthBeyondFreeCents: lastMonth.get(game.slug) ?? 0 };
    }),
  );
  return { credit, pro, stripe: await stripeAccountWithBalance(env, stripeRow), webhooks, signInApps, gameHostings, games: games.results };
}

type Settings = Awaited<ReturnType<typeof readSettings>>;

/** One form, posting to a page route; a form that raises spending taps the passkey first (SETTINGS_SCRIPT). */
const form = (action: string, items: LayoutItem[], attributes: { tap?: "confirm" | "key"; tapOver?: Record<string, number> } = {}): Raw =>
  html`<form method="post" action="${action}"${attributes.tap ? html` data-tap="${attributes.tap}"` : ""}${attributes.tapOver ? html` data-tap-over="${JSON.stringify(attributes.tapOver)}"` : ""}>${stack({ items })}${attributes.tap ? raw('<p class="field-error" data-tap-error hidden role="alert"></p>') : ""}</form>`;

const words = (markup: Raw | string): LayoutItem => ({ kind: "words", markup: typeof markup === "string" ? html`<p>${markup}</p>` : markup });
const block = (markup: Raw): LayoutItem => ({ kind: "block", markup });
const control = (markup: ReturnType<typeof runButton>): LayoutItem => ({ kind: "control", markup });

/** A pane: its heading and what's in it, one scroll of them. */
const settingsPane = (id: string, heading: string, items: LayoutItem[]): LayoutItem =>
  block(html`<section id="${id}" data-settings-pane>${glassPane({ paneWidth: "full", label: heading, body: stack({ items: [{ kind: "words", markup: html`<h2>${heading}</h2>` }, ...items] }) })}</section>${id === "payments" ? openingScriptTags(AMOUNTS_SCRIPT) : ""}`);

/** A button that opens a sheet which posts (a confirm, with its sentence). */
const askSheet = (id: string, title: string, text: string, action: string, confirmLabel: string) => confirmSheet({ id, title, text, action, confirmLabel });

/* ---- Hosting ---- */

function hostingPane(settings: Settings): LayoutItem {
  const { credit, gameHostings } = settings;
  const automatic = credit.automatic_top_up;
  const items: LayoutItem[] = [];

  // The balance and Add credit.
  items.push(
    block(numbers({ items: [{ label: "Hosting credit", figure: dollars(credit.balance_cents) }] })),
    words(credit.balance_cents === 0 ? "Hosting is free up to each game's monthly allowance. Credit pays for what goes past it, only in games you give a budget." : "Credit pays for hosting past each game's free allowance, only in games you give a budget."),
    control(cutButton("Add credit", { type: "button", icon: "plus", controls: "add-credit" })),
    block(
      sheet({
        id: "add-credit",
        title: "Add credit",
        closeLabel: "Close",
        action: `${PAGE}/credit/top-up`,
        body: stack({
          items: [
            { kind: "block", markup: choiceCards({ id: "top-up-amount", name: "amount_cents", label: "How much", choices: [1000, 2500, 5000, 10000].map((cents) => ({ label: dollars(cents), choiceValue: String(cents) })).concat([{ label: "Other", choiceValue: "other" }]) }) },
            { kind: "control", markup: cutField({ id: "top-up-other", name: "other_dollars", label: "If other, in dollars", type: "text", icon: "card", inputMode: "numeric", hint: `${dollars(CREDIT_LIMITS.minimumTopUpCents)} to ${dollars(CREDIT_LIMITS.maximumTopUpCents)}. You pay on Stripe's page.` }) },
          ],
        }),
        buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Pay on Stripe", { type: "submit" })],
      }),
    ),
  );

  // Automatic top-up.
  const automaticWords = automatic.is_enabled
    ? `Automatic top-up is on: when credit drops below ${dollars(automatic.top_up_below_cents ?? 0)}, add ${dollars(automatic.top_up_amount_cents ?? 0)}, at most ${dollars(automatic.monthly_top_up_limit_cents ?? 0)} a month (${dollars(automatic.topped_up_this_month_cents)} so far this month).`
    : "Automatic top-up is off. It adds credit by itself when it runs low, to the card of your last top-up.";
  const automaticFields = (belowCents: number, amountCents: number, limitCents: number | null): LayoutItem[] => [
    { kind: "control", markup: cutField({ id: "automatic-below", name: "below_dollars", label: "When credit drops below ($)", type: "text", icon: "card", inputMode: "numeric", text: String(belowCents / 100), isRequired: true }) },
    { kind: "control", markup: cutField({ id: "automatic-amount", name: "amount_dollars", label: "Add ($)", type: "text", icon: "card", inputMode: "numeric", text: String(amountCents / 100), isRequired: true }) },
    { kind: "control", markup: cutField({ id: "automatic-limit", name: "limit_dollars", label: "Most to add in a month ($)", type: "text", icon: "card", inputMode: "numeric", text: limitCents === null ? "" : String(limitCents / 100), isRequired: true, hint: "Type the most you're willing to spend on top-ups in a month." }) },
  ];
  items.push(
    words(automaticWords),
    control(cutButton(automatic.is_enabled ? "Change automatic top-up" : "Turn on automatic top-up", { type: "button", controls: "automatic-top-up" })),
    block(
      sheet({
        id: "automatic-top-up",
        title: "Automatic top-up",
        closeLabel: "Close",
        action: `${PAGE}/credit/automatic`,
        body: html`<div data-tap="confirm" data-tap-over='${JSON.stringify({ below_dollars: automatic.is_enabled ? automatic.top_up_below_cents ?? 0 : 0, amount_dollars: automatic.is_enabled ? automatic.top_up_amount_cents ?? 0 : 0, limit_dollars: automatic.is_enabled ? automatic.monthly_top_up_limit_cents ?? 0 : 0 })}' data-tap-always="${automatic.is_enabled ? "" : "yes"}">${stack({ items: [...automaticFields(automatic.top_up_below_cents ?? 500, automatic.top_up_amount_cents ?? 2000, automatic.monthly_top_up_limit_cents), { kind: "words", markup: html`<p class="field-error" data-tap-error hidden role="alert"></p>` }] })}</div>`,
        buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Save", { type: "submit", name: "is_enabled", buttonValue: "on" })],
      }),
    ),
  );
  if (automatic.is_enabled) {
    items.push(control(cutButton("Turn off automatic top-up", { type: "button", controls: "automatic-off" })), block(askSheet("automatic-off", "Turn off automatic top-up?", "Credit won't be added by itself any more. Your balance stays.", `${PAGE}/credit/automatic-off`, "Turn off")));
  }

  // Games.
  const hostingGames = gameHostings.filter((game) => game.game.multiplayer_mode !== "none" || game.hosting.free_used_pct > 0 || game.hosting.monthly_budget_cents !== null || game.hosting.is_paused || game.lastMonthBeyondFreeCents > 0);
  if (hostingGames.length) {
    items.push({ kind: "words", markup: html`<h3>Your games this month</h3>` });
    // Only games with something to say: they play online, used some of their free hosting, have a budget, or are paused.
    for (const each of hostingGames) items.push(block(gameHosting(each)));
  }

  // Top-ups.
  const topUps = credit.top_ups.filter((topUp) => topUp.refundable_cents > 0);
  if (topUps.length) {
    items.push(
      { kind: "words", markup: html`<h3>Top-ups you can still refund</h3>` },
      block(
        listRows({
          label: "Top-ups",
          rows: topUps.map((topUp): ListRow => ({
            title: `${dollars(topUp.amount_cents)} added ${shownDate(topUp.created_at)}`,
            detail: `${dollars(topUp.refundable_cents)} refundable until ${shownDate(topUp.refund_ends_at)}`,
            action: cutButton("Refund", { type: "button", isSmall: true, controls: `refund-${topUp.id}` }),
          })),
        }),
      ),
      ...topUps.map((topUp) => block(askSheet(`refund-${topUp.id}`, `Refund ${dollars(topUp.refundable_cents)}?`, "It goes back to the card it came from, and that credit is gone.", `${PAGE}/credit/refund/${topUp.id}`, "Refund"))),
    );
  }

  // The last 90 days.
  if (credit.entries.length) {
    items.push(
      block(
        foldedPart({
          title: "The last 90 days",
          entryCount: credit.entries.length,
          body: table({
            caption: "Credit entries",
            isCompact: true,
            shownRowCount: 8,
            columns: [{ label: "Day" }, { label: "What" }, { label: "Game" }, { label: "Amount", isNumeric: true }],
            rows: credit.entries.map((entry) => [day(Date.parse(entry.created_at)), ENTRY_WORDS[entry.entry_kind] ?? entry.entry_kind, entry.game_slug ?? "", `${entry.amount_cents < 0 ? "−" : "+"}${dollars(Math.abs(entry.amount_cents))}`]),
          }),
        }),
      ),
    );
  }
  return settingsPane("hosting", "Hosting", items);
}

const ENTRY_WORDS: Record<string, string> = { top_up: "Credit added", hosting_charge: "Hosting", refund: "Refunded", written_off: "Written off by Zaisma" };

/** One game: its free meter (and budget on the same track), its budget and last month. */
function gameHosting(each: GameHosting): Raw {
  const { game, hosting } = each;
  const budgetCents = hosting.monthly_budget_cents;
  const freePct = hosting.free_used_pct;
  const meter =
    budgetCents === null
      ? usageMeter({ label: game.title, usedNumber: freePct, limitNumber: 100, unit: "%", resetDate: hosting.resets_on_date, shownWords: `${freePct}% of this month's free hosting` })
      : (() => {
          const budgetPct = Math.min(100, Math.round((hosting.spent_from_credit_cents / Math.max(budgetCents, 1)) * 100));
          return usageMeter({
            label: game.title,
            usedNumber: Math.min(100, freePct) + budgetPct * 2,
            limitNumber: 300,
            warnFromNumber: 260,
            unit: "",
            resetDate: hosting.resets_on_date,
            isFullFine: budgetPct < 100,
            shownWords: freePct >= 100 ? `Free part used. ${dollars(hosting.spent_from_credit_cents)} of ${dollars(budgetCents)} budget` : `${freePct}% of the free part, then a ${dollars(budgetCents)} budget`,
          });
        })();
  const pausedWords =
    hosting.paused_reason === "budget_used" ? "This month's budget is used. Raise it to start again." : hosting.paused_reason === "credit_used" ? "Your credit ran out. Add credit to start again." : `This month's free hosting is used. It's back on ${shownDate(hosting.resets_on_date)}, or sooner with credit and a budget.`;
  const idBase = `budget-${game.slug}`;
  const noBudgetWords = each.lastMonthBeyondFreeCents > 0 ? `Last month's use past the free allowance would have cost ${dollars(each.lastMonthBeyondFreeCents)} at today's prices.` : "No budget: it stops at its free allowance.";
  return html`${stack({
    items: [
      block(meter),
      ...(hosting.is_paused ? [block(banner({ text: `Hosting is paused. ${pausedWords}`, icon: "pause", tone: "warning" }))] : []),
      words(budgetCents === null ? noBudgetWords : `Monthly budget ${dollars(budgetCents)}; ${dollars(hosting.spent_from_credit_cents)} spent from credit this month.`),
      ...(hosting.shares.length ? [block(foldedPart({ title: "What used it", body: html`<p>${hosting.shares.map((share) => `${SHARE_WORDS[share.kind]} ${share.share_pct}%`).join(", ")}</p>` }))] : []),
      control(cutButton(budgetCents === null ? "Give it a budget" : "Change budget", { type: "button", controls: idBase })),
      ...(budgetCents === null ? [] : [control(cutButton("Turn off paid hosting", { type: "button", controls: `${idBase}-off` })), block(askSheet(`${idBase}-off`, `Turn off paid hosting for ${game.title}?`, "It stops at its free allowance each month. Nothing is charged past it.", `${PAGE}/games/${game.slug}/budget-off`, "Turn off"))]),
      block(
        sheet({
          id: idBase,
          title: `${game.title}'s monthly budget`,
          closeLabel: "Close",
          action: `${PAGE}/games/${game.slug}/budget`,
          body: html`<div data-tap="confirm" data-tap-over='${JSON.stringify({ monthly_budget_dollars: budgetCents ?? 0 })}'>${stack({
            items: [
              { kind: "words", markup: html`<p>The most credit this game may use each month, past its free hosting. At least $1.</p>` },
              { kind: "control", markup: cutField({ id: `${idBase}-field`, name: "monthly_budget_dollars", label: "Monthly budget ($)", type: "text", icon: "card", inputMode: "numeric", text: budgetCents === null ? "" : String(budgetCents / 100), isRequired: true, hint: budgetCents === null && each.lastMonthBeyondFreeCents > 0 ? `Last month's use past free: ${dollars(each.lastMonthBeyondFreeCents)}.` : undefined }) },
              { kind: "words", markup: html`<p class="field-error" data-tap-error hidden role="alert"></p>` },
            ],
          })}</div>`,
          buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Save budget", { type: "submit" })],
        }),
      ),
    ],
  })}`;
}

const SHARE_WORDS: Record<string, string> = { room_play: "Rooms", game_server_cpu: "Game server CPU", relayed_data: "Relay", database: "Database", requests: "Requests" };

/* ---- Pro ---- */

function proPane(settings: Settings): LayoutItem {
  const { pro } = settings;
  const isPro = pro.plan === "pro";
  const limitRow = (label: string, key: string, usedKey: string | null): string[] => [label, String(pro.limits.free[key]), String(pro.limits.pro[key]), usedKey ? String(pro.used_today[usedKey]) : ""];
  const items: LayoutItem[] = [
    words(isPro ? (pro.is_pro_cancelled ? `You have Zaisma Pro until ${shownDate(pro.pro_ends_at)}. It won't renew.` : `You have Zaisma Pro. It renews ${shownDate(pro.pro_ends_at)}.`) : `Zaisma Pro raises your daily limits for ${dollars(PRO_PRICE_CENTS_PER_MONTH)} a month on your card. It's separate from hosting credit.`),
    block(
      table({
        caption: "Daily limits",
        isCompact: true,
        columns: [{ label: "Limit" }, { label: "Free", isNumeric: true }, { label: "Pro", isNumeric: true }, { label: "Used today", isNumeric: true }],
        rows: [limitRow("Large reviews", "maximum_large_review_count", "large_review_count"), limitRow("Small reviews", "maximum_small_review_count", "small_review_count"), limitRow("Performance checks", "maximum_performance_check_count", "performance_check_count"), limitRow("Versions a game a day", "maximum_version_count", null)],
      }),
    ),
  ];
  if (!isPro) items.push(control(cutButton("Get Zaisma Pro", { type: "button", controls: "pro-start" })), block(askSheet("pro-start", "Get Zaisma Pro?", `${dollars(PRO_PRICE_CENTS_PER_MONTH)} a month. You pay on Stripe's page.`, `${PAGE}/pro/checkout`, "Continue to Stripe")));
  else if (pro.is_pro_cancelled) items.push(control(cutButton("Keep Zaisma Pro", { type: "button", controls: "pro-resume" })), block(askSheet("pro-resume", "Keep Zaisma Pro?", "It renews as before.", `${PAGE}/pro/resume`, "Keep it")));
  else items.push(control(cutButton("Cancel Zaisma Pro", { type: "button", controls: "pro-cancel" })), block(askSheet("pro-cancel", "Cancel Zaisma Pro?", `You keep it until ${shownDate(pro.pro_ends_at)}, then the free limits apply.`, `${PAGE}/pro/cancel`, "Cancel Pro")));
  return settingsPane("pro", "Zaisma Pro", items);
}

/* ---- Payments ---- */

type StripeJson = Settings["stripe"];

/** An amount of Payments: the figure the eye toggle can hide. */
const shownAmount = (shown: string): Raw => html`<span data-amount="${shown}">${shown}</span>`;

function paymentsPane(settings: Settings): LayoutItem {
  const stripe: StripeJson = settings.stripe;
  if (!stripe.is_connected) {
    return settingsPane("payments", "Payments", [
      words("Players buy in your games and the money goes straight to your own Stripe account. Zaisma takes no cut."),
      block(form(`${PAGE}/payments/connect`, [control(runButton("Connect Stripe", { type: "submit" }))], { tap: "confirm" })),
    ]);
  }
  const balance = stripe.balance;
  const items: LayoutItem[] = [];
  if (balance) {
    const code = balance.currency_code;
    items.push(
      block(numbers({ items: [{ label: "In your Stripe account", figure: money(balance.available_minor_units + balance.pending_minor_units, code) }] })),
      ...(balance.next_payout ? [words(html`<p>${shownAmount(money(balance.next_payout.amount_minor_units, balance.next_payout.currency_code))} on its way · next payout ${shownDate(balance.next_payout.arrives_at)}</p>`)] : []),
      ...(balance.other_currency_balances.length ? [words(html`<p>Also: ${balance.other_currency_balances.map((other, index) => html`${index ? ", " : ""}${shownAmount(money(other.available_minor_units + other.pending_minor_units, other.currency_code))}`)}</p>`)] : []),
      control(cutButton("Hide amounts", { type: "button", icon: "eye", isPressed: false, dataAttributes: { "amounts-toggle": "" } })),
    );
  }
  if (!stripe.can_take_payments) {
    items.push(block(banner({ text: "Stripe isn't ready to take payments yet. Finish setting up your account on Stripe.", icon: "warning", tone: "warning" })), block(form(`${PAGE}/payments/connect`, [control(cutButton("Finish on Stripe", { type: "submit" }))], { tap: "confirm" })));
  }
  items.push(
    words(
      facts({
        arrangement: "down",
        facts: [
          { label: "Seller name", text: stripe.business_name ?? "Not set" },
          { label: "Support email", text: stripe.support_email ?? "Not set" },
          { label: "Country", text: stripe.country_code ?? "" },
          { label: "Currency", text: (stripe.default_currency_code ?? "").toUpperCase() },
        ],
      }),
    ),
    control(cutButton("Change on Stripe", { href: "https://dashboard.stripe.com/settings/account", icon: "out-of-page" })),
    block(form(`${PAGE}/payments/tax`, [{ kind: "block", markup: toggle({ id: "stripe-tax", name: "is_stripe_tax_used", label: "Stripe Tax", isOn: stripe.is_stripe_tax_used, hint: "Stripe calculates and records the tax inside each price. Prices never change." }) }, control(cutButton("Save", { type: "submit" }))])),
    control(cutButton("Open Stripe", { href: "https://dashboard.stripe.com", icon: "out-of-page" })),
    control(textButton("Disconnect Stripe", { type: "button" })),
  );
  // The quiet button above opens its confirm.
  items.splice(items.length - 1, 1, control(cutButton("Disconnect Stripe", { type: "button", controls: "payments-disconnect" })), block(askSheet("payments-disconnect", "Disconnect Stripe?", "Players can't buy in any of your games until you connect again. Past sales stay.", `${PAGE}/payments/disconnect`, "Disconnect")));
  return settingsPane("payments", "Payments", items);
}

/* ---- Webhooks ---- */

function webhooksPane(settings: Settings, state: PageState, deliveries: DeliveryJson[] | null, nextCursor: string | null): LayoutItem {
  const { webhooks, games } = settings;
  const items: LayoutItem[] = [];
  const eventFields = (idBase: string, picked: string[]): LayoutItem[] => [
    { kind: "words", markup: html`<p>Send me</p>` },
    ...WEBHOOK_EVENT_KINDS.map((kind): LayoutItem => ({ kind: "block", markup: checkField({ id: `${idBase}-${kind}`, name: "event_kinds", checkValue: kind, label: EVENT_WORDS[kind], isChecked: picked.includes(kind) }) })),
  ];
  const gameFields = (idBase: string, picked: string[] | null): LayoutItem[] =>
    games.length
      ? [{ kind: "words", markup: html`<p>Only these games (none ticked: all of them)</p>` }, ...games.map((game): LayoutItem => ({ kind: "block", markup: checkField({ id: `${idBase}-game-${game.slug}`, name: "game_slugs", checkValue: game.slug, label: game.title, isChecked: picked?.includes(game.slug) }) }))]
      : [];

  if (!webhooks.length) items.push(block(emptyState({ title: "No webhooks yet", text: "A webhook sends your server a signed event when something happens in your games." })));
  for (const webhook of webhooks) {
    const where = webhook.destination_kind === "game_server" ? `${webhook.game_slugs?.map((slug) => games.find((game) => game.slug === slug)?.title ?? slug).join(", ") ?? ""}'s game server` : webhook.endpoint_url ?? "";
    const trouble = webhook.failed_delivery_count > 0 || webhook.pending_delivery_count > 0;
    const idBase = `webhook-${webhook.id}`;
    const isOpen = state.deliveriesOf?.webhookId === webhook.id;
    items.push(
      block(
        html`${stack({
          items: [
            { kind: "words", markup: html`<h3>${where}</h3>` },
            words(`${webhook.event_kinds.map((kind) => EVENT_WORDS[kind as keyof typeof EVENT_WORDS] ?? kind).join(", ")}${webhook.destination_kind === "endpoint_url" && webhook.game_slugs ? ` · ${webhook.game_slugs.join(", ")}` : ""}`),
            ...(trouble ? [block(banner({ text: `${webhook.failed_delivery_count ? `${webhook.failed_delivery_count} failed` : ""}${webhook.failed_delivery_count && webhook.pending_delivery_count ? ", " : ""}${webhook.pending_delivery_count ? `${webhook.pending_delivery_count} waiting to retry` : ""}.`, icon: "warning", tone: "warning" }))] : []),
            block(
              row({
                widths: "equal",
                items: [
                  { kind: "control", markup: cutButton("Change", { type: "button", controls: `${idBase}-edit` }) },
                  { kind: "control", markup: cutButton("Send a test", { type: "button", controls: `${idBase}-test` }) },
                  { kind: "control", markup: cutButton("New secret", { type: "button", controls: `${idBase}-secret` }) },
                  { kind: "control", markup: deleteButton("Delete", { action: `${PAGE}/webhooks/${webhook.id}/delete`, confirmLabel: "Delete webhook", confirmText: "It stops receiving events, and what was on its way to it is dropped.", id: `${idBase}-delete` }) },
                ],
              }),
            ),
            block(
              foldedPart({
                id: `${idBase}-deliveries`,
                title: "Deliveries",
                isOpen,
                body: isOpen && deliveries ? deliveriesTable(webhook.id, deliveries, nextCursor) : html`<p>${textLink("Show the last 30 days", `${PAGE}?deliveries=${webhook.id}#${idBase}-deliveries`)}</p>`,
              }),
            ),
          ],
        })}${sheet({
          id: `${idBase}-edit`,
          title: "Change this webhook",
          closeLabel: "Close",
          action: `${PAGE}/webhooks/${webhook.id}`,
          body: stack({ items: [...(webhook.destination_kind === "endpoint_url" ? [{ kind: "control" as const, markup: cutField({ id: `${idBase}-url`, name: "endpoint_url", label: "Address", type: "text", icon: "link", text: webhook.endpoint_url ?? "", isRequired: true }) }] : []), ...eventFields(idBase, webhook.event_kinds), ...gameFields(idBase, webhook.game_slugs)] }),
          buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Save", { type: "submit" })],
        })}${askSheet(`${idBase}-test`, "Send a test event?", `Zaisma sends a test event to ${where} now and tells you how it went.`, `${PAGE}/webhooks/${webhook.id}/test`, "Send test")}${askSheet(`${idBase}-secret`, "Replace the signing secret?", "The old secret stops working at once. You'll see the new one once.", `${PAGE}/webhooks/${webhook.id}/secret`, "Replace it")}`,
      ),
    );
  }
  items.push(
    control(cutButton("Add a webhook", { type: "button", controls: "webhook-add" })),
    block(
      sheet({
        id: "webhook-add",
        title: "Add a webhook",
        closeLabel: "Close",
        action: `${PAGE}/webhooks`,
        body: stack({ items: [{ kind: "control", markup: cutField({ id: "webhook-add-url", name: "endpoint_url", label: "Address (https)", type: "text", icon: "link", placeholder: "https://example.com/zaisma", isRequired: true }) }, ...eventFields("webhook-add", ["bug_reported"]), ...gameFields("webhook-add", null)] }),
        buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Add webhook", { type: "submit" })],
      }),
    ),
  );
  if (games.length) {
    items.push(
      control(cutButton("Send to a game server", { type: "button", controls: "webhook-server-add" })),
      block(
        sheet({
          id: "webhook-server-add",
          title: "Send events to a game server",
          closeLabel: "Close",
          action: `${PAGE}/webhooks`,
          body: stack({
            items: [
              { kind: "words", markup: html`<p>A game on Zaisma with its own game server gets these in its onWebhook.</p>` },
              { kind: "control", markup: selectField({ id: "webhook-server-game", name: "game_server_slug", label: "Game", choices: games.map((game) => ({ label: game.title, choiceValue: game.slug })) }) },
              { kind: "block", markup: html`<input type="hidden" name="destination_kind" value="game_server">` },
              ...eventFields("webhook-server-add", ["bug_reported"]),
            ],
          }),
          buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Add webhook", { type: "submit" })],
        }),
      ),
    );
  }
  return settingsPane("webhooks", "Webhooks", items);
}

function deliveriesTable(webhookId: string, deliveries: DeliveryJson[], nextCursor: string | null): Raw {
  return html`${table({
    caption: "Deliveries",
    isCompact: true,
    shownRowCount: 8,
    columns: [{ label: "When" }, { label: "Event" }, { label: "Result" }, { label: "Tries", isNumeric: true }],
    rows: deliveries.map((delivery) => [shownDate(delivery.created_at), String(delivery.webhook_event.kind ?? ""), delivery.delivery_status === "delivered" ? "Delivered" : delivery.delivery_status === "pending" ? `Retrying${delivery.failure_message ? `: ${delivery.failure_message}` : ""}` : `Failed${delivery.failure_message ? `: ${delivery.failure_message}` : ""}`, String(delivery.attempt_count)]),
    rowsPlaceholder: deliveries.length ? undefined : emptyState({ title: "Nothing sent yet", text: "Events appear here as they're sent." }),
  })}${nextCursor ? html`<p>${textLink("Older deliveries", `${PAGE}?deliveries=${webhookId}&cursor=${encodeURIComponent(nextCursor)}#webhook-${webhookId}-deliveries`)}</p>` : ""}`;
}

/* ---- Sign-in apps ---- */

function signInAppsPane(settings: Settings): LayoutItem {
  const { signInApps } = settings;
  const items: LayoutItem[] = [];
  const fields = (idBase: string, given?: SignInAppJson): LayoutItem[] => [
    { kind: "control", markup: cutField({ id: `${idBase}-name`, name: "name", label: "Name", type: "text", icon: "pencil", text: given?.name ?? "", isRequired: true, hint: "Players see it when they're asked to sign in." }) },
    { kind: "block", markup: longField({ id: `${idBase}-urls`, name: "redirect_urls", label: "Redirect addresses, one a line", rowCount: 3, text: (given?.redirect_urls ?? []).join("\n"), isRequired: true }) },
  ];
  if (!signInApps.length) items.push(block(emptyState({ title: "No sign-in apps yet", text: "Sign in with Zaisma lets players use their Zaisma account on your own site." })));
  for (const app of signInApps) {
    const idBase = `app-${app.id}`;
    items.push(
      block(
        html`${stack({
          items: [
            { kind: "words", markup: html`<h3>${app.name}</h3>` },
            words(facts({ arrangement: "down", facts: [{ label: "Kind", text: app.kind === "confidential" ? "Confidential (has a secret)" : "Public (no secret)" }, { label: "Client ID", text: app.id }, { label: "Issuer", text: app.issuer_url }, { label: "Redirects", text: app.redirect_urls.join(", ") }] })),
            block(
              row({
                widths: "equal",
                items: [
                  { kind: "control", markup: cutButton("Change", { type: "button", controls: `${idBase}-edit` }) },
                  ...(app.kind === "confidential" ? [{ kind: "control" as const, markup: cutButton("New secret", { type: "button", controls: `${idBase}-secret` }) }] : []),
                  { kind: "control", markup: deleteButton("Delete", { action: `${PAGE}/sign-in-apps/${app.id}/delete`, confirmLabel: "Delete sign-in app", confirmText: "Players' yes to it is deleted with it. Sites that use it stop working.", id: `${idBase}-delete` }) },
                ],
              }),
            ),
          ],
        })}${sheet({ id: `${idBase}-edit`, title: "Change this app", closeLabel: "Close", action: `${PAGE}/sign-in-apps/${app.id}`, body: stack({ items: fields(idBase, app) }), buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Save", { type: "submit" })] })}${app.kind === "confidential" ? askSheet(`${idBase}-secret`, "Replace the client secret?", "The old secret stops working at once. You'll see the new one once.", `${PAGE}/sign-in-apps/${app.id}/secret`, "Replace it") : ""}`,
      ),
    );
  }
  items.push(
    control(cutButton("Make a sign-in app", { type: "button", controls: "app-add" })),
    block(
      sheet({
        id: "app-add",
        title: "Make a sign-in app",
        closeLabel: "Close",
        action: `${PAGE}/sign-in-apps`,
        body: stack({
          items: [
            ...fields("app-add"),
            { kind: "block", markup: choiceCards({ id: "app-add-kind", name: "kind", label: "Kind", pickedValue: "confidential", choices: [{ label: "Confidential", choiceValue: "confidential", text: "Your server holds a secret." }, { label: "Public", choiceValue: "public", text: "A page or app with no server." }] }) },
          ],
        }),
        buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Make it", { type: "submit" })],
      }),
    ),
  );
  return settingsPane("sign-in-apps", "Sign-in apps", items);
}

/* ---- Keys ---- */

/** What a key can do and how it stands, as the account page said it: a connected AI app also says where it sends you back. */
function keyDetail(key: ApiKey, games: { slug: string; title: string }[]): string {
  return `${keyScopeText(key, games)}${key.kind === "connected_app" ? ` · connected app · ${key.connected_app_host ?? ""}` : ""} · ${keyStandingText(key)}`;
}

function keysPane(keys: ApiKey[], games: { slug: string; title: string }[], making: Awaited<ReturnType<typeof keyMakingState>>): LayoutItem {
  const items: LayoutItem[] = [
    words("A key lets your AI tool or the upload command work on your games. Treat it like a password: anyone with it can change what it reaches."),
  ];
  if (!keys.length) items.push(block(emptyState({ title: "No keys yet", text: "Make one for your AI tool, or connect an AI app by signing in." })));
  else {
    items.push(
      block(
        listRows({
          label: "Keys",
          rows: keys.map((key): ListRow => ({
            title: key.name,
            detail: keyDetail(key, games),
            end: key.kind === "connected_app" ? tag("AI app", "plain") : undefined,
            action: cutButton("Remove", { type: "button", isSmall: true, controls: `key-remove-${key.id}` }),
          })),
        }),
      ),
      ...keys.map((key) => block(askSheet(`key-remove-${key.id}`, `Remove ${key.name}?`, "Whatever uses it stops working at once.", `${PAGE}/keys/${key.id}/remove`, "Remove"))),
    );
  }
  const canMake = making.passkeyState === "ready";
  items.push(control(cutButton("Make an API key", { type: "button", controls: "key-add" })));
  const levelChoices = ACCESS_LEVELS.map((level) => ({ label: LEVEL_LABELS[level][0], choiceValue: level, text: LEVEL_LABELS[level][1] }));
  items.push(
    block(
      sheet({
        id: "key-add",
        title: "Make an API key",
        closeLabel: "Close",
        action: canMake ? `${PAGE}/keys` : undefined,
        body: canMake
          ? html`<div data-tap="key">${raw('<input type="hidden" name="passkey_id"><input type="hidden" name="client_data_json"><input type="hidden" name="authenticator_data"><input type="hidden" name="signature"><input type="hidden" name="user_handle">')}${stack({
              items: [
                { kind: "control", markup: cutField({ id: "key-name", name: "name", label: "Name", type: "text", icon: "key", placeholder: "Like My laptop or GitHub Actions" }) },
                { kind: "control", markup: selectField({ id: "key-ends", name: "ends_after_days", label: "Ends", choices: [{ label: "Never", choiceValue: "" }, { label: "In 7 days", choiceValue: "7" }, { label: "In 30 days", choiceValue: "30" }, { label: "In 90 days", choiceValue: "90" }, { label: "In a year", choiceValue: "365" }] }) },
                { kind: "block", markup: choiceCards({ id: "key-level", name: "access_level", label: "What it can do", choices: levelChoices, pickedValue: "full", isCompact: true }) },
                ...(games.length
                  ? [
                      { kind: "block" as const, markup: choiceCards({ id: "key-scope", name: "game_scope", label: "Which games", pickedValue: "all", choices: [{ label: "All my games", choiceValue: "all" }, { label: "Only some", choiceValue: "some", text: "It can't make games, sign-in apps or webhooks." }] }) },
                      ...games.map((game): LayoutItem => ({ kind: "block", markup: checkField({ id: `key-game-${game.slug}`, name: "game_slugs", checkValue: game.slug, label: game.title }) })),
                    ]
                  : []),
                { kind: "words", markup: html`<h3>If Custom: for each area</h3>` },
                ...ACCESS_AREAS.map((area): LayoutItem => ({ kind: "control", markup: selectField({ id: `key-area-${area}`, name: area, label: AREA_LABELS[area][0], choices: AREA_ACCESS_CHOICES[area].map((choice: string) => ({ label: CHOICE_LABELS[choice]!, choiceValue: choice })), pickedValue: "read" }) })),
                { kind: "words", markup: html`<p class="field-error" data-tap-error hidden role="alert"></p>` },
              ],
            })}</div>`
          : html`<p>${making.passkeyState === "waiting" && making.approvesFromAtMs !== null ? `Your new passkey can make keys from ${waitEndsText(making.approvesFromAtMs)}.` : "Making a key needs your passkey, so someone who learns your password can't make one."} ${making.passkeyState === "none" ? html`${textLink("Add a passkey", "/account#passkeys")} first.` : ""}</p>`,
        buttons: canMake ? [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Make the key", { type: "submit" })] : [cutButton("Close", { type: "submit", formMethod: "dialog" })],
      }),
    ),
  );
  return settingsPane("keys", "Keys", items);
}

/* ---- The page ---- */

/**
 * Payments' amounts: hidden on this device when the eye is pressed, and kept so. It runs as the page is read, right after the Payments pane
 * (not deferred), so a device that hid them never paints the figures first.
 */
const AMOUNTS_SCRIPT = pageScript(
  "payments-amounts",
  String.raw`(function () {
  var KEY = "zaisma.payments_amounts_hidden";
  var hidden = false;
  try { hidden = localStorage.getItem(KEY) === "yes"; } catch (e) {}
  function draw() {
    document.querySelectorAll("#payments .number-amount, [data-amount]").forEach(function (each) {
      if (!each.hasAttribute("data-amount")) each.setAttribute("data-amount", each.textContent);
      each.textContent = hidden ? "•••" : each.getAttribute("data-amount");
    });
    document.querySelectorAll("[data-amounts-toggle]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(hidden));
      var label = button.querySelector("span:not([class])");
      if (label) label.textContent = hidden ? "Show amounts" : "Hide amounts";
    });
  }
  draw();
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-amounts-toggle]");
    if (!button) return;
    hidden = !hidden;
    try { localStorage.setItem(KEY, hidden ? "yes" : "no"); } catch (e) {}
    draw();
  });
})();`,
);

const SETTINGS_SCRIPT = pageScript(
  "developer-settings",
  String.raw`(function () {
  // The places down the side (and the tabs on a phone) light up for the pane in view.
  var panes = document.querySelectorAll("[data-settings-pane]");
  var switches = document.querySelectorAll(".side-places .tab-switch");
  if (switches.length && "IntersectionObserver" in window && panes.length) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { seen[entry.target.id] = entry.isIntersecting ? entry.boundingClientRect.top : null; });
      var shown = null;
      panes.forEach(function (pane) { if (shown === null && seen[pane.id] !== null && seen[pane.id] !== undefined) shown = pane; });
      if (!shown) return;
      switches.forEach(function (tabs) {
        var tab = tabs.querySelector('a[href="#' + shown.id + '"]');
        if (!tab || tab.getAttribute("aria-current") === "page") return;
        tabs.querySelectorAll("a").forEach(function (each) { each.removeAttribute("aria-current"); });
        tab.setAttribute("aria-current", "page");
        if (tabs.pickTab) tabs.pickTab(tab);
      });
    }, { rootMargin: "-20% 0px -60% 0px" });
    panes.forEach(function (pane) { io.observe(pane); });
  }

  // A spending request's link opens its sheet over the Hosting pane.
  var asking = document.getElementById("spending-request");
  if (asking && asking.showModal && !asking.open) asking.showModal();

  // A form that spends or makes a key taps the passkey first (the server checks it again). A raise: a number above what it is now.
  function tapKind(form) {
    var holder = form.matches("[data-tap]") ? form : form.querySelector("[data-tap]");
    return holder ? holder : null;
  }
  function raises(holder, form) {
    if (holder.getAttribute("data-tap") === "key") return true;
    if (holder.getAttribute("data-tap-always")) return true;
    var over = holder.getAttribute("data-tap-over");
    if (!over) return true;
    var now = JSON.parse(over);
    return Object.keys(now).some(function (name) {
      var field = form.elements[name];
      var typed = field ? Number(String(field.value).replace(/[$,\s]/g, "")) : NaN;
      return !(typed * 100 <= now[name]);
    });
  }
  function say(form, words) {
    var line = form.querySelector("[data-tap-error]");
    if (!line) return;
    line.textContent = words;
    line.hidden = !words;
  }
  document.addEventListener("submit", async function (event) {
    var form = event.target;
    if (!form.matches || !form.matches("form")) return;
    var holder = tapKind(form);
    if (!holder || form.getAttribute("data-tapped") === "yes") return;
    var submitter = event.submitter;
    if (submitter && submitter.hasAttribute("data-no-tap")) return;
    if (!raises(holder, form)) return;
    event.preventDefault();
    say(form, "");
    if (typeof zaismaPasskeyTap !== "function" || !window.PublicKeyCredential) return say(form, "This browser can't use passkeys.");
    var kind = holder.getAttribute("data-tap");
    var tapped = await zaismaPasskeyTap(kind);
    if (tapped.error) return say(form, tapped.error);
    var tap = tapped.tap;
    if (kind === "key") {
      Object.keys(tap).forEach(function (name) { if (form.elements[name]) form.elements[name].value = tap[name]; });
    } else {
      var proof = await pkPost("/api/passkeys/confirm", { id: tap.passkey_id, clientDataJSON: tap.client_data_json, authenticatorData: tap.authenticator_data, signature: tap.signature, userHandle: tap.user_handle });
      if (!proof.ok) return say(form, (proof.data && proof.data.error) || "That passkey didn't work. Try again.");
    }
    form.setAttribute("data-tapped", "yes");
    if (form.requestSubmit) form.requestSubmit(submitter || undefined); else form.submit();
  }, true);
})();`,
);

async function settingsPage(env: Env, request: Request, session: SignedIn, caller: Caller, account: Account, state: PageState = {}, httpStatus = 200): Promise<Response> {
  const [settings, keys, making, spending] = await Promise.all([
    readSettings(env, caller),
    apiKeysFor(env.DB, account.id),
    keyMakingState(env, account.id),
    state.spendingRequestId ? spendingRequestAnswer(env, account.id, caller.ownerId, state.spendingRequestId) : Promise.resolve(null),
  ]);
  const deliveries = state.deliveriesOf
    ? ((await apiCall(env, caller, "GET", `/webhooks/${state.deliveriesOf.webhookId}/deliveries${state.deliveriesOf.cursor ? `?cursor=${encodeURIComponent(state.deliveriesOf.cursor)}` : ""}`).catch(() => null)) as { deliveries?: DeliveryJson[]; next_cursor?: string | null } | null)
    : null;

  const topNotes: LayoutItem[] = [];
  if (state.shownOnce) {
    topNotes.push(
      block(
        glassPane({
          paneWidth: "full",
          body: stack({ items: [{ kind: "words", markup: html`<h2>${state.shownOnce.title}</h2>` }, words(state.shownOnce.text), ...state.shownOnce.lines.map((line): LayoutItem => ({ kind: "block", markup: codeField({ label: line.label, code: line.code }) }))] }),
        }),
      ),
    );
  }

  const requestWords = spending ? spendingChangeWords(spending) : null;
  const spendingSheet: Raw =
    state.spendingRequestId && spending && spending.request_status === "waiting" && requestWords
      ? sheet({
          id: "spending-request",
          title: "Your AI asks",
          closeLabel: "Close",
          action: `${PAGE}/spending/${spending.id}`,
          isShown: false,
          body: html`<div data-tap="confirm" data-tap-always="yes">${stack({ items: [words(requestWords.what), words(requestWords.change), { kind: "words", markup: html`<p class="field-error" data-tap-error hidden role="alert"></p>` }] })}</div>`,
          buttons: [cutButton("Decline", { type: "submit", name: "answer", buttonValue: "declined", dataAttributes: { "no-tap": "" } }), runButton("Approve", { type: "submit", name: "answer", buttonValue: "approved" })],
        })
      : state.spendingRequestId
        ? html`${notice({ text: "That request isn't waiting any more. It was answered, it expired after a day, or it isn't yours.", tone: "problem", isInPlace: false })}`
        : raw("");

  const panes = stack({
    items: [
      ...topNotes,
      hostingPane(settings),
      proPane(settings),
      paymentsPane(settings),
      webhooksPane(settings, state, deliveries?.deliveries ?? null, deliveries?.next_cursor ?? null),
      signInAppsPane(settings),
      keysPane(keys, settings.games.map((game) => ({ slug: game.slug, title: game.title })), making),
    ],
  });
  const body = html`<h1 class="sr">Developer settings</h1>${sidePlaces({ label: "Developer settings", places: TAB_PANES.map((pane, index) => ({ label: pane.label, icon: pane.icon, href: `#${pane.id}`, isCurrent: index === 0 })), body: panes })}${spendingSheet}${state.done && DONE_WORDS[state.done] ? notice({ text: DONE_WORDS[state.done]!, tone: "done" }) : ""}${state.problem ? notice({ text: state.problem, tone: "problem" }) : ""}${scriptTags(PASSKEY_SCRIPT, SETTINGS_SCRIPT)}`;
  const response = layout(env, { title: "Developer settings · Zaisma", body, checkedPage: "Developer settings", nav: "developer", viewer: { account }, isPrivate: true });
  const answered = new Response(response.body, { status: httpStatus, headers: response.headers });
  for (const cookie of session.cookies) answered.headers.append("Set-Cookie", cookie);
  return answered;
}

/** What a waiting request asks, said in a sentence and the change before → after. */
function spendingChangeWords(request: NonNullable<Awaited<ReturnType<typeof spendingRequestAnswer>>>): { what: string; change: string } {
  if (request.request_kind === "game_budget") {
    const askedCents = request.requested_change.monthly_budget_cents ?? null;
    const nowCents = request.current_setting.monthly_budget_cents ?? null;
    return { what: `Your AI asks to raise ${request.game_title ?? request.game_slug}'s monthly budget.`, change: `${request.game_title ?? request.game_slug}'s monthly budget, ${nowCents === null ? "none" : dollars(nowCents)} → ${askedCents === null ? "none" : dollars(askedCents)}` };
  }
  const asked = request.requested_change;
  const now = request.current_setting;
  const describe = (setting: typeof asked) => (setting.is_enabled ? `below ${dollars(setting.top_up_below_cents ?? 0)}, add ${dollars(setting.top_up_amount_cents ?? 0)}, at most ${dollars(setting.monthly_top_up_limit_cents ?? 0)} a month` : "off");
  return { what: "Your AI asks to turn automatic top-up on or up.", change: `Automatic top-up, ${describe(now)} → ${describe(asked)}` };
}

/* ---- Routes ---- */

const bodyField = (form: FormData, name: string, maximumCharacterCount = 2000) => String(form.get(name) ?? "").trim().slice(0, maximumCharacterCount);

export async function handleDeveloperSettings(request: Request, env: Env, path: string): Promise<Response | null> {
  // Its paths written out, as the security map reads them (scripts/security-map/doors.mjs).
  if (path !== "/dashboard/settings" && !path.startsWith("/dashboard/settings/")) return null;
  const isPage = path === "/dashboard/settings";
  const isPost = request.method === "POST";
  if (!isPost && request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  if (isPost && request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });

  const session = await currentSession(request, env);
  if (!session) return redirect(`/signin?next=${encodeURIComponent(PAGE)}`);
  const callerOrNull = await callerFor(env, request, session.userId, session.cookies);
  const account = await accountById(env.DB, session.userId);
  if (!callerOrNull || !account) return redirect("/join?next=/dashboard/settings", session.cookies);
  let caller: Caller = callerOrNull;
  const url = new URL(request.url);

  if (!isPost) {
    if (!isPage) return redirect(PAGE, session.cookies);
    const spendingRequestId = url.searchParams.get("spending_request") ?? undefined;
    const deliveriesOfId = url.searchParams.get("deliveries");
    return settingsPage(env, request, session, caller, account, {
      done: url.searchParams.get("done") ?? (url.searchParams.get("stripe") === "connected" ? "connected" : undefined),
      problem: url.searchParams.get("stripe") && url.searchParams.get("stripe") !== "connected" ? "Stripe didn't connect. The link may have expired: try Connect Stripe again." : undefined,
      spendingRequestId,
      deliveriesOf: deliveriesOfId ? { webhookId: deliveriesOfId, cursor: url.searchParams.get("cursor") } : undefined,
    });
  }

  const form = await request.formData();
  const field = (name: string, maximumCharacterCount?: number) => bodyField(form, name, maximumCharacterCount);
  const back = (done: string, hash: string) => redirect(`${PAGE}?done=${done}#${hash}`, session.cookies);
  const failed = (error: unknown) => {
    if (error instanceof ApiError) return settingsPage(env, request, session, caller, account, { problem: error.messageWithFix }, error.httpStatus);
    throw error;
  };
  caller = await withSpendingConfirmation(env, caller, session);
  const call = (method: string, apiPath: string, payload?: unknown) => apiCall(env, caller, method, apiPath, payload);
  const sub = path.slice(PAGE.length + 1);
  let match: RegExpMatchArray | null;

  try {
    // Hosting
    if (sub === "credit/top-up") {
      const picked = field("amount_cents", 20);
      const cents = picked === "other" || picked === "" ? centsOf(field("other_dollars", 20)) : Number(picked);
      const made = (await call("POST", "/credit/top-ups", { amount_cents: cents })) as { checkout_url: string };
      return redirect(made.checkout_url, session.cookies);
    }
    if ((match = sub.match(/^credit\/refund\/(top_up_[a-z0-9]+)$/))) {
      await call("POST", "/credit/refunds", { top_up_id: match[1] });
      return back("refunded", "hosting");
    }
    if (sub === "credit/automatic") {
      await call("PATCH", "/credit/automatic-top-up", { is_enabled: true, top_up_below_cents: centsOf(field("below_dollars", 20)), top_up_amount_cents: centsOf(field("amount_dollars", 20)), monthly_top_up_limit_cents: centsOf(field("limit_dollars", 20)) });
      return back("automatic", "hosting");
    }
    if (sub === "credit/automatic-off") {
      await call("PATCH", "/credit/automatic-top-up", { is_enabled: false });
      return back("automatic", "hosting");
    }
    if ((match = sub.match(/^games\/([a-z0-9-]+)\/budget(-off)?$/))) {
      const game = await gameBySlug(env.DB, match[1]!);
      if (!game || game.owner_id !== caller.ownerId) return redirect(PAGE, session.cookies);
      await call("PATCH", `/games/${game.slug}`, { monthly_budget_cents: match[2] ? null : centsOf(field("monthly_budget_dollars", 20)) });
      return back(match[2] ? "budget-cleared" : "budget", "hosting");
    }
    if ((match = sub.match(/^spending\/(spending_request_[a-z0-9]+)$/))) {
      const answer = field("answer", 20) === "declined" ? "declined" : "approved";
      const outcome = await answerSpendingRequest(env, caller, match[1]!, answer);
      if (outcome === "not_waiting") return redirect(`${PAGE}?spending_request=${match[1]}#hosting`, session.cookies);
      return back(answer, "hosting");
    }
    // Pro
    if (sub === "pro/checkout") {
      const made = (await call("POST", "/pro/checkout")) as { checkout_url: string };
      return redirect(made.checkout_url, session.cookies);
    }
    if (sub === "pro/cancel" || sub === "pro/resume") {
      await call("POST", `/pro/${sub.slice(4)}`);
      return back(sub === "pro/cancel" ? "cancelled" : "resumed", "pro");
    }
    // Payments
    if (sub === "payments/connect") {
      const made = (await call("POST", "/stripe-account/connection-links")) as { connect_url: string };
      return redirect(made.connect_url, session.cookies);
    }
    if (sub === "payments/tax") {
      await call("PATCH", "/stripe-account", { is_stripe_tax_used: field("is_stripe_tax_used", 10) === "on" });
      return back("tax", "payments");
    }
    if (sub === "payments/disconnect") {
      await call("DELETE", "/stripe-account");
      return back("disconnected", "payments");
    }
    // Webhooks
    if (sub === "webhooks") {
      const isGameServer = field("destination_kind", 20) === "game_server";
      const payload: Record<string, unknown> = { event_kinds: form.getAll("event_kinds").map(String) };
      if (isGameServer) Object.assign(payload, { destination_kind: "game_server", game_slugs: [field("game_server_slug", 60)] });
      else {
        payload.endpoint_url = field("endpoint_url");
        const slugs = form.getAll("game_slugs").map(String);
        if (slugs.length) payload.game_slugs = slugs;
      }
      const made = (await call("POST", "/webhooks", payload)) as { signing_secret?: string };
      if (made.signing_secret) return settingsPage(env, request, session, caller, account, { shownOnce: { title: "Your webhook's signing secret", text: "Copy it now. It won't be shown again.", lines: [{ label: "Signing secret", code: made.signing_secret }] } });
      return back("webhook", "webhooks");
    }
    if ((match = sub.match(/^webhooks\/(webhook_[a-z0-9]+)(?:\/(delete|test|secret))?$/))) {
      const id = match[1]!;
      if (match[2] === "delete") {
        await call("DELETE", `/webhooks/${id}`);
        return back("webhook-deleted", "webhooks");
      }
      if (match[2] === "test") {
        const tested = (await call("POST", `/webhooks/${id}/test`)) as { delivery_status?: string; failure_message?: string | null };
        return tested.delivery_status === "delivered" || !tested.failure_message ? back("tested", "webhooks") : settingsPage(env, request, session, caller, account, { problem: `The test event failed: ${tested.failure_message}` });
      }
      if (match[2] === "secret") {
        const replaced = (await call("PATCH", `/webhooks/${id}`, { replace_signing_secret: true })) as { signing_secret?: string };
        return settingsPage(env, request, session, caller, account, { shownOnce: { title: "Your webhook's new signing secret", text: "Copy it now. It won't be shown again, and the old one has stopped working.", lines: [{ label: "Signing secret", code: replaced.signing_secret ?? "" }] } });
      }
      const payload: Record<string, unknown> = { event_kinds: form.getAll("event_kinds").map(String), game_slugs: form.getAll("game_slugs").length ? form.getAll("game_slugs").map(String) : null };
      if (form.has("endpoint_url")) payload.endpoint_url = field("endpoint_url");
      await call("PATCH", `/webhooks/${id}`, payload);
      return back("webhook", "webhooks");
    }
    // Sign-in apps
    if (sub === "sign-in-apps") {
      const made = (await call("POST", "/sign-in-apps", { name: field("name", 80), kind: field("kind", 20), redirect_urls: field("redirect_urls", 4000).split(/\s+/).filter(Boolean) })) as { client_secret?: string; sign_in_app?: { id: string } };
      const appId = made.sign_in_app?.id ?? "";
      if (made.client_secret) return settingsPage(env, request, session, caller, account, { shownOnce: { title: "Your app's client secret", text: "Copy it now. It won't be shown again.", lines: [{ label: "Client ID", code: appId }, { label: "Client secret", code: made.client_secret }] } });
      return back("app", "sign-in-apps");
    }
    if ((match = sub.match(/^sign-in-apps\/(sign_in_app_[a-z0-9]+)(?:\/(delete|secret))?$/))) {
      const id = match[1]!;
      if (match[2] === "delete") {
        await call("DELETE", `/sign-in-apps/${id}`);
        return back("app-deleted", "sign-in-apps");
      }
      if (match[2] === "secret") {
        const replaced = (await call("PATCH", `/sign-in-apps/${id}`, { replace_client_secret: true })) as { client_secret?: string };
        return settingsPage(env, request, session, caller, account, { shownOnce: { title: "Your app's new client secret", text: "Copy it now. It won't be shown again, and the old one has stopped working.", lines: [{ label: "Client ID", code: id }, { label: "Client secret", code: replaced.client_secret ?? "" }] } });
      }
      await call("PATCH", `/sign-in-apps/${id}`, { name: field("name", 80), redirect_urls: field("redirect_urls", 4000).split(/\s+/).filter(Boolean) });
      return back("app", "sign-in-apps");
    }
    // Keys: made only here, with a tap on a passkey made for keys.
    if (path === "/dashboard/settings/keys" && isPost) {
      const name = field("name", 40) || "My key";
      if ((await liveApiKeyCount(env.DB, account.id)) >= MAXIMUM_API_KEY_COUNT) return settingsPage(env, request, session, caller, account, { problem: `You can have up to ${MAXIMUM_API_KEY_COUNT} keys. Remove one first.` }, 400);
      const ownSlugs = new Set((await env.DB.prepare("SELECT slug FROM games WHERE owner_id = ?").bind(caller.ownerId).all<{ slug: string }>()).results.map((game) => game.slug));
      const scope = keyScopeFromForm(form, ownSlugs);
      const problem = checkKeyScope(scope);
      if (problem) return settingsPage(env, request, session, caller, account, { problem }, 400);
      const passkey = await checkPasskeyTap(request, env, account.id, "key", passkeyTapFromForm(form));
      if (!passkey) {
        const refused = await settingsPage(env, request, session, caller, account, { problem: keyRefusal(await passkeysFor(env.DB, account.id)) }, 400);
        refused.headers.append("Set-Cookie", usedChallengeCookie(env));
        return refused;
      }
      const { key, token } = await createApiKey(env.DB, account.id, name, scope);
      await recordProof(env, session, "passkey", passkey.id);
      await seedKeyPlace(request, env, account.id, key.id);
      await logAccountChange(request, env, account, "api_key_created", { subjectName: name });
      const made = await settingsPage(env, request, session, caller, account, {
        shownOnce: {
          title: `Your new key, "${name}"`,
          text: "Copy it now. It won't be shown again.",
          lines: [{ label: "Key", code: token }, { label: "Connect Claude Code with it", code: `claude mcp add --transport http -s user zaisma ${env.SITE_ORIGIN}/mcp --header "Authorization: Bearer ${token}"` }, { label: "For the upload command, set it as", code: `ZAISMA_KEY=${token}` }],
        },
      });
      made.headers.append("Set-Cookie", usedChallengeCookie(env));
      return made;
    }
    if ((match = sub.match(/^keys\/([a-z0-9]+)\/remove$/))) {
      const removed = (await apiKeysFor(env.DB, account.id)).find((key) => key.id === match![1]);
      if (await revokeApiKey(env.DB, account.id, match[1]!)) await logAccountChange(request, env, account, removed?.kind === "connected_app" ? "connected_app_removed" : "api_key_removed", { subjectName: removed?.name ?? null });
      return back("key-removed", "keys");
    }
  } catch (error) {
    return failed(error);
  }
  return redirect(PAGE, session.cookies);
}
