-- Interests in a member's own words when they are not in the list (D-200). They count toward the
-- interest limits; the API checks each one (2-30 characters, at most 5), the table keeps a backstop.
ALTER TABLE profiles
  ADD COLUMN custom_interests text[] NOT NULL DEFAULT '{}'
    CONSTRAINT profiles_custom_interests_bounds CHECK (
      cardinality(custom_interests) <= 5
      AND char_length(array_to_string(custom_interests, '')) <= 150
      AND array_position(custom_interests, NULL) IS NULL
    );
