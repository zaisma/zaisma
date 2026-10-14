-- The developer forum (docs/DECISIONS.md). Feedback items become forum topics: ideas, questions and
-- discussions are public, bugs and gaps start private to the developer and Zaisma unless they post
-- them publicly. A known issue becomes a public topic of Zaisma's own, with the private reports
-- merged under it.

-- 1 when the topic is public: every developer and their AI can read it once its first post is checked.
ALTER TABLE feedback ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
-- 1 once a public topic's first post has passed the check, so others see it and it's listed.
ALTER TABLE feedback ADD COLUMN shown INTEGER NOT NULL DEFAULT 0;
-- "Me too" votes and replies others can see, kept here so lists can sort without counting.
ALTER TABLE feedback ADD COLUMN votes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedback ADD COLUMN replies INTEGER NOT NULL DEFAULT 0;
-- The post the asker or Zaisma marked as the answer.
ALTER TABLE feedback ADD COLUMN answer_post TEXT;
-- When something others can see last happened in it: lists sort by this.
ALTER TABLE feedback ADD COLUMN active_at INTEGER;
UPDATE feedback SET active_at = updated_at;

-- The post this one answers, when it replies to one post rather than the whole topic.
ALTER TABLE feedback_posts ADD COLUMN reply_to TEXT;
-- The check of a post on a public topic: pending, ok (others see it) or held (waits for a person).
-- NULL on a private topic, which only the developer and Zaisma see.
ALTER TABLE feedback_posts ADD COLUMN check_state TEXT;
ALTER TABLE feedback_posts ADD COLUMN check_tries INTEGER NOT NULL DEFAULT 0;
-- Why the check held it, for the person who decides.
ALTER TABLE feedback_posts ADD COLUMN check_reason TEXT;
CREATE INDEX feedback_posts_check ON feedback_posts(check_state, created_at);

CREATE INDEX feedback_shown ON feedback(shown, group_id, active_at);
CREATE INDEX feedback_shown_area ON feedback(shown, area, active_at);
CREATE INDEX feedback_shown_votes ON feedback(shown, votes);

-- Up to three tags from the fixed list (FORUM_TAGS in packages/core/src/feedback.ts).
CREATE TABLE feedback_tags (
  feedback_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (feedback_id, tag)
);
CREATE INDEX feedback_tags_tag ON feedback_tags(tag, feedback_id);

-- "Me too": this affects me too, or I want this too. On a known issue it counts toward the developers affected.
CREATE TABLE feedback_votes (
  feedback_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (feedback_id, account_id)
);
CREATE INDEX feedback_votes_account ON feedback_votes(account_id);

-- Topics an account follows (its own, ones it replied to or voted on, or chose to): news is a
-- topic's active_at after seen_at.
CREATE TABLE feedback_follows (
  feedback_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (feedback_id, account_id)
);
CREATE INDEX feedback_follows_account ON feedback_follows(account_id);
INSERT OR IGNORE INTO feedback_follows (feedback_id, account_id, seen_at)
  SELECT id, account_id, COALESCE(seen_at, created_at) FROM feedback WHERE account_id IS NOT NULL;

-- Each known issue so far becomes a public topic of Zaisma's own ('k' and the first item's id), and
-- the first item, with everything merged into it, moves under that topic as a private report.
INSERT INTO feedback (id, account_id, kind, title, status, severity, area, known_title, workaround, roadmap, created_at, updated_at, triaged_at, public, shown, active_at)
  SELECT 'k' || id, NULL, kind, known_title, status, severity, area, known_title, workaround, roadmap, created_at, updated_at, updated_at, 1, 1, updated_at
  FROM feedback WHERE known_title IS NOT NULL AND group_id IS NULL AND public = 0;
UPDATE feedback SET group_id = 'k' || group_id
  WHERE public = 0 AND group_id IN (SELECT id FROM feedback WHERE known_title IS NOT NULL AND public = 0);
UPDATE feedback SET group_id = 'k' || id, known_title = NULL, workaround = NULL, roadmap = NULL
  WHERE known_title IS NOT NULL AND public = 0;
