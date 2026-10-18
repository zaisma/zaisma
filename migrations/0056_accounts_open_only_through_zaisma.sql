-- Accounts open only through Zaisma (docs/DECISIONS.md): Zaisma's own email codes, and the marks that let a
-- device that signed in to an account before open it with its password, however many wrong passwords
-- other devices try.

-- An email code: one live code per address, kept only as hashes (the address's and the code's), good for
-- 10 minutes, and dead once 5 tries are spent. kind says what a right code does for account_id:
-- 'sign_in' opens the account, 'add_email' adds the address to it. Deleted with the account.
CREATE TABLE email_codes (
  email_sha256 TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  code_sha256 TEXT NOT NULL,
  try_count INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX email_codes_account ON email_codes(account_id);

-- Each time someone asked for a code to an address, sent or not: at most 3 an hour and 10 a day. An
-- address on no account gets nothing but counts the same, so the limits say nothing about who has one.
-- Kept a day.
CREATE TABLE email_code_requests (
  email_sha256 TEXT NOT NULL,
  requested_at_ms INTEGER NOT NULL
);
CREATE INDEX email_code_requests_email ON email_code_requests(email_sha256, requested_at_ms);

-- A device that signed in to an account: the hash of the device's own cookie, when it last signed in
-- there (the mark lasts a year after), and its wrong passwords for the account in a row (at 10 it loses
-- the mark). Deleted with the account.
CREATE TABLE device_marks (
  device_sha256 TEXT NOT NULL,
  account_id TEXT NOT NULL,
  signed_in_at_ms INTEGER NOT NULL,
  consecutive_wrong_password_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_sha256, account_id)
);
CREATE INDEX device_marks_account ON device_marks(account_id);

-- Wrong passwords for an account from devices without its mark. At 20 in a day, only marked devices,
-- passkeys and email codes open it until the day's count drops below 20. Kept a day.
CREATE TABLE wrong_passwords (
  account_id TEXT NOT NULL,
  tried_at_ms INTEGER NOT NULL
);
CREATE INDEX wrong_passwords_account ON wrong_passwords(account_id, tried_at_ms);

-- When someone tried enough wrong passwords to lock new devices out of the account, or to cost a device
-- its mark; cleared once the owner's account page has said so.
ALTER TABLE accounts ADD COLUMN wrong_password_notice_at_ms INTEGER;
