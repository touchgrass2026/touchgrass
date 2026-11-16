DROP INDEX IF EXISTS lore_albums_unpurged_idx;
ALTER TABLE lore_albums DROP COLUMN IF EXISTS purged_at;
ALTER TABLE lore_albums DROP COLUMN IF EXISTS guests_can_add;
