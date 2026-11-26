-- Check-in integrity (D-227).
--
-- 1. Hosts can keep the exact spot for people holding a seat on any plan; paid plans always do. Women-only,
--    men-only, invite-only and private plans start that way.
ALTER TABLE events ADD COLUMN spot_for_attendees boolean NOT NULL DEFAULT false;
UPDATE events SET spot_for_attendees = true
WHERE visibility IN ('women_only', 'men_only', 'invite_only', 'approval');

-- Plans that now hide their spot publish a fuzzed centre like mystery plans do (1–1.5 km from the spot, so the
-- 2 km area still contains it). New plans get the app's deterministic keyed offset; existing ones get a random
-- one, stored once, so repeated reads can never be averaged.
UPDATE events
SET approx_center = ST_Project(location, 1000 + random() * 500, radians(random() * 360))
WHERE NOT mystery
  AND visibility <> 'approval'
  AND (price_paise > 0 OR spot_for_attendees)
  AND ST_DWithin(approx_center, location, 1);

-- 2. Hosts can type a ticket's short code instead of scanning it.
ALTER TABLE rsvps DROP CONSTRAINT rsvps_check_in_method_check;
ALTER TABLE rsvps ADD CONSTRAINT rsvps_check_in_method_check
  CHECK (check_in_method IN ('qr', 'geofence', 'code'));

-- 3. Every check-in, by whom and from where (coarse), for the fake-headcount checks and the venue-staff audit
--    trail. Rows are personal data: exported with the account and erased with it.
CREATE TABLE check_in_log (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('qr', 'geofence', 'code')),
  actor text NOT NULL CHECK (actor IN ('self', 'host', 'venue_staff')),
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  venue_id uuid REFERENCES venues (id) ON DELETE SET NULL,
  -- Peppered hash of the attendee's app install (never the raw id).
  device_hash text,
  -- Rounded to about 110 m.
  coarse_location geography(Point, 4326),
  distance_m integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX check_in_log_event_idx ON check_in_log (event_id, created_at);
CREATE INDEX check_in_log_user_idx ON check_in_log (user_id);

-- 4. Plans flagged for admin review when the check-ins look staged.
CREATE TABLE event_check_in_flags (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('shared_device', 'far_from_spot')),
  count integer NOT NULL,
  flagged_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, kind)
);
CREATE INDEX event_check_in_flags_open_idx ON event_check_in_flags (event_id) WHERE reviewed_at IS NULL;
CREATE TRIGGER event_check_in_flags_updated_at BEFORE UPDATE ON event_check_in_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. A venue's door list: today's published plans there.
CREATE INDEX events_venue_upcoming_idx ON events (venue_id, starts_at) WHERE status = 'published';
