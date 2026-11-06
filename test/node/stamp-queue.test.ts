// The pages waiting for a stamp (scripts/preview/stamp-queue.mjs) and the Screens bench's view of them (scripts/preview/bench/stamp-page.ts).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { temporaryFolder } from "../temporary-folder.ts";
// @ts-expect-error: a Node script with no types of its own.
import { checkedEntry, entryPicture, isStamped, waitingEntries } from "../../scripts/preview/stamp-queue.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { pictureSize } from "../../scripts/preview/bench/bench-files.mjs";
import { liveBenchUrl, siteFor, stampPage, type StampEntry } from "../../scripts/preview/bench/stamp-page.ts";

const folder = temporaryFolder("zaisma-stamp-queue-test-");
/** A 2 x 3 PNG: its signature, then an IHDR chunk with its size. */
const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000200000003080200000000000000", "hex");
const sheetPath = join(folder, "sheet.png");
writeFileSync(sheetPath, PNG);
const HEAD = "b".repeat(40);
const entry = (changes: Record<string, unknown> = {}) => ({
  pull_request_number: 240, head_sha: HEAD, change_title: "Sheets fade in", session_name: "clever-agnesi-67cd74-5", preview_sites: ["https://mac.tail1234.ts.net:9100", "http://localhost:9100"],
  pages: [{ page_label: "Sheets", path: "/design/panes/sheets", place_value: null, state_value: null, profile: null, contact_sheet_path: sheetPath }],
  concept_picture_path: null, findings: [{ piece: "Sheet", screen: "Phone", state: "Buy Revive", finding: "Appears in one frame", rule: "fault 2", outcome: "fixed", answer: "Its entrance fades." }],
  stamp_file_path: join(folder, "stamps", "pr-240.json"), ...changes,
});

describe("the stamp queue", () => {
  it("takes an entry with closed fields, and fills its addresses and time", () => {
    const { entry: checked } = checkedEntry(entry({ preview_sites: undefined }), { previewSites: ["http://localhost:8800"], nowText: "2026-11-06T19:00:00.000Z" });
    expect(checked.preview_sites).toEqual(["http://localhost:8800"]);
    expect(checked.waiting_since_at).toBe("2026-11-06T19:00:00.000Z");
    expect(checkedEntry(entry({ verdict: "passed" })).error.message).toContain("Unknown field verdict");
    expect(checkedEntry(entry({ head_sha: "abc" })).error.message).toContain("40 hex letters");
    expect(checkedEntry(entry({ pages: [{ page_label: "Sheets", path: "/x", contact_sheet_path: "sheet.png" }] })).error.message).toContain("absolute PNG path");
    expect(checkedEntry(entry({ findings: [{ finding: "x", outcome: "maybe" }] })).error.message).toContain("fixed, answered, open");
    expect(checkedEntry(entry({ preview_sites: ["http://localhost:9100/design"] })).error.message).toContain("with no path");
  });

  it("drops an entry once its stamp names its head, and keeps it for an older head", () => {
    const queue = join(folder, "queue");
    rmSync(queue, { recursive: true, force: true });
    const { entry: checked } = checkedEntry(entry(), { nowText: "2026-11-06T19:00:00.000Z" });
    rmSync(join(folder, "stamps"), { recursive: true, force: true });
    expect(isStamped(checked)).toBe(false);
    mkdirSync(queue, { recursive: true });
    mkdirSync(join(folder, "stamps"), { recursive: true });
    writeFileSync(join(queue, "pr-240.json"), JSON.stringify(checked));
    expect(waitingEntries({ folder: queue }).map((each: { pull_request_number: number }) => each.pull_request_number)).toEqual([240]);
    writeFileSync(checked.stamp_file_path, JSON.stringify({ pr: 240, head_sha: "c".repeat(40) }));
    expect(waitingEntries({ folder: queue })).toHaveLength(1);
    writeFileSync(checked.stamp_file_path, JSON.stringify({ pr: 240, head_sha: HEAD }));
    expect(waitingEntries({ folder: queue })).toEqual([]);
  });

  it("reads only the pictures an entry names, and their sizes", () => {
    const { entry: checked } = checkedEntry(entry());
    expect(entryPicture([checked], 240, "sheet", 0).content_type).toBe("image/png");
    expect(entryPicture([checked], 240, "concept")).toBeNull();
    expect(entryPicture([checked], 241, "sheet", 0)).toBeNull();
    expect(entryPicture([checked], 240, "../../etc/passwd")).toBeNull();
    expect(pictureSize(PNG)).toEqual({ width_px: 2, height_px: 3 });
    expect(pictureSize(Buffer.from("not a picture"))).toBeNull();
  });
});

describe("the stamp view", () => {
  const shown: StampEntry = { pull_request_number: 240, head_sha: HEAD, change_title: "Sheets fade in", session_name: "clever-agnesi-67cd74-5", preview_sites: ["https://mac.tail1234.ts.net:9100", "http://localhost:9100"], waiting_since_at: "2026-11-06T19:00:00.000Z",
    pages: [{ page_label: "Game page, rooms", path: "/g/cave-crew", place_value: "game-page", state_value: "rooms", profile: "Moss_Runner", sheet: { url: "/__preview/bench/stamp-picture?pr=240&kind=sheet&page=0", width_px: 2400, height_px: 900 } }],
    concept: null, findings: [{ piece: "Sheet", finding: "Appears in one frame", outcome: "fixed", answer: "Its entrance fades." }] };

  it("opens each page live on its own preview, at the address it was opened on", () => {
    expect(siteFor(shown, new URL("http://localhost:8800/design/screens?view=stamp"))).toBe("http://localhost:9100");
    expect(siteFor(shown, new URL("https://mac.tail1234.ts.net:8800/design/screens?view=stamp"))).toBe("https://mac.tail1234.ts.net:9100");
    expect(liveBenchUrl(shown, shown.pages[0]!, new URL("http://localhost:8800/"))).toBe("http://localhost:9100/design/screens?place=game-page&state=rooms&profile=Moss_Runner");
    expect(liveBenchUrl(shown, { ...shown.pages[0]!, place_value: null }, new URL("http://localhost:8800/"))).toBe("http://localhost:9100/design/screens?page=%2Fg%2Fcave-crew");
  });

  it("shows each waiting page with its pictures, findings and way to open it, and says when none waits", async () => {
    const env = { SITE_ORIGIN: "http://localhost:8800" } as never;
    const page = await stampPage(env, new URL("http://localhost:8800/design/screens?view=stamp"), [shown]).text();
    for (const part of ["Sheets fade in", "Game page, rooms", "stamp-picture?pr=240", "Appears in one frame", "Fixed", "Open it live", "at commit bbbbbbb"]) expect(page).toContain(part);
    const empty = await stampPage(env, new URL("http://localhost:8800/design/screens?view=stamp"), []).text();
    expect(empty).toContain("Nothing waiting");
  });
});
