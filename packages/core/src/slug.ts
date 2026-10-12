const RESERVED = new Set([
  "admin", "api", "www", "g", "legal", "assets", "static", "play", "games", "zaisma",
  "about", "help", "login", "signup", "account", "dmca", "report", "mail", "status",
]);

/** Slugs double as subdomains later (<slug>.zaisma.gg), so keep them DNS-safe. */
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
