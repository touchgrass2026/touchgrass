DELETE FROM reliability_events WHERE kind = 'host_cancel';
ALTER TABLE reliability_events DROP CONSTRAINT reliability_events_kind_check;
ALTER TABLE reliability_events ADD CONSTRAINT reliability_events_kind_check
  CHECK (kind IN ('check_in', 'no_show', 'late_cancel'));

DROP TABLE IF EXISTS event_deposits;
DROP TABLE IF EXISTS payment_disputes;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_transfer_fk;
DROP TABLE IF EXISTS ticket_transfers;

DROP INDEX IF EXISTS payouts_held_idx;
ALTER TABLE payouts DROP COLUMN IF EXISTS reviewed_at;
ALTER TABLE payouts DROP COLUMN IF EXISTS adjustment_note;
ALTER TABLE payouts DROP COLUMN IF EXISTS adjusted_by_user_id;
ALTER TABLE payouts DROP COLUMN IF EXISTS max_net_paise;
ALTER TABLE payouts DROP COLUMN IF EXISTS withheld_paise;
ALTER TABLE payouts DROP COLUMN IF EXISTS checked_in_seats;
ALTER TABLE payouts DROP COLUMN IF EXISTS paid_seats;

DELETE FROM refunds WHERE reason IN ('RESOLD', 'TRANSFER_VOID', 'DEPOSIT_RETURNED', 'DISPUTE');
ALTER TABLE refunds DROP CONSTRAINT refunds_reason_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_check
  CHECK (reason IN ('HOST_CANCELLED', 'BEFORE_CUTOFF', 'HOLD_EXPIRED', 'DUPLICATE', 'ADMIN'));

DROP INDEX IF EXISTS payments_holder_idx;
DROP INDEX IF EXISTS payments_one_open;
UPDATE payments SET status = 'expired' WHERE status = 'created' AND kind <> 'seat';
CREATE UNIQUE INDEX payments_one_open ON payments (event_id, user_id) WHERE status = 'created';
ALTER TABLE payments DROP COLUMN IF EXISTS deposit_settled_at;
ALTER TABLE payments DROP COLUMN IF EXISTS deposit_outcome;
ALTER TABLE payments DROP COLUMN IF EXISTS transfer_id;
ALTER TABLE payments DROP COLUMN IF EXISTS claim_token_hash;
ALTER TABLE payments DROP COLUMN IF EXISTS holder_user_id;
ALTER TABLE payments DROP COLUMN IF EXISTS kind;
