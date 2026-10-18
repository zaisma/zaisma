import type { FindingCode } from "../review.ts";
import type { Finding } from "../types.ts";
import type { EvidenceItem } from "../review-evidence.ts";

export interface TextFile {
  path: string;
  text: string;
}

interface Check {
  code: FindingCode;
  severity: Finding["severity"];
  message: string;
  pattern: RegExp;
  /** Only check files whose path matches. */
  only?: RegExp;
}

const HTML = /\.(html?|svg)$/i;

const CHECKS: Check[] = [
  {
    code: "crypto_miner",
    severity: "reject",
    message: "Contains crypto-mining code.",
    pattern: /coinhive|coin-hive|cryptonight|cryptoloot|webminepool|deepminer|coinimp|minero\.cc|stratum\+(tcp|ssl):\/\/|xmr-?stak|monero[-_ ]?miner|webmr\.js|crypta\.js/i,
  },
  {
    code: "packed_code",
    severity: "hold",
    message: "Code is packed or decoded at runtime (eval of encoded text), which hides what it does.",
    pattern: /eval\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,|\beval\(\s*(atob|unescape|decodeURIComponent|String\.fromCharCode)\s*\(|new\s+Function\(\s*atob\s*\(/,
  },
  {
    code: "top_navigation",
    severity: "hold",
    message: "Tries to change the page outside the game (top or parent window location).",
    pattern: /\b(window\.)?(top|parent)\.location(\.href)?\s*=(?!=)|\b(window\.)?(top|parent)\.location\.(replace|assign)\s*\(/,
  },
  {
    code: "relay_bypass",
    severity: "hold",
    message: "Makes a WebRTC connection from a frame of its own, which skips Zaisma's relay and would show players each other's internet address.",
    pattern:
      /(\bcontentWindow|\bdefaultView|\b(window|self|top|parent|globalThis|frames)\s*\[\s*\d+\s*\])\s*(\.\s*|\[\s*["'`])(webkit)?RTCPeerConnection|\bsrcdoc\b[\s\S]{0,2000}RTCPeerConnection|RTCPeerConnection[\s\S]{0,2000}\bsrcdoc\b/,
  },
  {
    code: "password_field",
    severity: "hold",
    message: "Has a password field. Games don't need one, and phishing pages do.",
    pattern: /<input[^>]*type\s*=\s*["']?password/i,
    only: HTML,
  },
  {
    code: "external_form",
    severity: "hold",
    message: "Has a form that sends data to another site.",
    pattern: /<form[^>]*action\s*=\s*["']?(https?:)?\/\//i,
    only: HTML,
  },
  {
    code: "wallet_words",
    severity: "info",
    message: "Mentions seed phrases, private keys or wallets. Worth a look for scams.",
    pattern: /seed phrase|recovery phrase|private key|metamask|walletconnect/i,
  },
  {
    code: "svg_script",
    severity: "info",
    message: "An SVG image contains script.",
    pattern: /<script/i,
    only: /\.svg$/i,
  },
];

// Hosts that appear in nearly every file and never load anything.
const IGNORED_HOSTS = new Set(["www.w3.org", "w3.org", "schemas.xmlsoap.org", "ns.adobe.com", "purl.org", "xmlns.com", "localhost", "127.0.0.1"]);
const URL_PATTERN = /(?:https?:|wss?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?=[/"'`?#\s)]|$)/gi;

const LINKS_OPEN_PATTERN = /Zaisma\.links\.open\(\s*["'`]([^"'`]{1,100})["'`]/g;
const WINDOW_OPEN_PATTERN = /\bwindow\.open\(\s*["'`]((?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)[^"'`]*)["'`]/gi;

export interface StaticResult {
  findings: Finding[];
  outsideHosts: string[];
  /** Evidence for the AI review (source "check"), in file order; file_sha256 is left "" for the scan to fill in. */
  evidence: EvidenceItem[];
}

export function staticScan(files: TextFile[]): StaticResult {
  const findings: Finding[] = [];
  const hosts = new Set<string>();
  const evidence: EvidenceItem[] = [];
  const checkItem = (kind: EvidenceItem["kind"], subject: string, detail: string, path: string, quote: string): EvidenceItem => ({ kind, subject, detail, path, quote: quote.slice(0, 300), file_sha256: "", source: "check" });
  for (const file of files) {
    for (const check of CHECKS) {
      if (check.only && !check.only.test(file.path)) continue;
      const match = check.pattern.exec(file.text);
      if (match) {
        findings.push({ stage: "static", severity: check.severity, code: check.code, message: check.message, path: file.path });
        if (check.code === "packed_code") evidence.push(checkItem("hidden_code", "eval_of_encoded", check.message, file.path, match[0]));
      }
    }
    const fileHosts = new Set<string>();
    for (const match of file.text.matchAll(URL_PATTERN)) {
      const host = match[1]!.toLowerCase();
      // Skip version-like numbers and file names that look like hosts ("three.min.js").
      if (/^[\d.]+$/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;
      if (/\.(js|mjs|css|png|jpg|json|html|wasm|map)$/i.test(host)) continue;
      if (IGNORED_HOSTS.has(host)) continue;
      hosts.add(host);
      if (fileHosts.has(host) || fileHosts.size >= 100) continue;
      fileHosts.add(host);
      evidence.push(checkItem("connects_to", host, `The file names the address ${host}.`, file.path, match[0]));
    }
    for (const match of file.text.matchAll(LINKS_OPEN_PATTERN)) evidence.push(checkItem("opens_link", match[1]!, `Opens the registered link "${match[1]}".`, file.path, match[0]));
    for (const match of file.text.matchAll(WINDOW_OPEN_PATTERN)) evidence.push(checkItem("opens_link", match[2]!.toLowerCase(), `Opens ${match[2]!.toLowerCase()} with window.open.`, file.path, match[0]));
  }
  const outsideHosts = [...hosts].sort().slice(0, 100);
  if (outsideHosts.length > 0) {
    findings.push({
      stage: "static",
      severity: "info",
      code: "outside_hosts",
      message: `References ${outsideHosts.length} outside site(s). Games can't load from them on Zaisma, so bundle any libraries into the zip.`,
    });
  }
  return { findings, outsideHosts, evidence };
}
