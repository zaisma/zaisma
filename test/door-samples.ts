/**
 * One path a route's regular expression matches: each optional part left out, each choice its first, each class its
 * first letter, as few as it takes. For the door tests, which call every row without writing every path out.
 */
export function sampleOf(regexSource: string): string {
  let source = regexSource.replace(/^\^/, "").replace(/\$$/, "").replace(/\\\//g, "/").replace(/\\\./g, ".");
  for (let previous = ""; previous !== source; ) {
    previous = source;
    source = source.replace(/\((?:\?:)?[^()]*\)\?/g, "");
    source = source.replace(/\((?:\?:)?([^()|]*)(?:\|[^()]*)?\)/g, "$1");
  }
  return source
    .replace(/\\d\{(\d+)\}/g, (_, count: string) => "1".repeat(Number(count)))
    .replace(/\[\^[^\]]*\](?:\{\d+,\d+\}|\+|\*)?/g, "a")
    .replace(/\[([^\]]*)\]\{(\d+)\}/g, (_, letters: string, count: string) => letters[0]!.repeat(Number(count)))
    .replace(/\[([^\]]*)\](?:\{\d+,\d+\}|\+|\*)?/g, (_, letters: string) => letters[0]!);
}

/** A path at a door: each :part as its shape says, and * as one more part. */
export const samplePathOf = (path: string, partPatterns: Readonly<Record<string, string>>): string =>
  path
    .split("/")
    .map((part) => (part === "*" ? "x" : part.startsWith(":") ? sampleOf(`(${partPatterns[part.slice(1)] ?? "[a-z]+"})`) : part))
    .join("/");
