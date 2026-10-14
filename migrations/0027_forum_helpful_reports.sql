-- Helpful and Report on forum posts (docs/DECISIONS.md). Helpful is one positive mark on a reply,
-- so the replies people found useful stand out to developers and their AI; there are no dislikes.
-- Report flags a post that slipped past the check: a person at Zaisma looks, and a post is hidden
-- straight away when it puts a young person at risk, or once three developers report it.
ALTER TABLE feedback_posts ADD COLUMN helpful INTEGER NOT NULL DEFAULT 0;

CREATE TABLE feedback_helpful (
  post_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, account_id)
);
CREATE INDEX feedback_helpful_account ON feedback_helpful(account_id);

CREATE TABLE forum_reports (
  post_id TEXT NOT NULL,
  -- Who reported it: never shown to anyone but Zaisma.
  account_id TEXT NOT NULL,
  -- personal_info, harassment, sexual, hate, scam, child_safety or other (FORUM_REPORT_REASONS).
  reason TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, account_id)
);
CREATE INDEX forum_reports_post ON forum_reports(post_id);
CREATE INDEX forum_reports_account ON forum_reports(account_id);
