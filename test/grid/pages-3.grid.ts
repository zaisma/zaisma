import { vi } from "vitest";

vi.mock("../../apps/site/src/shader-check.ts", async (original) => (await import("./shader-stand-in.ts")).shaderCheckStandIn(await original<object>()));

vi.resetModules();
const { gridPageDoors } = await import("./page-doors.ts");
gridPageDoors(3, 3);
