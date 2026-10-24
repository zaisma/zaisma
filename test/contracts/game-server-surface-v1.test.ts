import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { GAME_SERVER_OPTIONS } from "../../packages/game-server/src/room.ts";
import * as publicSurface from "../../packages/game-server/src/index.ts";
import { lockSurfaces, ROOT, surfaceOf } from "./surface.ts";

/**
 * The game server package's v1 contract: everything @zaisma/game-server gives a developer (its index, and
 * startServer for their own server), by name, kind and type. From 1.0.0 it only grows. The package's
 * ./internal is Zaisma's own and is never locked.
 */

/** The names a file exports, read by the compiler. */
function exportedNames(file: string): string[] {
  const path = `${ROOT}/${file}`;
  const program = ts.createProgram([path], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noEmit: true, strict: true, types: [] });
  const checker = program.getTypeChecker();
  return checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(path)!)!).map((symbol) => symbol.name).sort();
}

describe("game server package v1", () => {
  const indexNames = exportedNames("packages/game-server/src/index.ts");
  const nodeNames = exportedNames("packages/game-server/bin/node.d.ts");

  lockSurfaces("game-server-surface", { ...surfaceOf("packages/game-server/src/index.ts", indexNames), ...surfaceOf("packages/game-server/bin/node.d.ts", nodeNames) }, { isMainKept: true });

  it("exports its values from the index and nothing from internal-only modules", () => {
    expect(Object.keys(publicSurface).sort()).toEqual(indexNames.filter((name) => name in publicSurface).sort());
    // Zaisma's own parts are in ./internal, never in the public index.
    for (const internalName of ["RoomCore", "checkedRow", "signPass", "roomCallChecksParts", "stateSyncParts"]) expect(indexNames).not.toContain(internalName);
  });

  it("lists as game server options exactly the handlers and settings GameServer has", () => {
    const path = `${ROOT}/packages/game-server/src/room.ts`;
    const program = ts.createProgram([path], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noEmit: true, strict: true, types: [] });
    const checker = program.getTypeChecker();
    const symbol = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(path)!)!).find((exported) => exported.name === "GameServer")!;
    const fieldNames = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)).map((property) => property.name);
    expect([...GAME_SERVER_OPTIONS].sort()).toEqual(fieldNames.sort());
  });

  describe("in Zaisma's sandbox", () => {
    const sandboxSource = readFileSync(`${ROOT}/apps/rooms/src/sandbox.ts`, "utf8");
    const namesIn = (text: string) => text.match(/"[A-Za-z]+"/g)!.map((quoted) => quoted.slice(1, -1));

    it("runs exactly the handlers GameServer has (and the settings stay with the wrapped server)", () => {
      const hooks = namesIn(/const HOOKS = \[([^\]]*)\]/.exec(sandboxSource)![1]!);
      const handlers = [...namesIn(/const HANDLERS = \[([^\]]*)\.\.\.HOOKS\]/.exec(sandboxSource)![1]!), ...hooks];
      const path = `${ROOT}/packages/game-server/src/room.ts`;
      const program = ts.createProgram([path], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noEmit: true, strict: true, types: [] });
      const checker = program.getTypeChecker();
      const symbol = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(path)!)!).find((exported) => exported.name === "GameServer")!;
      const functionOptions = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)).filter((property) => checker.getNonNullableType(checker.getTypeOfSymbol(property)).getCallSignatures().length > 0).map((property) => property.name);
      expect([...handlers].sort()).toEqual([...functionOptions].sort());
      for (const handler of handlers) expect(GAME_SERVER_OPTIONS).toContain(handler);
    });

    it("hands handlers a room with exactly the members Room has", () => {
      const recorder = /function recorder\([^)]*\) \{([\s\S]*?)\n  if \(readOnlyFor\)/.exec(sandboxSource)![1]!;
      const recorderKeys = [...recorder.matchAll(/^    (?:get )?([A-Za-z]+)(?:\(|,|:)/gm)].map((match) => match[1]!);
      const path = `${ROOT}/packages/game-server/src/room.ts`;
      const program = ts.createProgram([path], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noEmit: true, strict: true, types: [] });
      const checker = program.getTypeChecker();
      const symbol = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(path)!)!).find((exported) => exported.name === "Room")!;
      const roomKeys = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)).map((property) => property.name);
      expect([...recorderKeys].sort()).toEqual([...roomKeys].sort());
    });
  });
});
