import {
  AdminDisputeList,
  AdminHeldPayoutList,
  type AdminDispute,
  type AdminHeldPayout,
  formatPaise,
  resources,
} from '@touchgrass/shared';
import { canOpen } from '../../../../lib/admin-nav';
import { adminApi } from '../../../../lib/admin-session';
import { inputClass, labelClass, primaryButton, secondaryButton } from '../../../../lib/admin-ui';
import { adjustPayoutAction, releasePayoutAction, resolveDisputeAction } from './actions';

const r = resources.en.tickets.admin;
const tk = resources.en.tickets;
const fmt = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});
const money = (n: number): string => formatPaise(n, 'en');
const holdLabel = (reason: string | null): string =>
  (reason ? (r.holdReasons as Record<string, string>)[reason] : null) ?? reason ?? '';

function NoteField({ id, prefix }: { id: string; prefix: string }) {
  return (
    <label className={labelClass} htmlFor={`${prefix}-note-${id}`}>
      {r.note}
      <input
        id={`${prefix}-note-${id}`}
        name="note"
        required
        minLength={3}
        maxLength={500}
        className={inputClass}
      />
    </label>
  );
}

function HeldPayout({ p, canAct }: { p: AdminHeldPayout; canAct: boolean }) {
  return (
    <li className="admin-card flex flex-col gap-2" data-testid={`held-${p.eventTitle}`}>
      <h3 className="text-xl font-bold">{p.eventTitle}</h3>
      <p>
        {p.host.displayName} · {money(p.netPaise)}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">{r.holdReason}</dt>
          <dd data-testid="hold-reason">{holdLabel(p.holdReason)}</dd>
        </div>
        <div>
          <dt className="text-muted">{r.seats}</dt>
          <dd>
            {r.seatsValue
              .replace('{{checkedIn}}', String(p.checkedInSeats))
              .replace('{{paid}}', String(p.paidSeats))}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{r.withheld}</dt>
          <dd>{money(p.withheldPaise)}</dd>
        </div>
        <div>
          <dt className="text-muted">{r.maxNet}</dt>
          <dd>{money(p.maxNetPaise)}</dd>
        </div>
      </dl>
      {p.openDisputes > 0 ? (
        <p>{r.openDisputes.replace('{{count}}', String(p.openDisputes))}</p>
      ) : null}
      {p.flags.length > 0 ? (
        <>
          <h4 className="font-semibold">{r.flags}</h4>
          <ul className="list-disc pl-6">
            {p.flags.map((f) => (
              <li key={f.id}>
                {f.reason} · {fmt.format(new Date(f.raisedAt))}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {p.adjustmentNote ? <p>{r.adjusted.replace('{{note}}', p.adjustmentNote)}</p> : null}
      {canAct && p.holdReason !== 'KYC_REQUIRED' ? (
        <div className="flex flex-wrap gap-4">
          <form
            action={releasePayoutAction}
            aria-label={r.releaseFor.replace('{{title}}', p.eventTitle)}
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="id" value={p.id} />
            <NoteField id={p.id} prefix="release" />
            <button type="submit" className={primaryButton}>
              {r.release}
            </button>
          </form>
          <form
            action={adjustPayoutAction}
            aria-label={r.adjustFor.replace('{{title}}', p.eventTitle)}
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="id" value={p.id} />
            <label className={labelClass} htmlFor={`adjust-net-${p.id}`}>
              {r.newNet}
              <input
                id={`adjust-net-${p.id}`}
                name="rupees"
                type="number"
                min={0}
                max={p.maxNetPaise / 100}
                step="0.01"
                defaultValue={p.netPaise / 100}
                required
                className={inputClass}
              />
            </label>
            <NoteField id={p.id} prefix="adjust" />
            <button type="submit" className={secondaryButton}>
              {r.adjust}
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );
}

function Dispute({ d, canAct }: { d: AdminDispute; canAct: boolean }) {
  const e = d.evidence;
  return (
    <li className="admin-card flex flex-col gap-2" data-testid={`dispute-${d.eventTitle}`}>
      <h3 className="text-xl font-bold">
        {d.eventTitle} · {d.buyer.displayName}
      </h3>
      <p>
        {r.reason}: {(tk.disputeReasons as Record<string, string>)[d.reason] ?? d.reason}
        {d.note ? ` · “${d.note}”` : ''}
      </p>
      <p>{money(d.amountPaise)}</p>
      <h4 className="font-semibold">{r.evidence}</h4>
      <p data-testid="dispute-evidence">
        {e.checkedInAt
          ? r.checkedInAt
              .replace('{{time}}', fmt.format(new Date(e.checkedInAt)))
              .replace('{{method}}', (e.method ?? '').toUpperCase())
          : r.notCheckedIn}
      </p>
      <p className="text-sm text-muted">
        {r.planTimes
          .replace('{{start}}', fmt.format(new Date(e.eventStartsAt)))
          .replace('{{end}}', fmt.format(new Date(e.eventEndsAt)))
          .replace('{{opened}}', fmt.format(new Date(e.checkInOpenedAt)))}
      </p>
      {!d.refundAllowed ? <p>{r.refundBlocked}</p> : null}
      {canAct ? (
        <form
          action={resolveDisputeAction}
          aria-label={r.rejectFor.replace('{{name}}', d.buyer.displayName)}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="id" value={d.id} />
          <NoteField id={d.id} prefix="dispute" />
          <div className="flex flex-wrap gap-2">
            {d.refundAllowed ? (
              <button type="submit" name="decision" value="refund" className={primaryButton}>
                {r.refund}
              </button>
            ) : null}
            <button type="submit" name="decision" value="reject" className={secondaryButton}>
              {r.reject}
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** Escrow review (D-229): held payouts with their evidence, and disputes answered with check-in times. */
export async function PayoutReview() {
  const [held, disputes, canAct] = await Promise.all([
    adminApi('/v1/admin/payouts/held', AdminHeldPayoutList, {}, '/admin/payments'),
    adminApi('/v1/admin/payment-disputes', AdminDisputeList, {}, '/admin/payments'),
    canOpen('payoutReview'),
  ]);
  return (
    <>
      <h2 className="text-2xl font-bold">{r.disputes}</h2>
      {disputes.items.length === 0 ? (
        <p>{r.disputesEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {disputes.items.map((d) => (
            <Dispute key={d.id} d={d} canAct={canAct} />
          ))}
        </ul>
      )}
      <h2 className="text-2xl font-bold">{r.heldPayouts}</h2>
      {held.items.length === 0 ? (
        <p>{r.heldEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {held.items.map((p) => (
            <HeldPayout key={p.id} p={p} canAct={canAct} />
          ))}
        </ul>
      )}
    </>
  );
}
