-- Security alerts: the owner hears about the risky moments (security-alerts.ts).

-- An event that was a security alert: emailed, or waiting on the account page and dashboard (unseen) until That was me (seen). NULL when it wasn't one.
ALTER TABLE security_events ADD COLUMN security_alert_status TEXT CHECK (security_alert_status IN ('emailed', 'unseen', 'seen'));
CREATE INDEX security_events_by_alert ON security_events (account_id, security_alert_status) WHERE security_alert_status IS NOT NULL;

-- When an account without an email pressed Skip on "Where should we tell you if someone else uses your account?".
ALTER TABLE accounts ADD COLUMN email_ask_skipped_at_ms INTEGER;

-- The networks an account signed in from, as fingerprints of the account and the network's number, so a new device
-- on a network it uses (a school's laptop cart) isn't an alert. Kept 90 days after the last sign-in there.
CREATE TABLE sign_in_networks (
  account_id TEXT NOT NULL,
  network_sha256 TEXT NOT NULL,
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, network_sha256)
);
CREATE INDEX sign_in_networks_by_last_seen ON sign_in_networks (last_seen_at_ms);

-- Counts across Zaisma per clock hour, from one network or (network_number 0) everywhere; Julius hears when one reaches
-- its threshold. No account and no address, kept 30 days.
CREATE TABLE security_spikes (
  spike_kind TEXT NOT NULL,
  network_number INTEGER NOT NULL,
  hour_number INTEGER NOT NULL,
  network_name TEXT,
  occurrence_count INTEGER NOT NULL,
  first_happened_at_ms INTEGER NOT NULL,
  last_happened_at_ms INTEGER NOT NULL,
  alerted_at_ms INTEGER,
  PRIMARY KEY (spike_kind, network_number, hour_number)
);
CREATE INDEX security_spikes_by_time ON security_spikes (last_happened_at_ms);

-- zaisma.com's script policy violation reports, folded per directive, blocked source, page and hour. Kept 30 days.
CREATE TABLE blocked_scripts (
  violated_directive TEXT NOT NULL,
  blocked_source TEXT NOT NULL,
  page_path TEXT NOT NULL,
  hour_number INTEGER NOT NULL,
  occurrence_count INTEGER NOT NULL,
  first_reported_at_ms INTEGER NOT NULL,
  last_reported_at_ms INTEGER NOT NULL,
  PRIMARY KEY (violated_directive, blocked_source, page_path, hour_number)
);
CREATE INDEX blocked_scripts_by_time ON blocked_scripts (last_reported_at_ms);
