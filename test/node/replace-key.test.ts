import { describe, expect, it } from "vitest";
// @ts-expect-error: a Node script with no types of its own.
import { KEYS, newSpareSteps, setupSteps, slotInUse, swapSteps } from "../../scripts/replace-key.mjs";

/** scripts/replace-key.mjs: what each command would do, from the names of the secrets on production. */

const ROOMS = "zaisma-rooms";
const GAMES = "zaisma-games";
const SITE = "zaisma-site";
const COMPLETE = {
  [ROOMS]: ["PASS_SIGNING_KEY", "SECOND_PASS_SIGNING_KEY", "CHAT_GROUP_KEY", "STORED_SECRETS_KEY", "SECOND_STORED_SECRETS_KEY"],
  [GAMES]: ["STORED_SECRETS_KEY", "SECOND_STORED_SECRETS_KEY"],
  [SITE]: ["SIGN_IN_SIGNING_KEY", "SECOND_SIGN_IN_SIGNING_KEY", "STORED_SECRETS_KEY", "SECOND_STORED_SECRETS_KEY"],
};
const withMarker = (workerNames: string[], marker: string) => ({ ...COMPLETE, ...Object.fromEntries(workerNames.map((workerName) => [workerName, [...COMPLETE[workerName as keyof typeof COMPLETE], marker]])) });

describe("replace-key", () => {
  it("setup puts what today's production lacks, with one stored secrets key across the three Workers", () => {
    const steps = setupSteps({ [ROOMS]: ["PASS_SIGNING_KEY"], [GAMES]: [], [SITE]: ["SIGN_IN_SIGNING_KEY"] });
    expect(steps.map((step: { secretName: string }) => step.secretName)).toEqual(["STORED_SECRETS_KEY", "SECOND_STORED_SECRETS_KEY", "SECOND_PASS_SIGNING_KEY", "SECOND_SIGN_IN_SIGNING_KEY", "CHAT_GROUP_KEY"]);
    expect(steps[0].workerNames).toEqual([ROOMS, GAMES, SITE]);
    expect(setupSteps(COMPLETE)).toEqual([]);
  });

  it("setup refuses a stored secrets key on only some Workers: it can't be read back to copy", () => {
    expect(() => setupSteps({ ...COMPLETE, [GAMES]: [] })).toThrow("can't be read back");
  });

  it("reads the slot in use from the marker's name", () => {
    expect(slotInUse(KEYS.pass, COMPLETE)).toBe("first");
    expect(slotInUse(KEYS.pass, withMarker([ROOMS], "IS_SECOND_PASS_SIGNING_KEY_IN_USE"))).toBe("second");
  });

  it("a swap flips the marker, and touches no key", () => {
    expect(swapSteps("pass", COMPLETE)).toEqual([{ step: "put", workerNames: [ROOMS], secretName: "IS_SECOND_PASS_SIGNING_KEY_IN_USE", valueKind: "true" }]);
    expect(swapSteps("pass", withMarker([ROOMS], "IS_SECOND_PASS_SIGNING_KEY_IN_USE"))).toEqual([{ step: "delete", workerNames: [ROOMS], secretName: "IS_SECOND_PASS_SIGNING_KEY_IN_USE" }]);
    expect(swapSteps("stored-secrets", COMPLETE)[0].workerNames).toEqual([ROOMS, GAMES, SITE]);
  });

  it("finishes a stored secrets swap that stopped partway, and never flips the first Worker back", () => {
    const partway = withMarker([ROOMS], "IS_SECOND_STORED_SECRETS_KEY_IN_USE");
    expect(swapSteps("stored-secrets", partway)).toEqual([{ step: "put", workerNames: [GAMES, SITE], secretName: "IS_SECOND_STORED_SECRETS_KEY_IN_USE", valueKind: "true" }]);
    const partwayBack = withMarker([GAMES, SITE], "IS_SECOND_STORED_SECRETS_KEY_IN_USE");
    expect(swapSteps("stored-secrets", partwayBack)).toEqual([{ step: "delete", workerNames: [GAMES, SITE], secretName: "IS_SECOND_STORED_SECRETS_KEY_IN_USE" }]);
  });

  it("a leak also overwrites the slot it leaves", () => {
    const steps = swapSteps("sign-in", COMPLETE, { isLeaked: true });
    expect(steps[0].secretName).toBe("IS_SECOND_SIGN_IN_SIGNING_KEY_IN_USE");
    expect(steps[1]).toEqual({ step: "put", workerNames: [SITE], secretName: "SIGN_IN_SIGNING_KEY", valueKind: "sign_in_key" });
    const fromSecond = swapSteps("pass", withMarker([ROOMS], "IS_SECOND_PASS_SIGNING_KEY_IN_USE"), { isLeaked: true });
    expect(fromSecond[1].secretName).toBe("SECOND_PASS_SIGNING_KEY");
  });

  it("refuses --leaked on stored secrets, whose values must move first, and a swap to a slot that isn't set", () => {
    expect(() => swapSteps("stored-secrets", COMPLETE, { isLeaked: true })).toThrow("swap without --leaked");
    expect(() => swapSteps("pass", { ...COMPLETE, [ROOMS]: ["PASS_SIGNING_KEY"] })).toThrow("run setup first");
    expect(() => swapSteps("stored-secrets", { ...COMPLETE, [GAMES]: ["STORED_SECRETS_KEY"] })).toThrow("run setup first");
  });

  it("new-spare writes the slot not in use, and refuses while stored secrets are still sealed with it", () => {
    expect(newSpareSteps("pass", COMPLETE)[0].secretName).toBe("SECOND_PASS_SIGNING_KEY");
    expect(newSpareSteps("pass", withMarker([ROOMS], "IS_SECOND_PASS_SIGNING_KEY_IN_USE"))[0].secretName).toBe("PASS_SIGNING_KEY");
    expect(() => newSpareSteps("stored-secrets", COMPLETE, { sealedCountInSpare: 3 })).toThrow("still sealed");
    expect(newSpareSteps("stored-secrets", COMPLETE, { sealedCountInSpare: 0 })[0]).toEqual({ step: "put", workerNames: [ROOMS, GAMES, SITE], secretName: "SECOND_STORED_SECRETS_KEY", valueKind: "random_bytes" });
  });
});
