import { describe, expect, it } from "vitest";
import {
  KNOWN_IMAGE_CODE,
  eitherMatcher,
  notConnected,
  photoDna,
  readMatchHashAnswer,
  type ImageMatcher,
  type MediaForMatching,
  type PhotoDnaHashOutcome,
  type PhotoDnaMatchOutcome,
  type PhotoDnaService,
} from "@zaisma/core";

const media = (path: string, text = path, type = "image/png"): MediaForMatching => ({ path, type, id: text, body: async () => new TextEncoder().encode(text) });

/** A stand-in photodna Worker: each picture's hash is its text, "BAD" ones match, "TINY" ones can't be hashed. */
function service(options: { hash?: (text: string) => PhotoDnaHashOutcome; match?: (hashes: string[]) => PhotoDnaMatchOutcome } = {}) {
  const requests: { hashes: string[]; priority: string }[] = [];
  const hashed: string[] = [];
  const photo: PhotoDnaService = {
    async hash(item) {
      const text = new TextDecoder().decode((await item.body()) as Uint8Array);
      hashed.push(text);
      if (options.hash) return options.hash(text);
      return text === "TINY" ? { kind: "skip", why: "too small" } : { kind: "hash", hash: `hash:${text}` };
    },
    async match(hashes, priority) {
      requests.push({ hashes, priority });
      if (options.match) return options.match(hashes);
      return { kind: "results", results: hashes.map((hash) => ({ isMatch: hash === "hash:BAD", sources: hash === "hash:BAD" ? ["Test"] : [] })) };
    },
  };
  return { photo, requests, hashed };
}

const shieldSays = (result: Partial<Awaited<ReturnType<ImageMatcher["check"]>>>): ImageMatcher => ({
  async check() {
    return { provider: "arachnid-shield", isConnected: true, checkedMediaCount: 0, findings: [], ...result };
  },
});
const shieldDown = shieldSays({ findings: [{ stage: "images", severity: "hold", code: "image_matching_failed", message: "Arachnid Shield didn't answer (503)." }] });

describe("PhotoDNA image matching", () => {
  it("hashes each picture once and sends the hashes 5 to a request", async () => {
    const s = service();
    const pictures = Array.from({ length: 7 }, (_, i) => media(`p${i}.png`));
    const result = await photoDna(s.photo).check([...pictures, media("again.png", "p0.png")]);
    expect(result).toEqual({ provider: "photodna", isConnected: true, checkedMediaCount: 8, uncheckedMediaCount: 0, findings: [] });
    expect(s.hashed).toHaveLength(7);
    expect(s.requests.map((r) => r.hashes.length)).toEqual([5, 2]);
    expect(s.requests[0]!.priority).toBe("upload");
  });

  it("flags every name of a picture that matches, with the list it matched", async () => {
    const s = service();
    const result = await photoDna(s.photo).check([media("ok.png"), media("x.png", "BAD"), media("copy/y.gif", "BAD", "image/gif")]);
    const known = result.findings.filter((f) => f.code === KNOWN_IMAGE_CODE);
    expect(known.map((f) => f.path)).toEqual(["x.png", "copy/y.gif"]);
    expect(known[0]!.message).toBe("PhotoDNA: matches known child sexual abuse material (list: Test).");
    expect(known[0]!.severity).toBe("hold");
  });

  it("leaves videos, and pictures it can't hash, to the other matcher without holding", async () => {
    const s = service();
    const result = await photoDna(s.photo, { priority: "recheck" }).check([media("intro.mp4", "v", "video/mp4"), media("dot.png", "TINY"), media("ok.png")]);
    expect(result).toMatchObject({ checkedMediaCount: 1, uncheckedMediaCount: 2, findings: [] });
    expect(s.hashed).toEqual(["TINY", "ok.png"]);
    expect(s.requests[0]!.priority).toBe("recheck");
  });

  it("says it didn't finish when the hasher or Microsoft is down", async () => {
    const hasherDown = service({ hash: () => ({ kind: "down", why: "no container" }) });
    const first = await photoDna(hasherDown.photo).check([media("a.png")]);
    expect(first.findings).toEqual([expect.objectContaining({ code: "image_matching_failed", severity: "hold" })]);
    expect(first.findings[0]!.path).toBeUndefined();
    expect(hasherDown.requests).toHaveLength(0);

    const microsoftDown = service({ match: () => ({ kind: "down", why: "429" }) });
    const second = await photoDna(microsoftDown.photo).check([media("a.png"), media("b.png")]);
    expect(second.findings[0]).toMatchObject({ code: "image_matching_failed" });
    expect(second.findings[0]!.message).toContain("429");
  });

  it("reads Microsoft's answer", () => {
    const answer = {
      MatchResults: [
        { Status: { Code: 3000 }, IsMatch: false },
        { Status: { Code: 3000 }, IsMatch: true, MatchDetails: { MatchFlags: [{ Source: "Test", Violations: ["A1"] }] } },
        { Status: { Code: 3208, Description: "Invalid hash" } },
      ],
    };
    expect(readMatchHashAnswer(answer, 3)).toEqual({
      kind: "results",
      results: [
        { isMatch: false, sources: [] },
        { isMatch: true, sources: ["Test"] },
        { isMatch: false, sources: [], failure: "status 3208: Invalid hash" },
      ],
    });
    expect(readMatchHashAnswer({ MatchResults: [] }, 1).kind).toBe("down");
    expect(readMatchHashAnswer(null, 1).kind).toBe("down");
  });
});

describe("two matchers together", () => {
  it("holds on a match from either one, and names both when both finished", async () => {
    const s = service();
    const result = await eitherMatcher([shieldSays({ checkedMediaCount: 2 }), photoDna(s.photo)]).check([media("a.png"), media("b.png", "BAD")]);
    expect(result.provider).toBe("arachnid-shield+photodna");
    expect(result.findings.filter((f) => f.code === KNOWN_IMAGE_CODE).map((f) => f.path)).toEqual(["b.png"]);
  });

  it("passes on Arachnid Shield when only PhotoDNA is down, and notes it for later", async () => {
    const down = service({ match: () => ({ kind: "down", why: "503" }) });
    const result = await eitherMatcher([shieldSays({ checkedMediaCount: 1 }), photoDna(down.photo)]).check([media("a.png")]);
    expect(result.provider).toBe("arachnid-shield");
    expect(result.findings.map((f) => [f.code, f.severity])).toEqual([["image_matching_later", "info"]]);
  });

  it("passes on PhotoDNA when Arachnid Shield is down only if PhotoDNA checked everything", async () => {
    const s = service();
    const pictures = await eitherMatcher([shieldDown, photoDna(s.photo)]).check([media("a.png")]);
    expect(pictures.provider).toBe("photodna");
    expect(pictures.findings.map((f) => f.code)).toEqual(["image_matching_later"]);

    const withVideo = await eitherMatcher([shieldDown, photoDna(s.photo)]).check([media("a.png"), media("intro.mp4", "v", "video/mp4")]);
    expect(withVideo.findings.map((f) => [f.code, f.severity])).toEqual([["image_matching_failed", "hold"]]);
  });

  it("waits for a person when both are down", async () => {
    const down = service({ hash: () => ({ kind: "down", why: "no container" }) });
    const result = await eitherMatcher([shieldDown, photoDna(down.photo)]).check([media("a.png")]);
    expect(result.findings.filter((f) => f.code === "image_matching_failed")).toHaveLength(2);
  });

  it("is just the one matcher when only one is connected", () => {
    expect(eitherMatcher([notConnected])).toBe(notConnected);
  });
});
