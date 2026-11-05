import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { checkoutPaths, comparePatternFindings, comparisonLines, findingsInCheckout, findingsOnCommit, withoutReviewedSites } from "../../scripts/pattern-rules.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { REVIEWED_SITES } from "../../scripts/pattern-rules/reviewed-sites.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { PATTERN_RULES, findingsInSource } from "../../scripts/pattern-rules/rules.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/**
 * The pattern rules' own working (docs/PATTERN-RULES.md): what each rule catches and lets by, and what a comparison lets out. Nothing
 * here fails on what the rules find in the real code, so no test's log shows a finding.
 */

const ROOT = join(import.meta.dirname, "../..");

interface Finding {
  rule_id: string;
  source_path: string;
  line_number: number;
  symbol_name: string;
  site_text: string;
}

const finding = (given: Partial<Finding> = {}): Finding => ({ rule_id: "code_from_text", source_path: "apps/a.ts", line_number: 1, symbol_name: "run", site_text: "eval(x)", ...given });
const ruleIdsIn = (source: string, path = "apps/site/src/example.ts"): string[] => findingsInSource(source, path).map((each: Finding) => each.rule_id);

/** For each rule: code it must catch, and code that does the same job safely. */
const EXAMPLES: Record<string, { caught: string[]; let_by: string[] }> = {
  sql_text_from_a_value: {
    caught: ["const run = (name: string) => env.DB.prepare(`SELECT * FROM games WHERE slug = '${name}'`);", "export function find(sql: string) { return env.DB.prepare(sql); }", "this.ctx.storage.sql.exec(given);"],
    let_by: [
      'env.DB.prepare("SELECT 1");',
      "env.DB.prepare(`SELECT ${COLUMNS} FROM games`);",
      'env.DB.prepare(`SELECT 1 WHERE id IN (${ids.map(() => "?").join(", ")})`);',
      'const set = (name: string) => assignments.push(`${name} = ?`); const assignments: string[] = []; set("title"); env.DB.prepare(`UPDATE games SET ${assignments.join(", ")}`);',
      'const change = (column: "a" | "b") => env.DB.prepare(`UPDATE t SET ${column} = 1 WHERE id = 2`);',
      'const rows = (sql: string) => env.DB.prepare(sql); rows("SELECT 1"); rows("SELECT 2");',
      "/sql/.exec(text);",
    ],
  },
  sql_without_where: { caught: ['const wipe = "DELETE FROM games";', "const wipe = `UPDATE games SET title = ?`;"], let_by: ['const wipe = "DELETE FROM games WHERE id = ?";'] },
  raw_takes_a_value: {
    caught: ["raw(game.title);", "raw(`<b>${game.title}</b>`);", "export const named = (given: string) => raw(given);"],
    let_by: ['raw("<br>");', "raw(`<b>${esc(game.title)}</b>`);", "raw(ICONS[name]);", "raw(markup.html);", 'raw(html`<b>${game.title}</b>`.html);', 'const box = (open: "a" | "b") => raw(`<i class="${open}"></i>`);'],
  },
  secret_compared_plainly: {
    caught: ["if (given === row.secret) done();", "if (token !== expectedToken) done();", "if (hex(given) === app.client_secret_sha256) done();"],
    let_by: ['if (token === null) done();', 'if (tokenKind === "access") done();', "if (replaceSecret === true) done();", "if (key.id === caller.tokenId) done();", "if (typ === PASS_TOKEN_TYPE) done();"],
  },
  random_for_a_secret: { caught: ["const id = Math.random().toString(36);", "use({ random: Math.random });"], let_by: ["crypto.getRandomValues(bytes);"] },
  message_without_sender_check: {
    caught: ['addEventListener("message", (event) => run(event.data));', 'function onMessage(event) { run(event.data); } window.addEventListener("message", onMessage);'],
    let_by: ['addEventListener("message", (event) => { if (event.source !== frame.contentWindow) return; run(event.data); });', 'channel.addEventListener("message", (event) => run(event.data));', 'function onMessage(event) { if (event.origin === here) run(event.data); } addEventListener("message", onMessage);'],
  },
  frame_without_sandbox: {
    caught: ['const frame = document.createElement("iframe");', 'const markup = html`<iframe src="${path}"></iframe>`;'],
    let_by: ['const frame = document.createElement("iframe"); frame.setAttribute("sandbox", "allow-scripts");', 'const markup = html`<iframe sandbox="allow-scripts" src="${path}"></iframe>`;', 'const frame = document.createElement("div");'],
  },
  body_read_without_cap: {
    caught: ["async function read(request: Request) { return request.json(); }", "async function read(request: Request) { return request.formData(); }", "async function read(request: Request) { return request.clone().text(); }", 'async function read(request: Request) { if (Number(request.headers.get("content-length")) > 10) throw new Error("big"); return request.json(); }'],
    let_by: ["async function read(request: Request) { return readBodyText(request, 10); }", "async function read(answer: Response) { return answer.json(); }"],
  },
  pattern_from_a_value: {
    caught: ["export const fits = (given: string) => new RegExp(given);", "const pattern = new RegExp(`^${query.search}$`);"],
    let_by: ['new RegExp("^a$");', "new RegExp(`^${NAME}$`);", "new RegExp(`^${escapeRegExp(given)}$`);", 'new RegExp(`^${given.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`);', 'NAMES.some((name) => new RegExp(`${name}`).test("a"));'],
  },
  secret_in_a_log: {
    caught: ["console.log(token);", "console.error(`It was ${row.secret}`);", "console.log(request);", "console.log(env);"],
    let_by: ["console.log(row.id);", "console.log(`${secret.name} set`);", "console.log(`Key ${token_count} used`);"],
  },
  secret_in_a_page: {
    caught: ['const page = html`<b>${env.STRIPE_SECRET_KEY}</b>`;', 'pageData("x", { key: env.SIGN_IN_SIGNING_KEY });'],
    let_by: ['const page = html`<b>${env.TURNSTILE_SITE_KEY}</b>`;', 'const page = html`<b>${env.STRIPE_SECRET_KEY ? "on" : "off"}</b>`;', 'const page = html`<b>${env.AI_MONTHLY_INPUT_TOKENS}</b>`;', 'const headers = { key: env.STRIPE_SECRET_KEY };'],
  },
  cookie_without_protection: {
    caught: ['const cookie = "a=1; Path=/; SameSite=Lax; HttpOnly";', 'const cookie = "a=1; Path=/; Secure; HttpOnly";', 'const cookie = "a=1; Path=/; Secure; SameSite=Lax";'],
    let_by: ['const cookie = "a=1; Path=/; Secure; SameSite=Lax; HttpOnly";', 'const cookie = "a=; Max-Age=0; Path=/";', 'const words = "Keep going; it works.";'],
  },
  address_read_unchecked: {
    caught: ['const to = url.searchParams.get("next");', 'const back = String(form.get("back") ?? "");'],
    let_by: ['const to = safeNext(url.searchParams.get("next"));', 'const to = safeNext(form ? form.get("next") : url.searchParams.get("next"));', 'const isQueue = form.get("back") === "queue";', 'const game = url.searchParams.get("game");'],
  },
  cors_echoes_origin: {
    caught: ['headers["Access-Control-Allow-Origin"] = origin;', 'const headers = { "Access-Control-Allow-Origin": origin };', 'const headers = { "Access-Control-Allow-Credentials": "true" };', 'out.set("Access-Control-Allow-Origin", origin);'],
    let_by: ['const headers = { "Access-Control-Allow-Origin": "*" };', 'out.set("Access-Control-Allow-Origin", "*");'],
  },
  error_text_in_an_answer: {
    caught: ["try { run(); } catch (error) { return Response.json({ message: error.message }); }", "try { run(); } catch (error) { return new Response(String(error)); }", "try { run(); } catch (failure) { return new Response(`No: ${failure}`); }"],
    let_by: ['try { run(); } catch (error) { console.error(error); return Response.json({ code: "failed" }); }', "try { run(); } catch (error) { if (error instanceof ApiError) return Response.json({ message: error.message }); throw error; }"],
  },
  money_from_the_request: { caught: ["charge({ amount: body.amount });", "charge({ unit_amount: input.price_cents });"], let_by: ["charge({ amount: item.price_cents });"] },
  code_from_text: {
    caught: ["eval(given);", 'new Function("return 1");', 'setTimeout("run()", 10);'],
    let_by: ["setTimeout(() => run(), delayMs);", "evaluate(given);"],
  },
};

describe("What each rule catches and lets by", () => {
  it("has examples for every rule", () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(PATTERN_RULES.map((rule: { rule_id: string }) => rule.rule_id).sort());
  });

  for (const [ruleId, { caught, let_by: letBy }] of Object.entries(EXAMPLES)) {
    it(`${ruleId} catches what it should`, () => {
      for (const source of caught) expect(ruleIdsIn(source), source).toContain(ruleId);
    });
    it(`${ruleId} lets by what's safe`, () => {
      for (const source of letBy) expect(ruleIdsIn(source), source).not.toContain(ruleId);
    });
  }

  it("reads the browser code a page script holds in its text, at its own line", () => {
    const found = findingsInSource('const SCRIPT = pageScript("a", `\n(() => {\n  var name = Math.random();\n  addEventListener("message", (e) => run(e.data));\n})();`);', "apps/site/src/a.ts");
    expect(found.map((each: Finding) => [each.rule_id, each.line_number])).toEqual([
      ["random_for_a_secret", 3],
      ["message_without_sender_check", 4],
    ]);
  });

  it("says which function holds a finding, and the file's top for code outside one", () => {
    expect(findingsInSource("function run() { eval(given); }", "apps/a.ts")[0].symbol_name).toBe("run");
    expect(findingsInSource("eval(given);", "apps/a.ts")[0].symbol_name).toBe("top level");
  });

  it("reads JavaScript files too", () => {
    expect(ruleIdsIn("eval(given);", "packages/sdk/a.js")).toEqual(["code_from_text"]);
  });
});

describe("What a comparison lets out", () => {
  it("names only what the change adds", () => {
    const comparison = comparePatternFindings({ headFindings: [finding({ site_text: "eval(old)" }), finding({ site_text: "eval(new)", symbol_name: "other", source_path: "apps/b.ts" })], baseFindings: [finding({ site_text: "eval(old)" })] });
    expect(comparison.outcome).toBe("new_findings");
    const lines = comparisonLines(comparison, "abc").join("\n");
    expect(lines).toContain("eval(new)");
    expect(lines).not.toContain("eval(old)");
  });

  it("says nothing of a finding that's on the base too, even moved to another file or line", () => {
    const comparison = comparePatternFindings({ headFindings: [finding({ source_path: "apps/moved.ts", line_number: 90 })], baseFindings: [finding()] });
    expect(comparison.outcome).toBe("nothing_new");
    expect(comparisonLines(comparison, "abc")).toEqual(["Pattern rules: this change adds nothing."]);
  });

  it("counts a second copy of the same line as new", () => {
    expect(comparePatternFindings({ headFindings: [finding({ symbol_name: "other" }), finding({ symbol_name: "other" })], baseFindings: [finding({ symbol_name: "other" })] }).finding_count).toBe(1);
  });

  it("names nothing when one's new where the same rule lost one in that file or function, since it may be an old one edited, and fails", () => {
    for (const edited of [finding({ site_text: "eval(edited)" }), finding({ site_text: "eval(edited)", symbol_name: "other" }), finding({ site_text: "eval(edited)", source_path: "apps/b.ts" })]) {
      const comparison = comparePatternFindings({ headFindings: [edited], baseFindings: [finding()] });
      expect(comparison.outcome).toBe("count_only_fails");
      const lines = comparisonLines(comparison, "abc").join("\n");
      expect(lines).not.toContain("eval(");
      expect(lines).toContain("1 new");
    }
  });

  it("still names a new finding when an old one of another rule went from that file", () => {
    expect(comparePatternFindings({ headFindings: [finding({ site_text: "eval(new)" })], baseFindings: [finding({ rule_id: "raw_takes_a_value", site_text: "raw(x)" })] }).outcome).toBe("new_findings");
  });

  it("has nothing to say when a finding was only fixed", () => {
    expect(comparePatternFindings({ headFindings: [], baseFindings: [finding()] }).outcome).toBe("nothing_new");
  });

  it("prints only counts when it records, whatever it finds", () => {
    const folder = temporaryFolder("pattern-record-");
    const { stdout } = spawnSync("node", ["scripts/pattern-rules.mjs", "--record", join(folder, "findings.json")], { cwd: ROOT, encoding: "utf8" });
    // Tested as a yes or no, so a failure here prints no finding either.
    expect(/^Pattern rules: \d+ findings\.\n$/.test(stdout)).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(join(folder, "findings.json"), "utf8")))).toEqual(["recorded_at", "commit_sha", "finding_count", "findings"]);
    // It reads all of Zaisma's code in a process of its own: seconds here, more on a runner busy with three other test files.
  }, 60_000);
});

describe("What it reads", () => {
  it("reads this checkout and a commit alike, and never a file git ignores", () => {
    const checkout = temporaryFolder("pattern-checkout-");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: checkout, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" } });
    git("init", "--quiet");
    mkdirSync(join(checkout, "apps/site/src/generated"), { recursive: true });
    mkdirSync(join(checkout, "packages/core"), { recursive: true });
    writeFileSync(join(checkout, "packages/core/clean.ts"), "export const number = 1;\n");
    writeFileSync(join(checkout, ".gitignore"), "ignored.ts\n");
    writeFileSync(join(checkout, "apps/site/src/old.ts"), "eval(old);\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "First");
    const baseSha = git("rev-parse", "HEAD").trim();
    writeFileSync(join(checkout, "apps/site/src/added.ts"), "eval(added);\n");
    writeFileSync(join(checkout, "apps/site/src/ignored.ts"), "eval(ignored);\n");
    writeFileSync(join(checkout, "apps/site/src/generated/made.ts"), "eval(made);\n");
    const textsOf = (findings: Finding[]) => findings.map((each) => each.site_text).sort();
    expect(checkoutPaths(checkout)).not.toContain("apps/site/src/ignored.ts");
    expect(textsOf(findingsInCheckout(checkout))).toEqual(["eval(added)", "eval(old)"]);
    expect(textsOf(findingsOnCommit(checkout, baseSha, temporaryFolder("pattern-base-")))).toEqual(["eval(old)"]);
  });
});

describe("Reviewed sites", () => {
  const entries = REVIEWED_SITES as { rule_id: string; source_path: string; symbol_name: string; site_count: number; safe_because: string }[];
  const name = (site: (typeof entries)[number]) => `${site.rule_id}, ${site.source_path}, ${site.symbol_name}`;

  it("answers for a function's sites only at exactly its count", () => {
    const site = { rule_id: "code_from_text", source_path: "apps/a.ts", symbol_name: "run", site_count: 1, safe_because: "Why." };
    expect(withoutReviewedSites([finding()], [site])).toEqual([]);
    expect(withoutReviewedSites([finding(), finding({ site_text: "eval(another)" })], [site])).toHaveLength(2);
    expect(withoutReviewedSites([finding({ symbol_name: "another" })], [site])).toHaveLength(1);
  });

  it("each says why, names a real rule and appears once", () => {
    const ruleIds = PATTERN_RULES.map((rule: { rule_id: string }) => rule.rule_id);
    expect(entries.filter((site) => !site.safe_because.trim() || !ruleIds.includes(site.rule_id)).map(name)).toEqual([]);
    expect(entries.map(name).filter((each, index, all) => all.indexOf(each) !== index)).toEqual([]);
  });

  it("each still matches its count of sites in the code", () => {
    // Names only reviewed sites, which are safe, and never another finding.
    const sites = new Map<string, number>();
    for (const path of [...new Set(entries.map((site) => site.source_path))]) {
      for (const each of findingsInSource(readFileSync(join(ROOT, path), "utf8"), path) as Finding[]) {
        const key = `${each.rule_id}, ${each.source_path}, ${each.symbol_name}`;
        sites.set(key, (sites.get(key) ?? 0) + 1);
      }
    }
    expect(entries.filter((site) => sites.get(name(site)) !== site.site_count).map((site) => `${name(site)}: ${sites.get(name(site)) ?? 0}, listed as ${site.site_count}`)).toEqual([]);
    // It parses every listed file, about a second here and past 5 on a busy runner: the time says nothing about the code.
  }, 60_000);
});

describe("Where it's written down", () => {
  it("the doc names every rule, and only those", () => {
    const doc = readFileSync(join(ROOT, "docs/PATTERN-RULES.md"), "utf8");
    const named = [...doc.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]);
    expect(named.sort()).toEqual(PATTERN_RULES.map((rule: { rule_id: string }) => rule.rule_id).sort());
  });

  it("GitHub's check runs the comparison, and fails with it", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/check.yml"), "utf8");
    expect(workflow).toContain("node scripts/pattern-rules.mjs --compare");
    expect(workflow).toContain('if [ "$PATTERN_RULES_RESULT" != success ] && [ "$PATTERN_RULES_RESULT" != skipped ]; then exit 1; fi');
  });
});
