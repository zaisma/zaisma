-- Reports to NCMEC's CyberTipline (apps/site/src/ncmec.ts): a known-image match sends one by itself,
-- a child-safety case a person confirms waits ready for a person's press. What was sent is kept a year after it's sent.
CREATE TABLE IF NOT EXISTS ncmec_reports (
  id TEXT PRIMARY KEY,
  report_source TEXT NOT NULL CHECK (report_source IN ('image_match', 'chat_review', 'player_report')),
  ncmec_report_status TEXT NOT NULL CHECK (ncmec_report_status IN ('ready', 'waiting', 'sent', 'stopped_by_brake', 'failed')),
  account_id TEXT,                    -- the reported account; NULL when nobody is known
  game_id TEXT,
  version_id TEXT,
  chat_review_id TEXT,
  report_group_id TEXT,
  details_json TEXT NOT NULL,         -- exactly what's sent: who, from where, when, and the kept files
  ncmec_report_number TEXT,           -- NCMEC's reportId once it's opened there
  send_attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at_ms INTEGER NOT NULL,
  sent_at_ms INTEGER,
  erase_at_ms INTEGER                 -- a year after it's sent; NULL until then
);
CREATE INDEX IF NOT EXISTS ncmec_reports_by_source ON ncmec_reports(report_source, created_at_ms);
CREATE INDEX IF NOT EXISTS ncmec_reports_by_status ON ncmec_reports(ncmec_report_status, created_at_ms);

-- An account with a reported match: no uploads, publishing, posting, chat or friend requests until a person clears it or bans it.
ALTER TABLE accounts ADD COLUMN safety_paused_at_ms INTEGER;
