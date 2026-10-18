-- The last of Zaisma's own names (docs/NAMING.md): rooms, scans, reports and triage, accounts, saves and
-- plays. Columns take the API's names; a stored time is <event>_at_ms; a count ends in _count, a length
-- of time in its unit; a yes/no column reads like a boolean; a calendar day is a date; a file hash is
-- sha256. Stored JSON (scan reports, report triage) is snake_case all the way down, in the API's words.

-- Accounts, owners, API keys and passkeys.
ALTER TABLE accounts RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE accounts RENAME COLUMN updated_at TO updated_at_ms;
ALTER TABLE owners RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE api_keys RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE api_keys RENAME COLUMN last_used_at TO last_used_at_ms;
-- The key's COSE algorithm: -7 (ES256) or -257 (RS256).
ALTER TABLE passkeys RENAME COLUMN alg TO algorithm_number;
ALTER TABLE passkeys RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE passkeys RENAME COLUMN last_used_at TO last_used_at_ms;

-- Games a signed-in player played, for their home page.
ALTER TABLE played RENAME COLUMN at TO played_at_ms;

-- Cloud saves, and the earlier copies kept of them.
-- version_number goes up by one with every save, so two devices can't both replace the same one.
ALTER TABLE saves RENAME COLUMN version TO version_number;
ALTER TABLE saves RENAME COLUMN hash TO sha256;
ALTER TABLE saves RENAME COLUMN bytes TO size_bytes;
ALTER TABLE saves RENAME COLUMN updated_at TO updated_at_ms;
ALTER TABLE save_history RENAME COLUMN at TO saved_at_ms;
ALTER TABLE save_history RENAME COLUMN hash TO sha256;
ALTER TABLE save_history RENAME COLUMN bytes TO size_bytes;

-- Plays: the API's words. A started play is any press of Play; a play counts after a minute on screen.
ALTER TABLE play_days RENAME COLUMN day TO date;
ALTER TABLE play_days RENAME COLUMN plays TO started_play_count;
ALTER TABLE play_days RENAME COLUMN players TO started_player_count;
ALTER TABLE play_days RENAME COLUMN new_players TO started_new_player_count;
ALTER TABLE play_days RENAME COLUMN counted TO play_count;
ALTER TABLE play_days RENAME COLUMN counted_players TO player_count;
ALTER TABLE play_days RENAME COLUMN counted_new TO new_player_count;
ALTER TABLE play_days RENAME COLUMN counted_seconds TO play_duration_sec;
-- Never written: time on screen is only kept for counted plays (play_duration_sec).
ALTER TABLE play_days DROP COLUMN play_seconds;
-- asn: the network a counted player came from, as Cloudflare numbers it.
ALTER TABLE play_networks RENAME COLUMN day TO date;
ALTER TABLE play_networks RENAME COLUMN asn TO autonomous_system_number;
ALTER TABLE play_networks RENAME COLUMN players TO player_count;
ALTER TABLE play_returns RENAME COLUMN first_day TO first_play_date;
ALTER TABLE play_returns RENAME COLUMN after TO after_days;
ALTER TABLE play_returns RENAME COLUMN players TO player_count;
ALTER TABLE play_tickets RENAME COLUMN issued_at TO issued_at_ms;
ALTER TABLE play_tickets RENAME COLUMN day TO date;
ALTER TABLE play_tickets RENAME COLUMN player TO is_first_play_today;
ALTER TABLE play_tickets RENAME COLUMN new_player TO is_new_player;
ALTER TABLE play_tickets RENAME COLUMN first_day TO first_play_date;
ALTER TABLE play_tickets RENAME COLUMN seconds TO play_duration_sec;
ALTER TABLE play_tickets RENAME COLUMN counted_at TO counted_at_ms;

-- Rooms.
ALTER TABLE live_rooms RENAME COLUMN code TO room_code;
ALTER TABLE live_rooms RENAME COLUMN players TO player_count;
ALTER TABLE live_rooms RENAME COLUMN max_players TO maximum_player_count;
ALTER TABLE live_rooms RENAME COLUMN held TO held_seat_count;
ALTER TABLE live_rooms RENAME COLUMN listed TO is_listed;
ALTER TABLE live_rooms RENAME COLUMN open TO is_open;
ALTER TABLE live_rooms RENAME COLUMN name_hidden TO is_name_hidden;
ALTER TABLE live_rooms RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE live_rooms RENAME COLUMN updated_at TO updated_at_ms;
ALTER TABLE room_keys RENAME COLUMN issued_at TO issued_at_ms;
ALTER TABLE room_keys RENAME COLUMN passes TO pass_count;
ALTER TABLE room_usage RENAME COLUMN day TO date;
ALTER TABLE room_usage RENAME COLUMN rooms TO room_count;
ALTER TABLE room_usage RENAME COLUMN player_seconds TO room_play_duration_sec;
ALTER TABLE room_usage RENAME COLUMN messages TO message_count;
ALTER TABLE room_usage RENAME COLUMN server_calls TO game_server_call_count;
ALTER TABLE room_usage RENAME COLUMN server_crashes TO game_server_crash_count;
ALTER TABLE room_usage RENAME COLUMN server_stops TO game_server_stopped_count;
ALTER TABLE room_usage RENAME COLUMN server_broken_rooms TO game_server_ended_match_count;
ALTER TABLE game_server_errors RENAME COLUMN count TO occurrence_count;
ALTER TABLE game_server_errors RENAME COLUMN first_at TO first_at_ms;
ALTER TABLE game_server_errors RENAME COLUMN last_at TO last_at_ms;

-- Reports. severity_index is the place in SEVERITIES: 0 child safety, 1 urgent, 2 high, 3 normal, 4 low.
ALTER TABLE reports RENAME COLUMN status TO report_status;
ALTER TABLE reports RENAME COLUMN details TO player_text;
ALTER TABLE reports RENAME COLUMN created_at TO reported_at_ms;
ALTER TABLE reports RENAME COLUMN picture TO has_picture;
ALTER TABLE reports RENAME COLUMN closed_at TO closed_at_ms;
ALTER TABLE reports RENAME COLUMN severity TO severity_index;
ALTER TABLE reports RENAME COLUMN group_id TO report_group_id;
ALTER TABLE reports RENAME COLUMN triaged_at TO triaged_at_ms;
ALTER TABLE reports RENAME COLUMN triage_tries TO triage_attempt_count;
ALTER TABLE reports RENAME COLUMN bug TO is_bug_report;
ALTER TABLE reports RENAME COLUMN bug_at TO bug_report_at_ms;

-- What report triage found (reports.triage), in the admin MCP's words.
UPDATE reports SET triage = json_remove(json_set(triage, '$.is_by_ai', json(triage -> '$.ai')), '$.ai') WHERE json_type(triage, '$.ai') IS NOT NULL;
UPDATE reports SET triage = json_remove(json_set(triage, '$.ai_actions', json(triage -> '$.actions')), '$.actions') WHERE json_type(triage, '$.actions') IS NOT NULL;
UPDATE reports SET triage = json_remove(json_set(triage, '$.precedent_draft', json(triage -> '$.draft')), '$.draft') WHERE json_type(triage, '$.draft') IS NOT NULL;
UPDATE reports SET triage = json_remove(json_set(triage, '$.is_spot_check', json(triage -> '$.spot_check')), '$.spot_check') WHERE json_type(triage, '$.spot_check') IS NOT NULL;
UPDATE reports SET triage = json_remove(json_set(triage, '$.recheck.recheck_status', json(triage -> '$.recheck.status')), '$.recheck.status') WHERE json_type(triage, '$.recheck.status') IS NOT NULL;
UPDATE reports SET triage = json_remove(json_set(triage, '$.recheck.scan_status', json(triage -> '$.recheck.decision')), '$.recheck.decision') WHERE json_type(triage, '$.recheck.decision') IS NOT NULL;

-- AI use a month, in the admin MCP's words.
ALTER TABLE ai_usage RENAME COLUMN input_tokens TO input_token_count;
ALTER TABLE ai_usage RENAME COLUMN output_tokens TO output_token_count;
ALTER TABLE ai_usage RENAME COLUMN scans TO scan_call_count;
ALTER TABLE ai_usage RENAME COLUMN reports TO report_triage_call_count;
ALTER TABLE ai_usage RENAME COLUMN feedback TO forum_call_count;

-- A version's scan report (versions.scan_report): snake_case, like every stored JSON object.
UPDATE versions SET scan_report = json_remove(json_set(scan_report, '$.finished_at_ms', json(scan_report -> '$.finishedAt')), '$.finishedAt') WHERE json_type(scan_report, '$.finishedAt') IS NOT NULL;
UPDATE versions SET scan_report = json_remove(json_set(scan_report, '$.outside_hosts', json(scan_report -> '$.outsideHosts')), '$.outsideHosts') WHERE json_type(scan_report, '$.outsideHosts') IS NOT NULL;
UPDATE versions SET scan_report = json_remove(json_set(scan_report, '$.is_child_safety', json(scan_report -> '$.childSafety')), '$.childSafety') WHERE json_type(scan_report, '$.childSafety') IS NOT NULL;
UPDATE versions SET scan_report = json_remove(json_set(scan_report, '$.images.is_connected', json(scan_report -> '$.images.connected')), '$.images.connected') WHERE json_type(scan_report, '$.images.connected') IS NOT NULL;
UPDATE versions SET scan_report = json_remove(json_set(scan_report, '$.images.checked_media_count', json(scan_report -> '$.images.checked')), '$.images.checked') WHERE json_type(scan_report, '$.images.checked') IS NOT NULL;
UPDATE versions SET scan_report = json_remove(json_set(scan_report, '$.ai.input_token_count', json(scan_report -> '$.ai.inputTokens')), '$.ai.inputTokens') WHERE json_type(scan_report, '$.ai.inputTokens') IS NOT NULL;
UPDATE versions SET scan_report = json_remove(json_set(scan_report, '$.ai.output_token_count', json(scan_report -> '$.ai.outputTokens')), '$.ai.outputTokens') WHERE json_type(scan_report, '$.ai.outputTokens') IS NOT NULL;
