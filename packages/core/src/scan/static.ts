import type { Finding } from "../types.ts";

export interface TextFile {
  path: string;
  text: string;
}

interface Rule {
  rule: string;
  severity: Finding["severity"];
  detail: string;
  pattern: RegExp;
  /** Only check files whose path matches. */
  only?: RegExp;
}

const HTML = /\.(html?|svg)$/i;

const RULES: Rule[] = [
  {
    rule: "crypto-miner",
    severity: "reject",
    detail: "Contains crypto-mining code.",
    pattern: /coinhive|coin-hive|cryptonight|cryptoloot|webminepool|deepminer|coinimp|minero\.cc|stratum\+(tcp|ssl):\/\/|xmr-?stak|monero[-_ ]?miner|webmr\.js|crypta\.js/i,
  },
  {
    rule: "packed-code",
    severity: "hold",
    detail: "Code is packed or decoded at runtime (eval of encoded text), which hides what it does.",
    pattern: /eval\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,|\beval\(\s*(atob|unescape|decodeURIComponent|String\.fromCharCode)\s*\(|new\s+Function\(\s*atob\s*\(/,
  },
  {
    rule: "top-navigation",
    severity: "hold",
    detail: "Tries to change the page outside the game (top or parent window location).",
    pattern: /\b(window\.)?(top|parent)\.location(\.href)?\s*=(?!=)|\b(window\.)?(top|parent)\.location\.(replace|assign)\s*\(/,
  },
  {
    rule: "password-field",
    severity: "hold",
    detail: "Has a password field. Games don't need one, and phishing pages do.",
    pattern: /<input[^>]*type\s*=\s*["']?password/i,
    only: HTML,
  },
  {
    rule: "external-form",
    severity: "hold",
    detail: "Has a form that sends data to another site.",
    pattern: /<form[^>]*action\s*=\s*["']?(https?:)?\/\//i,
    only: HTML,
  },
  {
    rule: "wallet-words",
    severity: "info",
    detail: "Mentions seed phrases, private keys or wallets. Worth a look for scams.",
    pattern: /seed phrase|recovery phrase|private key|metamask|walletconnect/i,
  },
  {
    rule: "svg-script",
    severity: "info",
    detail: "An SVG image contains script.",
    pattern: /<script/i,
    only: /\.svg$/i,
  },
];

// Hosts that appear in nearly every file and never load anything.
const IGNORED_HOSTS = new Set(["www.w3.org", "w3.org", "schemas.xmlsoap.org", "ns.adobe.com", "purl.org", "xmlns.com", "localhost", "127.0.0.1"]);
const URL_PATTERN = /(?:https?:|wss?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?=[/"'`?#\s)]|$)/gi;

export interface StaticResult {
  findings: Finding[];
  outsideHosts: string[];
}

export function staticScan(files: TextFile[]): StaticResult {
  const findings: Finding[] = [];
  const hosts = new Set<string>();
  for (const file of files) {
    for (const rule of RULES) {
      if (rule.only && !rule.only.test(file.path)) continue;
      if (rule.pattern.test(file.text)) {
        findings.push({ stage: "static", severity: rule.severity, rule: rule.rule, detail: rule.detail, path: file.path });
      }
    }
    for (const match of file.text.matchAll(URL_PATTERN)) {
      const host = match[1]!.toLowerCase();
      // Skip version-like numbers and file names that look like hosts ("three.min.js").
      if (/^[\d.]+$/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;
      if (/\.(js|mjs|css|png|jpg|json|html|wasm|map)$/i.test(host)) continue;
      if (!IGNORED_HOSTS.has(host)) hosts.add(host);
    }
  }
  const outsideHosts = [...hosts].sort().slice(0, 100);
  if (outsideHosts.length > 0) {
    findings.push({
      stage: "static",
      severity: "info",
      rule: "outside-hosts",
      detail: `References ${outsideHosts.length} outside site(s). Games can't load from them on Zaisma, so bundle any libraries into the zip.`,
    });
  }
  return { findings, outsideHosts };
}
