ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_closes_at_event_only;
ALTER TABLE conversations DROP COLUMN IF EXISTS closes_at;
