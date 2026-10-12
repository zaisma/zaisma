// A stand-in for the Claude API, for local previews only, so scans and report triage run without a
// real key or cost. It answers from keywords, nothing clever:
// - scans pass, unless a re-check after a report mentions a password or login (then it's phishing);
// - reports are sorted by what the player wrote: bugs go to the developer, claims about the game's
//   content get its files checked again, players get a person, and the rest is dismissed.
import http from "node:http";
import { fileURLToPath } from "node:url";

const KINDS = [
  { test: /freez|crash|stuck|won.?t load|black screen|lag|bug|broken/i, severity: "normal", category: "broken", recommendation: "bug", summary: (d) => `A bug: ${d}`, why: "It's a technical problem for the developer." },
  { test: /password|login|card|steam|wallet|download/i, severity: "urgent", category: "malware", recommendation: "recheck", summary: (d) => `Says the game asks for something it shouldn't: ${d}`, why: "If the game is phishing, its files will show it." },
  { test: /nud|naked|sex|porn/i, severity: "high", category: "sexual", recommendation: "recheck", summary: (d) => `Says the game shows sexual content: ${d}`, why: "Its files will show whether that's in the game." },
  { test: /slur|racis|nazi|hate/i, severity: "high", category: "hate", recommendation: "recheck", summary: (d) => `Says the game has hateful content: ${d}`, why: "Its files will show whether that's in the game." },
];

function sortReport(text) {
  const report = text.match(/<report[^>]*>([\s\S]*?)<\/report>/)?.[1] ?? "";
  const details = report.match(/Details: "([\s\S]*)"/)?.[1] ?? "";
  const player = report.match(/About a player: "([^"]*)"/)?.[1];
  const playerId = report.match(/temporary ID ([^,)]+)/)?.[1];
  const kindOf = (s) => KINDS.find((k) => k.test.test(s));
  const kind = kindOf(details);
  // The same problem: an earlier open report with the same kind of words.
  const same = [...text.matchAll(/^id ([a-z0-9]+), sent [^:]*: (.*)$/gm)].find(([, , line]) => (player ? line.includes(`player ${playerId}`) : kindOf(line) && kindOf(line) === kind));
  if (player) {
    const reason = report.match(/Reason picked: [^:]*: (.*)/)?.[1] ?? "Something else";
    const serious = !/Cheating|Something else/.test(reason);
    return { severity: serious ? "high" : "normal", category: "player", summary: `${player} reported for ${reason.toLowerCase()}${details ? `: ${details}` : "."}`, recommendation: "person", why: "Reports about players need a person.", same_as: same?.[1] ?? "" };
  }
  if (!kind) return { severity: "low", category: "other", summary: details ? `A player wrote: ${details}` : "No details given.", recommendation: "dismiss", why: "Nothing in it breaks the rules.", same_as: "" };
  return { severity: kind.severity, category: kind.category, summary: kind.summary(details), recommendation: kind.recommendation, why: kind.why, same_as: same?.[1] ?? "" };
}

function scan(text) {
  const reported = text.match(/a player reported it[^:]*: (.*)/)?.[1] ?? "";
  if (/password|login|steam|card/i.test(reported)) {
    return { verdict: "reject", summary: "A login form copied from a real store collects passwords and sends them away.", minors_sexualized: false, concerns: [{ category: "phishing_or_scam", detail: "Asks players for a store password.", path: "index.html" }] };
  }
  return { verdict: "pass", summary: "An ordinary game. (Preview stand-in AI.)", minors_sexualized: false, concerns: [] };
}

export function startFakeAi(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const request = JSON.parse(body || "{}");
        const text = (request.messages?.[0]?.content ?? []).map((b) => b.text ?? "").join("\n");
        const answer = String(request.system ?? "").startsWith("You sort reports") ? sortReport(text) : scan(text);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: `msg_preview_${Date.now()}`,
            type: "message",
            role: "assistant",
            model: request.model,
            content: [{ type: "text", text: JSON.stringify(answer) }],
            stop_reason: "end_turn",
            usage: { input_tokens: Math.round(body.length / 4), output_tokens: 80 },
          }),
        );
      });
    });
    server.on("error", reject);
    server.listen(port, () => resolve(server));
  });
}

// Run on its own (node fake-ai.mjs <port>): the preview's set-up blocks while it waits for scans, and they need this to answer.
if (process.argv[1] === fileURLToPath(import.meta.url)) await startFakeAi(Number(process.argv[2]));
