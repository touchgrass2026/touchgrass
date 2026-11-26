-- Paid seats after the sale (D-229): escrow payouts from check-ins, ticket transfers, paid +1s, refundable
-- deposits on popular free plans, payment disputes, and the host reliability hit for cancelling a paid plan.

-- What a payment pays for, and who holds the seat it backs (the buyer, a friend who claimed a +1, or whoever a
-- ticket was transferred to). Refunds always go back to the buyer (`user_id`).
ALTER TABLE payments ADD COLUMN kind text NOT NULL DEFAULT 'seat'
  CHECK (kind IN ('seat', 'plus_one', 'resale', 'deposit'));
ALTER TABLE payments ADD COLUMN holder_user_id uuid REFERENCES users (id) ON DELETE SET NULL;
UPDATE payments SET holder_user_id = user_id;
-- A +1 seat's claim link (hashed); the token is shown once, and can be replaced by the buyer.
ALTER TABLE payments ADD COLUMN claim_token_hash text UNIQUE;
-- A resale payment buys the seat offered in this transfer.
ALTER TABLE payments ADD COLUMN transfer_id uuid;
-- Deposits: returned at check-in or on an early cancel, forfeited on a no-show or late cancel.
ALTER TABLE payments ADD COLUMN deposit_outcome text CHECK (deposit_outcome IN ('returned', 'forfeited'));
ALTER TABLE payments ADD COLUMN deposit_settled_at timestamptz;

-- One open checkout per person, plan and kind (a member can buy a +1 while their own seat is paid for).
DROP INDEX payments_one_open;
CREATE UNIQUE INDEX payments_one_open ON payments (event_id, user_id, kind) WHERE status = 'created';
CREATE INDEX payments_holder_idx ON payments (holder_user_id, event_id) WHERE holder_user_id IS NOT NULL;

ALTER TABLE refunds DROP CONSTRAINT refunds_reason_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_check CHECK (reason IN (
  'HOST_CANCELLED', 'BEFORE_CUTOFF', 'HOLD_EXPIRED', 'DUPLICATE', 'ADMIN',
  'RESOLD', 'TRANSFER_VOID', 'DEPOSIT_RETURNED', 'DISPUTE'));

-- Escrow: a payout is computed from checked-in paid seats; the rest is kept back unless an admin adjusts.
ALTER TABLE payouts ADD COLUMN paid_seats integer NOT NULL DEFAULT 0;
ALTER TABLE payouts ADD COLUMN checked_in_seats integer NOT NULL DEFAULT 0;
ALTER TABLE payouts ADD COLUMN withheld_paise integer NOT NULL DEFAULT 0 CHECK (withheld_paise >= 0);
ALTER TABLE payouts ADD COLUMN max_net_paise integer CHECK (max_net_paise IS NULL OR max_net_paise >= 0);
ALTER TABLE payouts ADD COLUMN adjusted_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE payouts ADD COLUMN adjustment_note text;
ALTER TABLE payouts ADD COLUMN reviewed_at timestamptz;
-- The admin review queue: held payouts, oldest first.
CREATE INDEX payouts_held_idx ON payouts (created_at, id) WHERE status = 'on_hold';

-- In-app ticket transfers between members. A resale is paid by the recipient; the seat moves on the verified
-- payment, under the event lock.
CREATE TABLE ticket_transfers (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments (id),
  from_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  price_paise integer NOT NULL CHECK (price_paise >= 0),
  original_paise integer NOT NULL CHECK (original_paise >= price_paise),
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  closes_at timestamptz NOT NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- At most one open offer per seat.
CREATE UNIQUE INDEX ticket_transfers_one_open ON ticket_transfers (payment_id) WHERE status = 'pending';
CREATE INDEX ticket_transfers_to_idx ON ticket_transfers (to_user_id, created_at DESC, id DESC);
CREATE INDEX ticket_transfers_from_idx ON ticket_transfers (from_user_id, created_at DESC, id DESC);
CREATE INDEX ticket_transfers_event_idx ON ticket_transfers (event_id) WHERE status = 'pending';
CREATE TRIGGER ticket_transfers_updated_at BEFORE UPDATE ON ticket_transfers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE payments ADD CONSTRAINT payments_transfer_fk FOREIGN KEY (transfer_id) REFERENCES ticket_transfers (id);

-- A buyer tells us something went wrong; admins answer with the check-in evidence.
CREATE TABLE payment_disputes (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  payment_id uuid NOT NULL REFERENCES payments (id),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('NOT_ADMITTED', 'PLAN_DID_NOT_HAPPEN', 'NOT_AS_DESCRIBED', 'CHARGED_TWICE', 'OTHER')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  status text NOT NULL CHECK (status IN ('open', 'refunded', 'rejected')),
  resolution_note text,
  resolved_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  refund_id uuid REFERENCES refunds (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_disputes_one_open ON payment_disputes (payment_id) WHERE status = 'open';
CREATE INDEX payment_disputes_event_open_idx ON payment_disputes (event_id) WHERE status = 'open';
CREATE INDEX payment_disputes_queue_idx ON payment_disputes (status, created_at, id);
CREATE TRIGGER payment_disputes_updated_at BEFORE UPDATE ON payment_disputes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refundable deposit a host asks for on a popular free plan (behind the `refundable_deposits` flag).
CREATE TABLE event_deposits (
  event_id uuid PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  amount_paise integer NOT NULL CHECK (amount_paise BETWEEN 2000 AND 50000),
  set_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER event_deposits_updated_at BEFORE UPDATE ON event_deposits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A host calling off a plan people paid for counts against their reliability (written by the reliability module).
ALTER TABLE reliability_events DROP CONSTRAINT reliability_events_kind_check;
ALTER TABLE reliability_events ADD CONSTRAINT reliability_events_kind_check
  CHECK (kind IN ('check_in', 'no_show', 'late_cancel', 'host_cancel'));
