// Reads docs/ROADMAP.md: Now (its First and Next parts), every row, and each project's First line.
// Shared by scripts/roadmap-item.mjs and the roadmap test.

const firstLabel = /^\*\*First:\*\*\s*(.*)$/;
const nextLabel = /^\*\*Next:\*\*\s*(.*)$/;
const nowEntry = /^\d+\.\s+(.+?)(?:\s+\((.+)\))?$/;

/** Item names in a "**First:** a, b" line; "nothing" or an empty line is none. */
function namesAfterLabel(rest) {
  const trimmed = rest.trim().replace(/\.$/, "");
  if (!trimmed || trimmed.toLowerCase() === "nothing") return [];
  return trimmed.split(",").map((name) => name.trim()).filter(Boolean);
}

/**
 * @param {string} text the whole of docs/ROADMAP.md
 * @returns {{ nowItems: { name: string, part: "first" | "next" }[], rows: object[], projects: object[] }}
 */
export function parseRoadmap(text) {
  const lines = text.split("\n");

  const nowItems = [];
  let isNow = false;
  let part = "next";
  for (const line of lines) {
    if (/^## /.test(line)) { isNow = line === "## Now"; continue; }
    if (!isNow) continue;
    const first = line.match(firstLabel);
    if (first) { part = "first"; for (const name of namesAfterLabel(first[1])) nowItems.push({ name, part }); continue; }
    if (nextLabel.test(line)) { part = "next"; continue; }
    const entry = line.match(nowEntry);
    if (entry) nowItems.push({ name: entry[1], part });
  }

  /** Every row of every table, with the phase and project it sits in. */
  const rows = [];
  const projects = [];
  let phase = "";
  let project = { title: "", intro: "", firstItemNames: [] };
  let header = null;
  for (const line of lines) {
    if (/^## /.test(line)) { phase = line.slice(3); project = { title: "", intro: "", firstItemNames: [] }; header = null; continue; }
    if (/^### /.test(line)) { project = { title: line.slice(4), intro: "", firstItemNames: [] }; projects.push(project); header = null; continue; }
    if (!line.startsWith("|")) {
      header = null;
      const first = project.title && line.match(firstLabel);
      if (first) project.firstItemNames.push(...namesAfterLabel(first[1]));
      else if (line.trim() && project.title && !project.intro) project.intro = line.trim();
      continue;
    }
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    if (!header) { header = cells.map((cell) => cell.toLowerCase()); continue; }
    const get = (key) => cells[header.indexOf(key)] ?? "";
    rows.push({ phase, project, status: get("status"), mustOrNice: get("must/nice"), name: get("item"), needs: get("needs"), notes: get("notes") });
  }

  return { nowItems, rows, projects };
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

/** The row with this exact name, or undefined. */
export function findRow(roadmap, name) {
  return roadmap.rows.find((row) => sameName(row.name, name));
}

/**
 * What has to land before this row can start, beyond its own Needs: First items in Now, then its
 * project's First items. A First item never waits on the others in its own First list.
 * @returns {{ name: string, status: string, gate: "now" | "project" }[]}
 */
export function firstBlockers(roadmap, row) {
  const statusOf = (name) => findRow(roadmap, name)?.status ?? "no such item";
  const blockers = [];
  const nowFirst = roadmap.nowItems.filter((item) => item.part === "first").map((item) => item.name);
  if (!nowFirst.some((name) => sameName(name, row.name))) {
    for (const name of nowFirst) if (statusOf(name) !== "done") blockers.push({ name, status: statusOf(name), gate: "now" });
  }
  const projectFirst = row.project.firstItemNames ?? [];
  if (!projectFirst.some((name) => sameName(name, row.name))) {
    for (const name of projectFirst) if (statusOf(name) !== "done") blockers.push({ name, status: statusOf(name), gate: "project" });
  }
  return blockers;
}

/** Names in Now and in First lines that aren't an item on the roadmap. */
export function unknownNames(roadmap) {
  const named = [
    ...roadmap.nowItems.map((item) => item.name),
    ...roadmap.projects.flatMap((project) => project.firstItemNames),
  ];
  return named.filter((name) => !findRow(roadmap, name));
}
