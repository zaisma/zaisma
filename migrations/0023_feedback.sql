-- Feedback from developers and their AI about Zaisma itself (docs/DECISIONS.md): bugs, gaps, feature
-- requests and questions. Each item is a thread of posts. Zaisma merges items about the same problem
-- into a known issue (the first item, with a title, workaround and roadmap item written by Zaisma),
-- which every developer and their AI can see. A developer's own items and posts stay private to
-- them and Zaisma.
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  -- Who filed it. NULL once their account is deleted (kept only when it's a known issue).
  account_id TEXT,
  -- bug, gap, feature or question.
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  -- The game it's about, if any (one of the developer's own).
  game_id TEXT,
  -- new (waiting for Zaisma), known, planned, fixed, wont or answered.
  status TEXT NOT NULL DEFAULT 'new',
  -- The known issue this item was merged into; NULL for an item on its own or a known issue itself.
  group_id TEXT,
  -- 1 urgent, 2 high, 3 normal, 4 low. Set by Zaisma, never by the filer.
  severity INTEGER NOT NULL DEFAULT 3,
  -- Where in Zaisma: publishing, scans, rooms, saves, accounts, mcp, dashboard, docs…
  area TEXT NOT NULL DEFAULT '',
  -- A known issue: the cleaned-up title every developer sees, what to do until it's fixed, and the
  -- roadmap item it belongs to. All NULL until Zaisma makes the item a known issue.
  known_title TEXT,
  workaround TEXT,
  roadmap TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- When Zaisma last replied or changed its status, and when the filer last read it: news is
  -- news_at > seen_at.
  news_at INTEGER,
  seen_at INTEGER
);
CREATE INDEX feedback_account ON feedback(account_id, updated_at);
CREATE INDEX feedback_group ON feedback(group_id);
CREATE INDEX feedback_open ON feedback(status, severity, created_at);

CREATE TABLE feedback_posts (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL,
  -- The developer who posted; NULL for Zaisma.
  account_id TEXT,
  -- Who wrote it: person (the developer), ai (their AI assistant) or zaisma.
  author TEXT NOT NULL,
  -- How it came in: mcp, api, cli, dashboard or admin.
  via TEXT NOT NULL,
  -- post, reopen or status (a change Zaisma made, in words).
  kind TEXT NOT NULL DEFAULT 'post',
  -- With secrets blanked before storing.
  text TEXT NOT NULL,
  -- What the AI attached (JSON): the tool or command, error code, version, what it sent.
  context TEXT,
  -- The screenshot's type when one was attached (feedbackPictureKey), else NULL.
  picture TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX feedback_posts_item ON feedback_posts(feedback_id, created_at);
-- The daily allowance counts an account's posts over the last day.
CREATE INDEX feedback_posts_account ON feedback_posts(account_id, created_at);
