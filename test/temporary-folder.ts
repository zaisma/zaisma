// A temporary folder for a test, removed after its file's tests have run (and, as a backstop, when the process exits), so test runs
// leave nothing in the system's temporary folder. Tests make temporary folders only through this (test/node/temporary-folders.test.ts).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const made: string[] = [];

function removeAll() {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
}

// Registered when a test file first imports this, so it runs after the file's own afterAll hooks (Vitest runs them last first), once
// the servers and databases they close no longer hold the folders.
afterAll(removeAll);
process.on("exit", removeAll);

/** A new, empty folder in the system's temporary folder, its name starting with prefix (like "zaisma-export-"). */
export function temporaryFolder(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  made.push(folder);
  return folder;
}
