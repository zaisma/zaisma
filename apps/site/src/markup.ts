/*
 * The markup primitives every page and component builds with. They live apart from html.ts, which imports the components
 * that use them, so loading either first finds them ready.
 */

// Direction embeddings, overrides and isolates: text from anyone can't flip the page's words around it (docs/DECISIONS.md, "Stored values safe where they show").
const DIRECTION_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/g;

/** Escape text for HTML. Every value from a user or a game goes through this. */
export function esc(content: unknown): string {
  return String(content ?? "")
    .replace(DIRECTION_CONTROLS, "")
    .replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** A stored color as a page may use it in CSS: "#rrggbb" in lowercase, or null for anything else, which shows the default. */
export function shownColor(storedColor: unknown): string | null {
  return typeof storedColor === "string" && /^#[0-9a-fA-F]{6}$/.test(storedColor) ? storedColor.toLowerCase() : null;
}

/**
 * A stored address as a page may link to it: an absolute http: or https: address, or a path on this site
 * ("/…", never "//…"), in its standard form; null for anything else (a script or data address, another
 * scheme, nonsense), which the page then doesn't link.
 */
export function shownAddress(storedAddress: unknown): string | null {
  if (typeof storedAddress !== "string" || !storedAddress) return null;
  if (storedAddress.startsWith("/")) return storedAddress.startsWith("//") || /[\u0000-\u001f\\]/.test(storedAddress) ? null : storedAddress;
  if (!URL.canParse(storedAddress)) return null;
  const address = new URL(storedAddress);
  return address.protocol === "https:" || address.protocol === "http:" ? address.href : null;
}

/** Tagged template: interpolations are escaped unless wrapped in raw(). */
export class Raw {
  constructor(readonly html: string) {}
  toString() {
    return this.html;
  }
}
export const raw = (html: string) => new Raw(html);

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0]!;
  values.forEach((interpolation, i) => {
    out += render(interpolation) + strings[i + 1]!;
  });
  return new Raw(out);
}

function render(interpolation: unknown): string {
  if (interpolation instanceof Raw) return interpolation.html;
  if (Array.isArray(interpolation)) return interpolation.map(render).join("");
  if (interpolation === null || interpolation === undefined || interpolation === false) return "";
  return esc(interpolation);
}

function hue(name: string): number {
  let hueDeg = 7;
  for (const character of name) hueDeg = (hueDeg * 31 + character.codePointAt(0)!) % 360;
  return hueDeg;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [Array.from(words[0]!)[0], Array.from(words[1]!)[0]] : Array.from(words[0] ?? "?").slice(0, 2);
  return letters.join("").toUpperCase();
}

/** An account's picture: for now its initials on a plate in its own color, until profiles bring uploaded pictures. */
export function accountPicture(name: string, pictureSize: "xs" | "sm" | "md" = "md", options: { title?: string; mark?: Raw | string } = {}): Raw {
  return html`<span class="av ${pictureSize}" style="--h:${hue(name)}" title="${options.title ?? name}" aria-hidden="true">${initials(name)}${options.mark ?? ""}</span>`;
}
