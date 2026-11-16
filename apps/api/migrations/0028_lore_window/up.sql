-- Lore restructure (D-218). Hosts choose whether guests add photos (on by default); an album closes 7 days
-- after its plan ends, and the worker deletes its photos then. `purged_at` marks albums already emptied.
ALTER TABLE lore_albums ADD COLUMN guests_can_add boolean NOT NULL DEFAULT true;
ALTER TABLE lore_albums ADD COLUMN purged_at timestamptz;

-- Albums are created lazily; make sure every album with photos has a row, so the purge job finds it.
INSERT INTO lore_albums (event_id)
SELECT DISTINCT event_id FROM lore_items
ON CONFLICT (event_id) DO NOTHING;

-- The purge job walks albums not emptied yet.
CREATE INDEX lore_albums_unpurged_idx ON lore_albums (event_id) WHERE purged_at IS NULL;
