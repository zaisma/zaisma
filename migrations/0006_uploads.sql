-- File-by-file uploads. Each file is stored once by its SHA-256 (R2: blobs/<sha256>) and shared
-- by every version that has it, so updates only upload what changed.
CREATE TABLE blobs (
  sha256 TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 'zip': files under r2_prefix (admin uploads). 'files': a manifest at manifests/<id>.json pointing at blobs.
ALTER TABLE versions ADD COLUMN kind TEXT NOT NULL DEFAULT 'zip' CHECK (kind IN ('zip', 'files'));
-- Patch notes, as the developer wrote them when uploading.
ALTER TABLE versions ADD COLUMN notes TEXT NOT NULL DEFAULT '';
-- Admin uploads go live when they pass review; developers' uploads wait as drafts unless they ask.
ALTER TABLE versions ADD COLUMN publish_when_approved INTEGER NOT NULL DEFAULT 1;
-- The secret in a draft's private preview link (<slug>--<token>.zaismausercontent.com), once it passes review.
ALTER TABLE versions ADD COLUMN preview_token TEXT;
ALTER TABLE versions ADD COLUMN published_at INTEGER;
CREATE UNIQUE INDEX versions_preview ON versions(preview_token);
