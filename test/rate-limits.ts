/**
 * Rate limits in tests. Miniflare's rate limit bindings count in windows that start on the clock's minute
 * (floor(Date.now() / period)), so a test's N + 1 calls straddle two windows now and then and the last one gets
 * through. A test that counts up to a limit gives the Worker this stand-in instead, which counts with no clock, and
 * pins the configured limit with configuredRateLimit.
 */

/** A rate limiter that allows allowedCount calls for each key and refuses the rest, with no clock. keys: every key it was asked about, in order. */
export function countingRateLimiter(allowedCount: number) {
  const callCounts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }: { key: string }): Promise<{ success: boolean }> {
      keys.push(key);
      const callCount = (callCounts.get(key) ?? 0) + 1;
      callCounts.set(key, callCount);
      return { success: callCount <= allowedCount };
    },
  };
}

/** A rate limit binding's settings in a Worker's wrangler.jsonc (imported with ?raw): how many calls in how many seconds. */
export function configuredRateLimit(wranglerText: string, bindingName: string): { limit: number; period: number } {
  const found = wranglerText.match(new RegExp(`"name":\\s*"${bindingName}"[^\\n]*"simple":\\s*\\{\\s*"limit":\\s*(\\d+),\\s*"period":\\s*(\\d+)`));
  if (!found) throw new Error(`No rate limit ${bindingName} in this wrangler.jsonc.`);
  return { limit: Number(found[1]), period: Number(found[2]) };
}
