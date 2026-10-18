-- Lifelike gore plays only in games for 16 and up (docs/DECISIONS.md): the cartoon-violence precedent
-- says so, and lifelike gore in a game for everyone gets a precedent of its own. Only drafts Julius
-- hasn't approved or edited. Nothing is deleted.
UPDATE precedents SET why = 'Fine for everyone 13 and up. Only lifelike gore needs a game for 16 and up.', updated_at_ms = 1792357200000
  WHERE id = 'precedent_cartoon-violence' AND precedent_status = 'proposed' AND created_by = 'drafted by Claude';

INSERT OR IGNORE INTO precedents (id, title, applies_when, decision, why, can_ai_apply_alone, precedent_status, created_by, created_at_ms, updated_at_ms) VALUES
  ('precedent_lifelike-gore', 'Lifelike gore in a game for everyone', 'The report says the game shows photo-real or lifelike injury up close (dismemberment, torture, exposed organs), and the game is for everyone 13 and up.', 'recheck', 'Lifelike gore plays only in games for 16 and up, and the game''s files show whether it''s there.', 0, 'proposed', 'drafted by Claude', 1792357200000, 1792357200000);
