-- The Brotli copy Zaisma makes of each stored game file, beside it at brotli/<storage key> (apps/site/src/compress.ts).
-- brotli_size_bytes is NULL when no copy is kept: the file didn't shrink enough, its fingerprint didn't match, or it couldn't be compressed.
CREATE TABLE compressed_blobs (
  storage_key TEXT PRIMARY KEY,
  brotli_size_bytes INTEGER,
  compressed_at_ms INTEGER NOT NULL
);
