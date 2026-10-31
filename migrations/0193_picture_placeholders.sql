-- Every picture a page shows starts as a tiny blurred copy of itself, sent inside the page (placeholders.ts): a 24px-wide WebP
-- as a data: URL, made with Cloudflare Images when the picture is approved (a shader's from its still, when its check draws it).
-- NULL until made; the daily job makes the ones approved before this column existed.
ALTER TABLE game_images ADD COLUMN placeholder_data_url TEXT;
ALTER TABLE game_shaders ADD COLUMN placeholder_data_url TEXT;
