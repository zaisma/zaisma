/**
 * Times (docs/NAMING.md): stored as epoch milliseconds in <event>_at_ms, shown as ISO 8601 in UTC in
 * <event>_at. This is the only conversion between the two.
 */
/** An ISO 8601 time with Z or an offset: the only form times come in (docs/NAMING.md). */
export const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const iso = (atMs: number | null | undefined): string | null => (atMs ? new Date(atMs).toISOString() : null);
