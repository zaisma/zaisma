-- Saves through the API (docs/DECISIONS.md, "Developers get their game's saves"): developers read and
-- change their game's saves by player ID. A save says who made its current version, so a developer's
-- change skips the "which progress?" question on the player's devices, and a developer's change right
-- after their own doesn't keep another copy.
ALTER TABLE saves ADD COLUMN changed_by_kind TEXT NOT NULL DEFAULT 'player';

-- The API shows a copy's reason as copy_reason (next_steps already have a reason), and columns take the API's names.
ALTER TABLE save_history RENAME COLUMN reason TO copy_reason;
