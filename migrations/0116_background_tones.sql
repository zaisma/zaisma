-- A background's tone: its average color and the glass Zaisma puts over it, measured once from the whole picture when it's added
-- (a background picture) or from its still when the check draws it (a shader). A page opens on the game's color with its glass
-- already right, before the background has loaded. NULL until measured, and for pictures that aren't backgrounds.
ALTER TABLE game_images ADD COLUMN average_color TEXT;
ALTER TABLE game_images ADD COLUMN is_glass_smoked INTEGER;
ALTER TABLE game_images ADD COLUMN glass_tint_pct INTEGER;
ALTER TABLE game_shaders ADD COLUMN average_color TEXT;
ALTER TABLE game_shaders ADD COLUMN is_glass_smoked INTEGER;
ALTER TABLE game_shaders ADD COLUMN glass_tint_pct INTEGER;
