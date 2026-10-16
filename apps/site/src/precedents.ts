import { PRECEDENT_DECISIONS, audit, newId, type Precedent, type PrecedentDecision } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, raw, type Raw } from "./html.ts";

/**
 * Precedents: the rulings report triage follows (docs/DECISIONS.md). A person sets one while
 * deciding a report in the queue, or here. Changing one makes a new precedent that replaces it, so
 * past decisions keep pointing at the wording they followed. Only dismissals can be applied by the
 * AI alone; bugs and re-checks are automatic anyway, and takedowns always need a person.
 */

const text = (given: unknown, maximumCharacterCount: number) => String(given ?? "").replace(/\s+/g, " ").trim().slice(0, maximumCharacterCount);

/** The fields of a precedent, from the queue's or this page's form. */
function fields(form: FormData, decision: PrecedentDecision) {
  return {
    title: text(form.get("p_title"), 120),
    applies_when: text(form.get("p_when"), 500),
    why: text(form.get("p_why"), 500),
    decision,
    can_ai_apply_alone: decision === "dismiss" && form.get("p_alone") === "1" ? 1 : 0,
  };
}

/** A new precedent in force, replacing the one it changes. Returns its id, or null when the form left it blank. */
export async function savePrecedent(env: Env, form: FormData, decision: PrecedentDecision, actor: string): Promise<string | null> {
  const precedent = fields(form, decision);
  if (!precedent.title || !precedent.applies_when) return null;
  const id = newId("precedent");
  const nowMs = Date.now();
  const replacesPrecedentId = text(form.get("p_replaces"), 40) || null;
  const reportGroupId = text(form.get("group"), 40);
  await env.DB.batch([
    env.DB
      .prepare(
        "INSERT INTO precedents (id, title, applies_when, decision, why, can_ai_apply_alone, precedent_status, replaces_precedent_id, from_report_group_id, created_by, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)",
      )
      .bind(id, precedent.title, precedent.applies_when, precedent.decision, precedent.why, precedent.can_ai_apply_alone, replacesPrecedentId, reportGroupId || null, actor, nowMs, nowMs),
    ...(replacesPrecedentId ? [env.DB.prepare("UPDATE precedents SET precedent_status = 'retired', updated_at_ms = ? WHERE id = ? AND precedent_status = 'active'").bind(nowMs, replacesPrecedentId)] : []),
    ...(reportGroupId ? [env.DB.prepare("UPDATE reports SET precedent_id = ? WHERE id = ? OR report_group_id = ?").bind(id, reportGroupId, reportGroupId)] : []),
  ]);
  await audit(
    env.DB,
    null,
    "precedent-set",
    `${precedent.title}: ${PRECEDENT_DECISIONS[decision]}${precedent.can_ai_apply_alone ? ", by the AI alone" : ""}${replacesPrecedentId ? ` (replaces ${replacesPrecedentId})` : ""}`,
    actor,
  );
  return id;
}

/** POST /admin/precedents and /admin/precedents/:id/(activate|change|retire). */
export async function precedentAction(env: Env, path: string, form: FormData, actor: string): Promise<Response | null> {
  const decision = text(form.get("p_decision"), 20) as PrecedentDecision;
  if (path === "/admin/precedents") {
    if (decision in PRECEDENT_DECISIONS) await savePrecedent(env, form, decision, actor);
    return redirect();
  }
  const match = path.match(/^\/admin\/precedents\/([a-z0-9_-]+)\/(activate|change|retire)$/);
  if (!match) return null;
  const precedent = await env.DB.prepare("SELECT * FROM precedents WHERE id = ?").bind(match[1]!).first<Precedent>();
  if (!precedent) return new Response("Not found", { status: 404 });
  const nowMs = Date.now();
  if (match[2] === "retire") {
    await env.DB.prepare("UPDATE precedents SET precedent_status = 'retired', updated_at_ms = ? WHERE id = ?").bind(nowMs, precedent.id).run();
    await audit(env.DB, null, "precedent-retired", precedent.title, actor);
  } else if (!(decision in PRECEDENT_DECISIONS)) {
    return redirect();
  } else if (match[2] === "activate" && precedent.precedent_status === "proposed") {
    // Never used yet, so it can simply be approved as edited.
    const edited = fields(form, decision);
    if (!edited.title || !edited.applies_when) return redirect();
    await env.DB.prepare("UPDATE precedents SET title = ?, applies_when = ?, decision = ?, why = ?, can_ai_apply_alone = ?, precedent_status = 'active', created_by = ?, updated_at_ms = ? WHERE id = ?")
      .bind(edited.title, edited.applies_when, edited.decision, edited.why, edited.can_ai_apply_alone, actor, nowMs, precedent.id)
      .run();
    await audit(env.DB, null, "precedent-set", `${edited.title}: ${PRECEDENT_DECISIONS[decision]}${edited.can_ai_apply_alone ? ", by the AI alone" : ""}`, actor);
  } else if (match[2] === "change" && precedent.precedent_status === "active") {
    form.set("p_replaces", precedent.id);
    await savePrecedent(env, form, decision, actor);
  }
  return redirect();
}

const redirect = () => new Response(null, { status: 303, headers: { Location: "/admin/precedents" } });

/** The fields, shared by every precedent form. */
function editor(precedent: Partial<Precedent>, chooseDecision: boolean, withAlone = true): Raw {
  return html`<label>Name <input name="p_title" value="${precedent.title ?? ""}" maxlength="120" required></label>
<label>Applies when <textarea name="p_when" rows="2" maxlength="500" required>${precedent.applies_when ?? ""}</textarea></label>
${chooseDecision
    ? html`<label>Decision <select name="p_decision">${Object.entries(PRECEDENT_DECISIONS).map(([decision, label]) => html`<option value="${decision}"${precedent.decision === decision ? raw(" selected") : ""}>${label}</option>`)}</select></label>`
    : ""}
<label>Why <textarea name="p_why" rows="2" maxlength="500">${precedent.why ?? ""}</textarea></label>
${withAlone ? alone(precedent) : ""}`;
}

const alone = (precedent: Partial<Precedent>) =>
  html`<label class="check"><input type="checkbox" name="p_alone" value="1"${precedent.can_ai_apply_alone ? raw(" checked") : ""}> For a dismissal: the AI may dismiss cases like this without you</label>`;

const decisionPill = (precedent: Precedent) =>
  html`<span class="pill ${precedent.decision === "take_down" ? "reject" : precedent.decision === "dismiss" ? "info" : "hold"}">${precedent.decision === "dismiss" && precedent.can_ai_apply_alone ? "Dismiss, by the AI alone" : PRECEDENT_DECISIONS[precedent.decision]}</span>`;

export async function precedentsPage(env: Env): Promise<Raw> {
  const [{ results: all }, { results: uses }] = await Promise.all([
    env.DB.prepare("SELECT * FROM precedents ORDER BY created_at_ms").all<Precedent>(),
    env.DB.prepare("SELECT precedent_id, COUNT(*) AS followed_count FROM reports WHERE precedent_id IS NOT NULL GROUP BY precedent_id").all<{ precedent_id: string; followed_count: number }>(),
  ]);
  const followedCounts = new Map(uses.map((use) => [use.precedent_id, use.followed_count]));
  const times = (id: string) => {
    const followedCount = followedCounts.get(id) ?? 0;
    return followedCount === 1 ? "followed once" : `followed ${followedCount} times`;
  };
  const proposed = all.filter((precedent) => precedent.precedent_status === "proposed");
  const active = all.filter((precedent) => precedent.precedent_status === "active");
  const retired = all.filter((precedent) => precedent.precedent_status === "retired");
  const by = (precedent: Precedent) => (precedent.decision === "dismiss" && precedent.can_ai_apply_alone ? "Dismiss, by the AI alone" : PRECEDENT_DECISIONS[precedent.decision]);
  return html`<h1>Precedents</h1>
<p class="lead">The rulings report triage follows. A report that fits one is decided the same way. Dismissals marked “by the AI alone” happen without you, except 1 in 20, which come to you as spot-checks. Bugs and re-checks are always automatic; takedowns always need you.</p>

${proposed.length
    ? html`<h2>Waiting for you (${proposed.length})</h2>
<p class="muted">Drafted from the content rules. Approve, change first, or drop each one.</p>
${proposed.map(
      (precedent) => html`<form class="note case" method="post" action="/admin/precedents/${precedent.id}/activate" id="p-${precedent.id}">
<div class="row"><strong>${precedent.title}</strong> ${decisionPill({ ...precedent, can_ai_apply_alone: 0 })}</div>
<p>${precedent.applies_when}</p>
${precedent.why ? html`<p class="muted">${precedent.why}</p>` : ""}
<details class="precedent-card"><summary>Change it first</summary>${editor(precedent, true, false)}</details>
${precedent.decision === "dismiss" ? alone(precedent) : ""}
<div class="row"><button class="btn" type="submit">Make it a precedent</button><button class="btn ghost" type="submit" formaction="/admin/precedents/${precedent.id}/retire">Drop</button></div>
</form>`,
    )}`
    : ""}

<h2>In force (${active.length})</h2>
${active.length
    ? active.map(
        (precedent) => html`<article class="note case" id="p-${precedent.id}">
<div class="row"><strong>${precedent.title}</strong> ${decisionPill(precedent)} <span class="muted">${times(precedent.id)}</span></div>
<p>${precedent.applies_when}</p>
${precedent.why ? html`<p class="muted">${precedent.why}</p>` : ""}
<details><summary>Change it</summary>
<form class="precedent-card" method="post" action="/admin/precedents/${precedent.id}/change">
<p class="muted">The change applies to reports from now on. The ${times(precedent.id).replace("followed ", "")} it was followed keep this wording.</p>
${editor(precedent, true)}
<div class="row"><button class="btn" type="submit">Save the change</button><button class="btn ghost" type="submit" formaction="/admin/precedents/${precedent.id}/retire">Retire it</button></div>
</form></details>
</article>`,
      )
    : html`<p class="note">None yet. Set one while deciding a report, or below.</p>`}

<h2>Add one</h2>
<form class="note case precedent-card" method="post" action="/admin/precedents">
${editor({ decision: "dismiss" }, true)}
<div><button class="btn" type="submit">Add the precedent</button></div>
</form>

${retired.length
    ? html`<details class="handled"><summary><h2>Retired (${retired.length})</h2></summary>
<table><tr><th>Name</th><th>Decision</th><th>Applies when</th><th>Used</th></tr>${retired.map(
        (precedent) => html`<tr><td>${precedent.title}</td><td>${by(precedent)}</td><td>${precedent.applies_when}</td><td>${times(precedent.id)}</td></tr>`,
      )}</table></details>`
    : ""}`;
}
