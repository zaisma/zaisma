import { writeFileSync } from "node:fs";
import type { Reporter, TestModule } from "vitest/node";
import type { GridCell } from "./cells.ts";

/**
 * The contract test grid's reporter: writes every cell to the file ZAISMA_CONTRACT_GRID_RESULTS names, and prints
 * nothing, so a run on a public check shows no cell. A door's test that failed means the grid itself couldn't try it.
 */
export default class ContractGridReporter implements Reporter {
  onTestRunEnd(testModules: readonly TestModule[]): void {
    const cells: GridCell[] = [];
    const doorsNotTried: string[] = [];
    for (const testModule of testModules) {
      if (testModule.state() === "failed" && [...testModule.children.allTests()].length === 0) doorsNotTried.push(`file:${testModule.relativeModuleId}`);
      for (const testCase of testModule.children.allTests()) {
        cells.push(...(testCase.meta().grid_cells ?? []));
        if (testCase.result().state !== "passed") doorsNotTried.push(testCase.name);
      }
    }
    writeFileSync(process.env.ZAISMA_CONTRACT_GRID_RESULTS!, `${JSON.stringify({ cells, doors_not_tried: doorsNotTried }, null, 1)}\n`);
  }
}
