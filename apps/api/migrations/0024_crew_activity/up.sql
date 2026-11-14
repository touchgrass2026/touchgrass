-- A crew's activity in the founder's own words when it is not in the interest list (D-197).
ALTER TABLE crews
  ADD COLUMN activity text CHECK (activity IS NULL OR char_length(activity) BETWEEN 2 AND 40);
