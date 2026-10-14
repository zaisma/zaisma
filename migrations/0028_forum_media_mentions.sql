-- Media and mentions in forum posts (docs/DECISIONS.md).

-- Up to four images a post (FEEDBACK_LIMITS.media), kept in the games bucket under
-- feedbackMediaKey. On a public topic they're checked with the post's words and others see them
-- once it passes; in a message to Zaisma only the developer and Zaisma do.
CREATE TABLE feedback_media (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  -- image/png, image/jpeg or image/webp.
  type TEXT NOT NULL,
  ord INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX feedback_media_post ON feedback_media(post_id, ord);

-- Who a post mentions (@Name), saved when it's posted so the right person hears even when two
-- share a name. account_id is 'zaisma' for @Zaisma.
CREATE TABLE feedback_mentions (
  post_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (post_id, account_id)
);
CREATE INDEX feedback_mentions_account ON feedback_mentions(account_id);
