-- Keys that turn off by themselves when found in public, end dates, and where each key was last used from.
-- Adds nullable columns only; every existing key keeps working and never ends.
ALTER TABLE api_keys ADD COLUMN ends_at_ms INTEGER;
ALTER TABLE api_keys ADD COLUMN turned_off_at_ms INTEGER;
ALTER TABLE api_keys ADD COLUMN found_in TEXT;
ALTER TABLE api_keys ADD COLUMN found_at_url TEXT;
ALTER TABLE api_keys ADD COLUMN last_used_device TEXT;
ALTER TABLE api_keys ADD COLUMN last_used_network_name TEXT;
ALTER TABLE api_keys ADD COLUMN last_used_city_name TEXT;
ALTER TABLE api_keys ADD COLUMN last_used_region_name TEXT;
ALTER TABLE api_keys ADD COLUMN last_used_country_code TEXT;
