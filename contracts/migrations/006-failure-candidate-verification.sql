-- AEL3 schema migration 5 -> 6: bind FailureCandidate to verification evidence.
-- A failure without verification may remain a review candidate, but cannot enter
-- the active Failure Guard through the promotion command.

ALTER TABLE failure_candidates
    ADD COLUMN verification_json TEXT NOT NULL DEFAULT '[]';

UPDATE schema_meta SET value='6' WHERE key='version';
