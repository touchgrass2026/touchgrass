DROP INDEX IF EXISTS events_venue_upcoming_idx;
DROP TABLE IF EXISTS event_check_in_flags;
DROP TABLE IF EXISTS check_in_log;
UPDATE rsvps SET check_in_method = 'qr' WHERE check_in_method = 'code';
ALTER TABLE rsvps DROP CONSTRAINT rsvps_check_in_method_check;
ALTER TABLE rsvps ADD CONSTRAINT rsvps_check_in_method_check
  CHECK (check_in_method IN ('qr', 'geofence'));
-- Fuzzed centres stay fuzzed: rolling back must never put an exact spot back into public reads.
ALTER TABLE events DROP COLUMN IF EXISTS spot_for_attendees;
