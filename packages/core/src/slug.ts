const RESERVED = new Set([
  "admin", "api", "www", "g", "legal", "assets", "static", "play", "games", "zaisma",
  "about", "help", "login", "signup", "account", "dmca", "report", "mail", "status",
  // Slugs are subdomains of the game domain, so keep names that could pass for official pages.
  "accounts", "auth", "id", "sso", "secure", "security", "support", "billing", "pay", "payments",
  "checkout", "store", "shop", "rooms", "cdn", "docs", "dev", "creators", "official", "staff",
  "mod", "mods", "moderator", "smtp", "ftp", "ns1", "ns2", "email",
  // Dashboard pages beside the games: /dashboard/feedback.
  "feedback",
]);

/** Slugs double as subdomains (<slug>.zaismausercontent.com), so keep them DNS-safe. */
export function checkSlug(slug: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) {
    return "Use 3–40 lowercase letters, numbers and hyphens, starting and ending with a letter or number.";
  }
  if (slug.includes("--")) return "No double hyphens.";
  if (RESERVED.has(slug)) return `"${slug}" is reserved.`;
  return null;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}
