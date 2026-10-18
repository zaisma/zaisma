-- Media and mentions in forum posts (docs/DECISIONS.md).

-- Up to ten images a post (FEEDBACK_LIMITS.media), kept in the games bucket under
-- feedbackMediaKey. An image is uploaded while the post is written (post_id NULL, only its
-- uploader sees it) and placed in the text; posting attaches it, and drafts never posted go after a
-- day. On a public topic they're checked with the post's words and others see them once it passes;
-- in a message to Zaisma only the developer and Zaisma do.
CREATE TABLE feedback_media (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  account_id TEXT,
  -- image/png, image/jpeg, image/webp or image/gif.
  type TEXT NOT NULL,
  ord INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  -- 1 once image matching (Arachnid Shield) found it clean. Others see an image only when it is.
  matched INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX feedback_media_unmatched ON feedback_media(matched, created_at);
CREATE INDEX feedback_media_post ON feedback_media(post_id, ord);
CREATE INDEX feedback_media_account ON feedback_media(account_id, created_at);

-- Who a post mentions (@Name), saved when it's posted so the right person hears even when two
-- share a name. account_id is 'zaisma' for @Zaisma.
CREATE TABLE feedback_mentions (
  post_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (post_id, account_id)
);
CREATE INDEX feedback_mentions_account ON feedback_mentions(account_id);
