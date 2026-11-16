-- "Got home safe?" (D-212). A member's safety settings (only the got-home ask so far; no row means the
-- defaults), and one row per member and plan once they ask to be checked on, snooze, or say they got home.
CREATE TABLE safety_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  got_home_check boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE got_home_checks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  requested_at timestamptz,
  snoozes integer NOT NULL DEFAULT 0 CHECK (snoozes BETWEEN 0 AND 10),
  ask_after timestamptz,
  home_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);
-- The reminder job reads rows by plan; pruning goes by age.
CREATE INDEX got_home_checks_event_idx ON got_home_checks (event_id);
CREATE INDEX got_home_checks_updated_idx ON got_home_checks (updated_at);
-- Plans that ended in a window, whatever their status (the got-home job reads published and completed ones).
CREATE INDEX events_ends_at_idx ON events (ends_at);
