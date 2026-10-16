#!/usr/bin/env node
// One roadmap item with what's needed to start it, read from GitHub's main (run `git fetch origin` first).
//   node scripts/roadmap-item.mjs            the first item in Now
//   node scripts/roadmap-item.mjs 2          the second item in Now
//   node scripts/roadmap-item.mjs "Game database"   any item, by its exact name
// Prints the item's row, its project's goal and "Done when", whether its Needs are done, and the
// project's other rows. Exits 1 when Now is empty or the item isn't on the roadmap.

import { execFileSync } from "node:child_process";

const text = execFileSync("git", ["show", "origin/main:docs/ROADMAP.md"], { encoding: "utf8" });
const lines = text.split("\n");

const nowItems = [];
let isNow = false;
for (const line of lines) {
  if (/^## /.test(line)) isNow = line === "## Now";
  const entry = isNow && line.match(/^\d+\.\s+(.+?)(?:\s+\((.+)\))?$/);
  if (entry) nowItems.push(entry[1]);
}

/** Every row of every table, with the phase and project it sits in. */
const rows = [];
let phase = "";
let project = { title: "", intro: "" };
let header = null;
for (const line of lines) {
  if (/^## /.test(line)) { phase = line.slice(3); project = { title: "", intro: "" }; header = null; continue; }
  if (/^### /.test(line)) { project = { title: line.slice(4), intro: "" }; header = null; continue; }
  if (!line.startsWith("|")) {
    header = null;
    if (line.trim() && project.title && !project.intro) project.intro = line.trim();
    continue;
  }
  const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
  if (cells.every((cell) => /^-+$/.test(cell))) continue;
  if (!header) { header = cells.map((cell) => cell.toLowerCase()); continue; }
  const get = (key) => cells[header.indexOf(key)] ?? "";
  rows.push({ phase, project, status: get("status"), mustOrNice: get("must/nice"), name: get("item"), needs: get("needs"), notes: get("notes") });
}

const asked = process.argv.slice(2).join(" ").trim() || "1";
let name = asked;
if (/^\d+$/.test(asked)) {
  if (!nowItems.length) {
    console.log("Now is empty: nothing is lined up. Use the whats-next skill to propose what comes next.");
    process.exit(1);
  }
  name = nowItems[Number(asked) - 1];
  if (!name) {
    console.log(`Now has ${nowItems.length} item${nowItems.length === 1 ? "" : "s"}: ${nowItems.map((item, i) => `${i + 1}. ${item}`).join("  ")}`);
    process.exit(1);
  }
}

const row = rows.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
if (!row) {
  const close = rows.filter((candidate) => candidate.name.toLowerCase().includes(name.toLowerCase())).map((candidate) => candidate.name);
  console.log(`No roadmap item is named "${name}".${close.length ? ` Close: ${close.join("; ")}` : ""}`);
  process.exit(1);
}

const statusOf = new Map(rows.map((candidate) => [candidate.name.toLowerCase(), candidate.status]));
const needs = row.needs.split(",").map((need) => need.trim()).filter(Boolean);
const nowPlace = nowItems.findIndex((item) => item.toLowerCase() === row.name.toLowerCase());

console.log(`Item: ${row.name}${nowPlace >= 0 ? `  (Now #${nowPlace + 1} of ${nowItems.length})` : "  (not in Now)"}`);
console.log(`Status: ${row.status}${row.mustOrNice ? `, ${row.mustOrNice}` : ""}`);
console.log(`Where: ${row.phase}${row.project.title ? ` > ${row.project.title}` : ""}`);
if (row.project.intro) console.log(`Project: ${row.project.intro}`);
console.log(`Needs: ${needs.length ? needs.map((need) => `${need} (${statusOf.get(need.toLowerCase()) ?? "no such item"})`).join(", ") : "nothing"}`);
console.log(`Notes: ${row.notes || "(none)"}`);
const others = rows.filter((candidate) => candidate.project === row.project && candidate !== row);
if (others.length) {
  console.log("Other rows in the project:");
  for (const other of others) console.log(`  ${other.status.padEnd(8)} ${other.name}`);
}
