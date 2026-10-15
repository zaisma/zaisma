/**
 * Times (docs/NAMING.md): stored as epoch milliseconds in <event>_at_ms, shown as ISO 8601 in UTC in
 * <event>_at. This is the only conversion between the two.
 */
export const iso = (atMs: number | null | undefined): string | null => (atMs ? new Date(atMs).toISOString() : null);
