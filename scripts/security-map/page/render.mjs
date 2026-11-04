import { artSprite, SHIELD_VIEW_BOX } from "./shield.mjs";

/**
 * The Security map page, drawn once at build time into plain HTML. It has no script: every value goes
 * through escapeHtml, details open in place, and the demo's switch is radio buttons and CSS.
 */

const SHIELD_WORDS = { whole: "Whole", cracked: "Cracked", chipped: "Chipped", torn: "Torn in half" };
const SHIELD_MEANINGS = { whole: "Only watch items are left", cracked: "A fix-soon item is open", chipped: "A harden item is open", torn: "A fix-now item is open" };
const STANDING_WORDS = { being_fixed: "Being fixed", waits_on_your_call: "Waits on your call", waits_on_other_work: "Waits on other work", up_next: "Up next" };
const STRENGTH_WORDS = { math: "Math", structure: "Structure", tested: "Tested", trusted: "Trusted" };
const HARM_STEPS = [["one_player", "One player"], ["a_few", "A few"], ["one_game", "One game's players"], ["many_games", "Many games"], ["everyone", "Everyone, or money"]];
const LOCK_STEPS = [["vault", "Vault", "Zaisma's own keys"], ["two_locks", "Two locks", "A stolen key and more"], ["locked", "Locked", "A stolen session"], ["key_in_it", "Key in it", "Any account"], ["open", "Open", "Anyone can"]];
/** How many items show before Show all. */
const ATTENTION_SHOWN_COUNT = 3;

export const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** Zaisma's shield carries the Z and a sector's its emblem; the legend's is plain. */
const shieldOf = (state, sectorId = null, labelText = `Shield: ${SHIELD_WORDS[state].toLowerCase()}`) => `<svg class="shield" viewBox="${SHIELD_VIEW_BOX}" role="img" aria-label="${escapeHtml(labelText)}"><use href="#shield-${state}${sectorId ? `-${sectorId}` : ""}"/></svg>`;
const harmIcon = (level) => `<svg class="icon harm-${level}" aria-hidden="true"><use href="#harm-${level}"/></svg>`;
const lockIcon = (level) => `<svg class="icon lock-${level}${level === "two_locks" ? " icon-wide" : ""}" aria-hidden="true"><use href="#lock-${level}"/></svg>`;
const marksOf = ({ harm_level, harm_line, lock_level, lock_line }) => `<div class="marks"><span class="mark">${harmIcon(harm_level)}<span>${escapeHtml(harm_line)}</span></span><span class="mark">${lockIcon(lock_level)}<span>${escapeHtml(lock_line)}</span></span></div>`;

/** The line under Zaisma's shield. */
export function summaryLineOf({ attention_count, ahead_count }) {
  const aheadText = plural(ahead_count, "item ahead", "items ahead");
  if (attention_count === 0) return ahead_count === 0 ? "Nothing needs attention." : `Nothing needs attention. ${aheadText}.`;
  const attentionText = `${attention_count} ${attention_count === 1 ? "needs" : "need"} attention`;
  return ahead_count === 0 ? `${attentionText}.` : `${attentionText}, ${aheadText}.`;
}

const heroOf = (pageData) => `<header class="hero">${shieldOf(pageData.shield_state, "zaisma")}<h1>${escapeHtml(summaryLineOf(pageData))}</h1></header>`;

const sectorsOf = (pageData, idPrefix) => `<nav class="sectors" aria-label="Sectors">${pageData.sectors.map((sector) => `<a class="sector" href="#${idPrefix}promise-${sector.sector_id}">${shieldOf(sector.shield_state, sector.sector_id)}<b>${escapeHtml(sector.sector_name)}</b></a>`).join("")}</nav>`;

const attentionRowOf = (item) => `<li class="row">${shieldOf(item.shield_state, item.sector_id)}<div class="row-text"><p class="line">${escapeHtml(item.item_line)}</p><p class="goal">${escapeHtml(item.goal_line)}</p>${marksOf(item)}<p class="sub">${escapeHtml(item.sector_name)}. ${STANDING_WORDS[item.item_standing]}.</p></div></li>`;

function attentionOf(pageData) {
  const items = pageData.attention_items;
  if (!items.length) return "";
  const shown = items.slice(0, ATTENTION_SHOWN_COUNT);
  const rest = items.slice(ATTENTION_SHOWN_COUNT);
  const more = rest.length ? `<details class="more"><summary>Show all ${items.length}</summary><ul class="rows">${rest.map(attentionRowOf).join("")}</ul></details>` : "";
  return `<section class="section"><h2>Needs attention first</h2><ul class="rows">${shown.map(attentionRowOf).join("")}</ul>${more}</section>`;
}

const CHEVRON = `<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6 L8 10.5 L12.5 6"/></svg>`;

function promiseOf(sector, idPrefix) {
  const openWords = sector.open_item_count ? `${sector.open_item_count} open` : "Nothing open";
  const openText = sector.watch_item_count ? `${openWords}, ${sector.watch_item_count} on watch.` : `${openWords}.`;
  const ways = sector.ways.map((way) => `<li class="way"><p>${escapeHtml(way.way_line)}</p>${marksOf(way)}</li>`).join("");
  const strengths = sector.strengths.map((strength) => `<li><b>${STRENGTH_WORDS[strength.strength_kind]}:</b> ${escapeHtml(strength.strength_line)}</li>`).join("");
  return `<details class="promise" id="${idPrefix}promise-${sector.sector_id}"><summary>${shieldOf(sector.shield_state, sector.sector_id)}<span class="row-text"><span class="line">${escapeHtml(sector.promise_line)}</span><span class="sub">${escapeHtml(sector.sector_name)}. ${openText} ${plural(sector.ways.length, "way", "ways")} it could break.</span></span>${CHEVRON}</summary><div class="promise-body"><div><h3>The only ways it could break</h3><ul class="ways">${ways}</ul></div><div><h3>What it rests on</h3><ul class="rests">${strengths}</ul></div></div></details>`;
}

const promisesOf = (pageData, idPrefix) => `<section class="section"><h2>Promises</h2><div class="rows">${pageData.sectors.map((sector) => promiseOf(sector, idPrefix)).join("")}</div></section>`;

function workAheadOf({ work_ahead }) {
  const rows = [["Fix now", work_ahead.fix_now_count], ["Harden", work_ahead.harden_count], ["Fix soon", work_ahead.fix_soon_count], ["Watch", work_ahead.watch_count], ["Questions with no proof yet", work_ahead.question_count], ["Failures from the grid, for the next review", work_ahead.grid_failure_count], ["Pattern findings, for the next review", work_ahead.pattern_finding_count], ["Lines whose code changed, for the next review", work_ahead.changed_code_count]];
  return `<section class="section"><h2>Work ahead</h2><dl class="counts">${rows.map(([label, count]) => `<div class="count${count ? "" : " is-zero"}"><dt>${label}</dt><dd>${count}</dd></div>`).join("")}</dl></section>`;
}

const legendOf = () => `<details class="legend"><summary>What the pictures mean</summary><div class="legend-body"><div class="legend-row">${Object.keys(SHIELD_WORDS).map((state) => `<div class="legend-step"><svg class="shield" viewBox="${SHIELD_VIEW_BOX}" aria-hidden="true"><use href="#shield-${state}"/></svg><b>${SHIELD_WORDS[state]}</b><span>${SHIELD_MEANINGS[state]}</span></div>`).join("")}</div><div><p class="legend-name">Who it hits</p><div class="legend-row">${HARM_STEPS.map(([level, words]) => `<div class="legend-step">${harmIcon(level)}<span>${words}</span></div>`).join("")}</div></div><div><p class="legend-name">What it takes</p><div class="legend-row">${LOCK_STEPS.map(([level, name, words]) => `<div class="legend-step">${lockIcon(level)}<b>${name}</b><span>${words}</span></div>`).join("")}</div></div></div></details>`;

const footOf = ({ last_review_date }) => `<footer class="foot"><p>${last_review_date ? `Last daily review: ${escapeHtml(last_review_date)}.` : "No daily review yet."}</p>${legendOf()}</footer>`;

const scenarioBodyOf = (pageData, idPrefix) => `${heroOf(pageData)}${sectorsOf(pageData, idPrefix)}${attentionOf(pageData)}${promisesOf(pageData, idPrefix)}${workAheadOf(pageData)}${footOf(pageData)}`;

const pageShell = (css, inner) => `<title>Zaisma Security Map</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>\n${css}</style>\n${artSprite()}\n<main class="page">${inner}</main>\n`;

/** The page itself, from one page's data. */
export const renderPage = (pageData, css) => pageShell(css, scenarioBodyOf(pageData, ""));

/** The demo: every made-up scenario behind a switch, so each state can be looked at from one link. */
export function renderDemoPage(scenarios, css) {
  const inputs = scenarios.map(({ scenario_id }, index) => `<input class="demo-input" type="radio" name="scenario" id="show-${scenario_id}"${index === 0 ? " checked" : ""}>`).join("");
  const labels = scenarios.map(({ scenario_id, scenario_name }) => `<label for="show-${scenario_id}">${escapeHtml(scenario_name)}</label>`).join("");
  const bodies = scenarios.map(({ scenario_id, page_data }) => `<div class="scenario scenario-${scenario_id}">${scenarioBodyOf(page_data, `${scenario_id}-`)}</div>`).join("");
  const showRules = scenarios.map(({ scenario_id }) => `#show-${scenario_id}:checked ~ .scenario-${scenario_id} { display: grid; }\n#show-${scenario_id}:checked ~ .demo-switch label[for="show-${scenario_id}"] { background: var(--plate-hi); color: var(--fg); }\n#show-${scenario_id}:focus-visible ~ .demo-switch label[for="show-${scenario_id}"] { outline: 2px solid var(--chrome); }`).join("\n");
  return pageShell(`${css}${showRules}\n`, `${inputs}<div class="demo-switch"><p class="demo-note">Made-up items, to judge the look.</p>${labels}</div>${bodies}`);
}
