DROP INDEX IF EXISTS referrals_rewarded_referrer_phone_idx;
ALTER TABLE referrals DROP COLUMN IF EXISTS referrer_phone_hash;
DROP TABLE IF EXISTS host_standing;
DROP INDEX IF EXISTS user_sanctions_code_idx;
ALTER TABLE user_sanctions DROP COLUMN IF EXISTS code;
