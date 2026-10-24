-- Cloud saves v1 (docs/DECISIONS.md, "The v1 contract is fixed before it's locked."): each save and save copy
-- records the game version that wrote it, a save's time is saved_at_ms like its copies', and copy reasons say
-- whose progress was set aside. Existing rows keep version_id null. Deletes nothing.
ALTER TABLE saves ADD COLUMN version_id TEXT;
ALTER TABLE save_history ADD COLUMN version_id TEXT;
ALTER TABLE saves RENAME COLUMN updated_at_ms TO saved_at_ms;
UPDATE save_history SET copy_reason = 'account_lost' WHERE copy_reason = 'replaced';
UPDATE save_history SET copy_reason = 'device_lost' WHERE copy_reason = 'device';
