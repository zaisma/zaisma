import { PRECEDENT_DECISIONS, audit, newId, type Precedent, type PrecedentDecision } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, raw, type Raw } from "./html.ts";

/**
 * Precedents: the rulings report triage follows (docs/DECISIONS.md). A person sets one while
 * deciding a report in the queue, or here. Changing one makes a new precedent that replaces it, so
 * past decisions keep pointing at the wording they followed. Only dismissals can be applied by the
 * AI alone; bugs and re-checks are automatic anyway, and takedowns always need a person.
 */

const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The fields of a precedent, from the queue's or this page's form. */
function fields(form: FormData, decision: PrecedentDecision) {
  return {
    title: text(form.get("p_title"), 120),
    applies_when: text(form.get("p_when"), 500),
    why: text(form.get("p_why"), 500),
    decision,
    ai_alone: decision === "dismiss" && form.get("p_alone") === "1" ? 1 : 0,
  };
}

/** A new precedent in force, replacing the one it changes. Returns its id, or null when the form left it blank. */
export async function savePrecedent(env: Env, form: FormData, decision: PrecedentDecision, actor: string): Promise<string | null> {
  const p = fields(form, decision);
  if (!p.title || !p.applies_when) return null;
  const id = newId();
  const now = Date.now();
  const replaces = text(form.get("p_replaces"), 40) || null;
  const group = text(form.get("group"), 40);
  await env.DB.batch([
    env.DB
      .prepare("INSERT INTO precedents (id, title, applies_when, decision, why, ai_alone, status, replaces, from_report, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)")
      .bind(id, p.title, p.applies_when, p.decision, p.why, p.ai_alone, replaces, group || null, actor, now, now),
    ...(replaces ? [env.DB.prepare("UPDATE precedents SET status = 'retired', updated_at = ? WHERE id = ? AND status = 'active'").bind(now, replaces)] : []),
    ...(group ? [env.DB.prepare("UPDATE reports SET precedent_id = ? WHERE id = ? OR group_id = ?").bind(id, group, group)] : []),
  ]);
  await audit(env.DB, null, "precedent-set", `${p.title}: ${PRECEDENT_DECISIONS[decision]}${p.ai_alone ? ", by the AI alone" : ""}${replaces ? ` (replaces ${replaces})` : ""}`, actor);
  return id;
}

/** POST /admin/precedents and /admin/precedents/:id/(activate|change|retire). */
export async function precedentAction(env: Env, path: string, form: FormData, actor: string): Promise<Response | null> {
  const decision = text(form.get("p_decision"), 20) as PrecedentDecision;
  if (path === "/admin/precedents") {
    if (decision in PRECEDENT_DECISIONS) await savePrecedent(env, form, decision, actor);
    return redirect();
  }
  const m = path.match(/^\/admin\/precedents\/([a-z0-9-]+)\/(activate|change|retire)$/);
  if (!m) return null;
  const precedent = await env.DB.prepare("SELECT * FROM precedents WHERE id = ?").bind(m[1]!).first<Precedent>();
  if (!precedent) return new Response("Not found", { status: 404 });
  const now = Date.now();
  if (m[2] === "retire") {
    await env.DB.prepare("UPDATE precedents SET status = 'retired', updated_at = ? WHERE id = ?").bind(now, precedent.id).run();
    await audit(env.DB, null, "precedent-retired", precedent.title, actor);
  } else if (!(decision in PRECEDENT_DECISIONS)) {
    return redirect();
  } else if (m[2] === "activate" && precedent.status === "proposed") {
    // Never used yet, so it can simply be approved as edited.
    const p = fields(form, decision);
    if (!p.title || !p.applies_when) return redirect();
    await env.DB.prepare("UPDATE precedents SET title = ?, applies_when = ?, decision = ?, why = ?, ai_alone = ?, status = 'active', created_by = ?, updated_at = ? WHERE id = ?")
      .bind(p.title, p.applies_when, p.decision, p.why, p.ai_alone, actor, now, precedent.id)
      .run();
    await audit(env.DB, null, "precedent-set", `${p.title}: ${PRECEDENT_DECISIONS[decision]}${p.ai_alone ? ", by the AI alone" : ""}`, actor);
  } else if (m[2] === "change" && precedent.status === "active") {
    form.set("p_replaces", precedent.id);
    await savePrecedent(env, form, decision, actor);
  }
  return redirect();
}

const redirect = () => new Response(null, { status: 303, headers: { Location: "/admin/precedents" } });

/** The fields, shared by every precedent form. */
function editor(p: Partial<Precedent>, chooseDecision: boolean, withAlone = true): Raw {
  return html`<label>Name <input name="p_title" value="${p.title ?? ""}" maxlength="120" required></label>
<label>Applies when <textarea name="p_when" rows="2" maxlength="500" required>${p.applies_when ?? ""}</textarea></label>
${chooseDecision
    ? html`<label>Decision <select name="p_decision">${Object.entries(PRECEDENT_DECISIONS).map(([k, v]) => html`<option value="${k}"${p.decision === k ? raw(" selected") : ""}>${v}</option>`)}</select></label>`
    : ""}
<label>Why <textarea name="p_why" rows="2" maxlength="500">${p.why ?? ""}</textarea></label>
${withAlone ? alone(p) : ""}`;
}

const alone = (p: Partial<Precedent>) =>
  html`<label class="check"><input type="checkbox" name="p_alone" value="1"${p.ai_alone ? raw(" checked") : ""}> For a dismissal: the AI may dismiss cases like this without you</label>`;

const decisionPill = (p: Precedent) =>
  html`<span class="pill ${p.decision === "take_down" ? "reject" : p.decision === "dismiss" ? "info" : "hold"}">${p.decision === "dismiss" && p.ai_alone ? "Dismiss, by the AI alone" : PRECEDENT_DECISIONS[p.decision]}</span>`;

export async function precedentsPage(env: Env): Promise<Raw> {
  const [{ results: all }, { results: uses }] = await Promise.all([
    env.DB.prepare("SELECT * FROM precedents ORDER BY created_at").all<Precedent>(),
    env.DB.prepare("SELECT precedent_id, COUNT(*) AS n FROM reports WHERE precedent_id IS NOT NULL GROUP BY precedent_id").all<{ precedent_id: string; n: number }>(),
  ]);
  const used = new Map(uses.map((u) => [u.precedent_id, u.n]));
  const times = (id: string) => {
    const n = used.get(id) ?? 0;
    return n === 1 ? "followed once" : `followed ${n} times`;
  };
  const proposed = all.filter((p) => p.status === "proposed");
  const active = all.filter((p) => p.status === "active");
  const retired = all.filter((p) => p.status === "retired");
  const by = (p: Precedent) => (p.decision === "dismiss" && p.ai_alone ? "Dismiss, by the AI alone" : PRECEDENT_DECISIONS[p.decision]);
  return html`<h1>Precedents</h1>
<p class="lead">The rulings report triage follows. A report that fits one is decided the same way. Dismissals marked “by the AI alone” happen without you, except 1 in 20, which come to you as spot-checks. Bugs and re-checks are always automatic; takedowns always need you.</p>

${proposed.length
    ? html`<h2>Waiting for you (${proposed.length})</h2>
<p class="muted">Drafted from the content rules. Approve, change first, or drop each one.</p>
${proposed.map(
      (p) => html`<form class="note case" method="post" action="/admin/precedents/${p.id}/activate" id="p-${p.id}">
<div class="row"><strong>${p.title}</strong> ${decisionPill({ ...p, ai_alone: 0 })}</div>
<p>${p.applies_when}</p>
${p.why ? html`<p class="muted">${p.why}</p>` : ""}
<details class="precedent-card"><summary>Change it first</summary>${editor(p, true, false)}</details>
${p.decision === "dismiss" ? alone(p) : ""}
<div class="row"><button class="btn" type="submit">Make it a precedent</button><button class="btn ghost" type="submit" formaction="/admin/precedents/${p.id}/retire">Drop</button></div>
</form>`,
    )}`
    : ""}

<h2>In force (${active.length})</h2>
${active.length
    ? active.map(
        (p) => html`<article class="note case" id="p-${p.id}">
<div class="row"><strong>${p.title}</strong> ${decisionPill(p)} <span class="muted">${times(p.id)}</span></div>
<p>${p.applies_when}</p>
${p.why ? html`<p class="muted">${p.why}</p>` : ""}
<details><summary>Change it</summary>
<form class="precedent-card" method="post" action="/admin/precedents/${p.id}/change">
<p class="muted">The change applies to reports from now on. The ${times(p.id).replace("followed ", "")} it was followed keep this wording.</p>
${editor(p, true)}
<div class="row"><button class="btn" type="submit">Save the change</button><button class="btn ghost" type="submit" formaction="/admin/precedents/${p.id}/retire">Retire it</button></div>
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
        (p) => html`<tr><td>${p.title}</td><td>${by(p)}</td><td>${p.applies_when}</td><td>${times(p.id)}</td></tr>`,
      )}</table></details>`
    : ""}`;
}
