-- Until the beta, only accounts Julius adds can make, upload and publish games (docs/DECISIONS.md,
-- "Uploads are only for people Julius adds until the beta"). Set on /admin/publishing or by the admin MCP.
ALTER TABLE accounts ADD COLUMN can_publish INTEGER NOT NULL DEFAULT 0;

-- Accounts that already own a game keep making them.
UPDATE accounts SET can_publish = 1 WHERE id IN (SELECT account_id FROM owners WHERE id IN (SELECT owner_id FROM games));
