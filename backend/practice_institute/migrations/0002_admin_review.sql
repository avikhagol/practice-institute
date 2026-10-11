ALTER TABLE sources ADD COLUMN consent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE questions ADD COLUMN key_verified INTEGER NOT NULL DEFAULT 0;
-- Existing manual reviewed keys were explicitly supplied by the owner in v1.
UPDATE questions SET key_verified=1 WHERE origin='manual' AND status='reviewed' AND answer_key IS NOT NULL;
