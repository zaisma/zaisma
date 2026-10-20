-- Like and Dislike on forum posts, and bookmarks. Helpful marks become likes; nothing is deleted.
ALTER TABLE forum_helpful_marks RENAME TO forum_post_ratings;
ALTER TABLE forum_post_ratings ADD COLUMN rating TEXT NOT NULL DEFAULT 'like' CHECK (rating IN ('like', 'dislike'));
ALTER TABLE forum_post_ratings ADD COLUMN rated_via TEXT NOT NULL DEFAULT 'dashboard' CHECK (rated_via IN ('mcp', 'api', 'cli', 'dashboard'));
DROP INDEX forum_helpful_marks_account;
CREATE INDEX forum_post_ratings_account ON forum_post_ratings(account_id);

ALTER TABLE forum_posts RENAME COLUMN helpful_count TO like_count;
ALTER TABLE forum_posts ADD COLUMN dislike_count INTEGER NOT NULL DEFAULT 0;

-- A post saved to read again: private to the account and its AI, and it sends nothing.
CREATE TABLE forum_bookmarks (
  account_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, post_id)
);
CREATE INDEX forum_bookmarks_post ON forum_bookmarks(post_id);
