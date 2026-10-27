-- PhotoDNA matches still frames from videos now, not only pictures. Before, a scan named PhotoDNA as finished
-- while it had left every video to Arachnid Shield, so "photodna" comes off the provider of approved versions'
-- scan reports and of cleared files: the daily job (queueImageChecks) matches each of those versions again once,
-- and a video cleared without PhotoDNA isn't trusted from that check. "photodna" alone becomes "none". Every
-- approved version is matched again, since only a scan finds which ones hold videos. Safe to run twice; deletes nothing.

UPDATE versions
SET scan_report = json_set(
  scan_report,
  '$.images.provider',
  CASE json_extract(scan_report, '$.images.provider')
    WHEN 'photodna' THEN 'none'
    ELSE replace(replace(json_extract(scan_report, '$.images.provider'), '+photodna', ''), 'photodna+', '')
  END
)
WHERE scan_status = 'approved'
  AND scan_report IS NOT NULL
  AND json_valid(scan_report)
  AND instr(coalesce(json_extract(scan_report, '$.images.provider'), ''), 'photodna') > 0;

UPDATE checked_files
SET provider = CASE provider WHEN 'photodna' THEN 'none' ELSE replace(replace(provider, '+photodna', ''), 'photodna+', '') END
WHERE instr(coalesce(provider, ''), 'photodna') > 0;
