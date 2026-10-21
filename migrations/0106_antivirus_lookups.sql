-- VirusTotal's answer about each file the scan looked up, so a rescan reuses it for a week (a day when VirusTotal
-- didn't know the file: malicious_engine_count is null) and stays inside its free limit. Nothing is deleted.
CREATE TABLE antivirus_lookups (sha256 TEXT PRIMARY KEY, malicious_engine_count INTEGER, looked_up_at_ms INTEGER NOT NULL);
CREATE INDEX antivirus_lookups_looked_up_at_ms ON antivirus_lookups (looked_up_at_ms);
