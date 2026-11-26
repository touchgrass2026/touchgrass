-- Keeping money on TouchGrass (D-228).

-- Strikes reuse the sanctions model: a confirmed "asked to pay" report records a warning with a code, and the
-- hosting module counts them. Existing sanctions keep a NULL code.
ALTER TABLE user_sanctions ADD COLUMN code text CHECK (code IN ('off_platform_payment'));
CREATE INDEX user_sanctions_code_idx ON user_sanctions (user_id, code, created_at) WHERE code IS NOT NULL;

-- Per-host standing: the one-time "No payments outside TouchGrass" acknowledgement, and hosting removed after
-- repeated strikes (an admin can give it back).
CREATE TABLE host_standing (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  rules_acknowledged_at timestamptz,
  hosting_revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER host_standing_updated_at BEFORE UPDATE ON host_standing FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Referral limits follow the referrer's phone, so deleting and re-creating an account does not reset them.
-- Backfilled for live referrers; rewards already granted are untouched.
ALTER TABLE referrals ADD COLUMN referrer_phone_hash text;
UPDATE referrals r SET referrer_phone_hash = u.phone_hash
FROM users u
WHERE u.id = r.referrer_id AND u.phone_hash IS NOT NULL;
CREATE INDEX referrals_rewarded_referrer_phone_idx ON referrals (referrer_phone_hash) WHERE status = 'rewarded';
