-- When an event chat closes for good (D-208): 48 h after the plan ends, or after it is cancelled if that is
-- sooner. The chat module keeps it on its own row (from the events module's service and domain events) so the
-- inbox can leave closed chats out in SQL, before paging. Null for direct and crew chats (they never close).
-- No index: the inbox reaches conversations by primary key from conversation_members (user_id, status).
ALTER TABLE conversations ADD COLUMN closes_at timestamptz;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_closes_at_event_only CHECK (closes_at IS NULL OR kind = 'event');

-- Existing event chats (one-off backfill from the plan's times).
UPDATE conversations c
SET closes_at = (
  CASE
    WHEN e.status = 'cancelled' AND e.cancelled_at IS NOT NULL THEN least(e.ends_at, e.cancelled_at)
    ELSE e.ends_at
  END
) + interval '48 hours'
FROM events e
WHERE c.kind = 'event' AND c.event_id = e.id;
