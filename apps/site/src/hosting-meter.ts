import { HOSTING_KINDS, type HostingKind } from "@zaisma/core";
import type { UsageMeterOptions } from "./components/data.ts";

/** What each kind of use is called on a page, in the meter's key. */
export const HOSTING_KIND_LABELS: Record<HostingKind, string> = { rooms: "Rooms", game_server: "Game server", relayed_data: "Relay", database: "Database", requests: "Requests", adult_chat_checks: "Chat checks" };

/** A game's month on the hosting meter, as get_stats answers it (hosting_use_this_month). */
export interface HostingMonthJson {
  free_used_pct: number;
  shares: { kind: HostingKind; share_pct: number }[];
  monthly_budget_cents: number | null;
  spent_from_credit_cents: number;
}

/**
 * A game's free allowance and budget on one usage meter: the free part a third of the track and the budget after it when it has one,
 * amber only near the end of the budget. Its fill is split by what used it, each kind in its own color wherever it shows.
 */
export function hostingMeter(label: string, hosting: HostingMonthJson): UsageMeterOptions {
  const budgetCents = hosting.monthly_budget_cents;
  const freePct = hosting.free_used_pct;
  const budgetPct = budgetCents === null ? 0 : Math.min(100, Math.round((hosting.spent_from_credit_cents / Math.max(budgetCents, 1)) * 100));
  const parts = HOSTING_KINDS.flatMap((kind, kindIndex) => {
    const share = hosting.shares.find((each) => each.kind === kind);
    return share ? [{ label: HOSTING_KIND_LABELS[kind], sharePct: share.share_pct, partColorIndex: kindIndex }] : [];
  }).sort((first, second) => second.sharePct - first.sharePct);
  return budgetCents === null
    ? { label, usedNumber: freePct, limitNumber: 100, unit: "%", parts }
    : { label, usedNumber: Math.min(100, freePct) + budgetPct * 2, limitNumber: 300, warnFromNumber: 260, unit: "", isFullFine: budgetPct < 100, parts };
}
