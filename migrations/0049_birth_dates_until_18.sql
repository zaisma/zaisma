-- Birth dates until 18 (docs/DECISIONS.md, "13+ at launch"): an account under 18 keeps its birth date
-- (YYYY-MM-DD), so it moves up a band on the birthday by itself and nobody is asked again. The date is
-- deleted on the 18th birthday, and anyone 18 or over when they join never has one. Accounts made
-- before this have none and stay in their band.
ALTER TABLE accounts ADD COLUMN birth_date TEXT;
