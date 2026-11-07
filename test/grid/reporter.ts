import { writeFileSync } from "node:fs";
import type { Reporter, TestModule } from "vitest/node";
// @ts-expect-error: a plain JavaScript script without types
import { loadSiteModule } from "../../scripts/security-map/load-site.mjs";
import type { GridCell } from "./cells.ts";
import { doorIdsOfGridFile, type GridTables } from "./file-doors.ts";

/**
 * The contract test grid's reporter: writes every cell to the file ZAISMA_CONTRACT_GRID_RESULTS names, and prints
 * nothing, so a run on a public check shows no cell. A door's test that failed means the grid itself couldn't try it,
 * and a file that failed as a whole couldn't try any of its doors: each is named, from the door tables (file-doors.ts),
 * and only a file the tables can't say, or tables that won't load, is named as `file:` itself.
 */
export default class ContractGridReporter implements Reporter {
  async onTestRunEnd(testModules: readonly TestModule[]): Promise<void> {
    const cells: GridCell[] = [];
    const doorsNotTried: string[] = [];
    const filesNotTried: string[] = [];
    for (const testModule of testModules) {
      if (testModule.state() === "failed" && [...testModule.children.allTests()].length === 0) filesNotTried.push(testModule.relativeModuleId.replace(/^\/+/, ""));
      for (const testCase of testModule.children.allTests()) {
        cells.push(...(testCase.meta().grid_cells ?? []));
        if (testCase.result().state !== "passed") doorsNotTried.push(testCase.name);
      }
    }
    if (filesNotTried.length) {
      const tables = (await loadSiteModule(process.cwd()).catch(() => null)) as GridTables | null;
      for (const file of filesNotTried) doorsNotTried.push(...((tables && doorIdsOfGridFile(file, tables)) ?? [`file:${file}`]));
    }
    writeFileSync(process.env.ZAISMA_CONTRACT_GRID_RESULTS!, `${JSON.stringify({ cells, doors_not_tried: [...new Set(doorsNotTried)] }, null, 1)}\n`);
  }
}
