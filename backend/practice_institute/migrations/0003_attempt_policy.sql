-- Preserve legacy alias uniqueness and existing answer foreign keys.
ALTER TABLE exams ADD COLUMN subset_count INTEGER;
ALTER TABLE exams ADD COLUMN subset_seed TEXT NOT NULL DEFAULT '';
ALTER TABLE attempts ADD COLUMN identity_key TEXT;
ALTER TABLE attempts ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 1;
UPDATE attempts SET identity_key=alias_key;
CREATE UNIQUE INDEX attempts_identity_number ON attempts(exam_id, identity_key, attempt_number);
