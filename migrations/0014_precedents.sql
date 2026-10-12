-- Report precedents (docs/DECISIONS.md): short rulings a person made, which report triage follows.
-- A case that fits a precedent is decided the same way; one marked ai_alone (dismissals only) is
-- applied by the AI by itself. Changing a precedent makes a new one that replaces it, so every past
-- decision still points at the wording it followed.
CREATE TABLE precedents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- What the case looks like.
  applies_when TEXT NOT NULL,
  -- dismiss, bug, recheck or take_down.
  decision TEXT NOT NULL,
  why TEXT NOT NULL,
  -- 1: the AI may apply it by itself (dismissals only; bugs and re-checks are always automatic, takedowns never).
  ai_alone INTEGER NOT NULL DEFAULT 0,
  -- proposed (waiting for a person), active or retired.
  status TEXT NOT NULL DEFAULT 'proposed',
  -- The precedent this one changed, and the report group that set it.
  replaces TEXT,
  from_report TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX precedents_status ON precedents (status);

-- The precedent a report was decided by, or recommended under.
ALTER TABLE reports ADD COLUMN precedent_id TEXT;

-- A starting set drafted from the content rules, waiting for Julius to approve, change or drop.
INSERT INTO precedents (id, title, applies_when, decision, why, ai_alone, status, created_by, created_at, updated_at) VALUES
  ('hard-or-boring', 'Too hard, boring or not fun', 'The player doesn''t like the game (too hard, boring, unfair, ugly) but names nothing against the content rules.', 'dismiss', 'Not liking a game isn''t a rule break.', 1, 'proposed', 'drafted by Claude', 0, 0),
  ('broken', 'Crashes, freezes or won''t load', 'The game won''t load, crashes or freezes, or its controls, sound or saving don''t work.', 'bug', 'A problem for the developer to fix, not a rule break.', 0, 'proposed', 'drafted by Claude', 0, 0),
  ('cartoon-violence', 'Cartoon and fantasy violence', 'Fighting, shooting, monsters or cartoon blood, without realistic gore.', 'dismiss', 'Fine for players 13 and up. Only extreme, realistic gore needs a closer look.', 1, 'proposed', 'drafted by Claude', 0, 0),
  ('horror', 'Horror and scary themes', 'Jump scares, creepy places or dark stories, without extreme gore or sexual content.', 'dismiss', 'Fine for players 13 and up.', 1, 'proposed', 'drafted by Claude', 0, 0),
  ('mild-language', 'Mild language', 'Occasional swearing in the game that isn''t aimed at a real person or group.', 'dismiss', 'Mild language is fine for players 13 and up; hate and harassment aren''t.', 1, 'proposed', 'drafted by Claude', 0, 0),
  ('asks-for-login', 'Asks for a password, card or login', 'The game asks players for a password, a payment card, or their login for another site or store.', 'recheck', 'Phishing and scams aren''t allowed, and the game''s files show whether it does this.', 0, 'proposed', 'drafted by Claude', 0, 0),
  ('sexual-in-game', 'Nudity or sexual content in the game', 'The report says the game itself shows nudity or sexual content.', 'recheck', 'Sexually explicit content isn''t allowed, and the game''s files show whether it''s there.', 0, 'proposed', 'drafted by Claude', 0, 0),
  ('hate-in-game', 'Hate in the game itself', 'The report says the game''s own content attacks real people or groups.', 'recheck', 'Hate isn''t allowed, and the game''s files show whether it''s there.', 0, 'proposed', 'drafted by Claude', 0, 0),
  ('cheating', 'A player cheating', 'A player is reported for cheating, with no harassment or threats.', 'bug', 'There are no bans yet; the developer can fix what makes cheating possible.', 0, 'proposed', 'drafted by Claude', 0, 0),
  ('copyright-by-players', 'Copyright claims from players', 'A player says the game uses characters, art or music from someone else, and nothing else.', 'dismiss', 'Only the owner can claim copyright, through the DMCA page; the scan already holds well-known characters for a person.', 0, 'proposed', 'drafted by Claude', 0, 0);
