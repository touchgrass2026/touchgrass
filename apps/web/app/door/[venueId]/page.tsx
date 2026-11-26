import { BRAND } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { resolveLanguage, strings } from '../../../lib/i18n';
import { fill, formatWhen } from '../../../lib/public-api';
import { doorSignOutAction } from './actions';
import { DoorCheckInForm, DoorSignInForm } from './door-forms';
import { doorList } from './door-session';

interface Props {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<{ lang?: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const metadata: Metadata = { title: `Door list · ${BRAND.name}`, robots: { index: false } };

/**
 * The venue door list (D-227): partner-venue staff sign in with the venue's staff PIN, see today's plans here
 * with each confirmed person's first name, photo and whether they're in, and check people in by scanning their
 * rotating QR (a handheld scanner types into the field) or typing the six-digit code under it.
 */
export default async function DoorPage({ params, searchParams }: Props) {
  const [{ venueId }, { lang }] = await Promise.all([params, searchParams]);
  if (!UUID.test(venueId)) notFound();
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const list = await doorList();
  return (
    <main lang={language} className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-8">
      <span className="text-xl font-extrabold tracking-tight text-primary">{BRAND.name}</span>
      {list === null ? (
        <section className="flex flex-col gap-4">
          <h1 className="text-3xl font-extrabold">{t.door.signInTitle}</h1>
          <p className="text-muted">{t.door.signInBody}</p>
          <DoorSignInForm venueId={venueId} t={t} />
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-extrabold">
              {t.door.title} · {list.venueName}
            </h1>
            <form action={doorSignOutAction}>
              <input type="hidden" name="venueId" value={venueId} />
              <button type="submit" className="min-h-11 font-semibold underline">
                {t.door.signOut}
              </button>
            </form>
          </div>
          <DoorCheckInForm venueId={venueId} t={t} />
          {list.plans.length === 0 ? (
            <p data-testid="door-empty">{t.door.empty}</p>
          ) : (
            list.plans.map((plan) => (
              <section
                key={plan.eventId}
                className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4"
                aria-labelledby={`plan-${plan.eventId}`}
                data-testid={`door-plan-${plan.eventId}`}
              >
                <h2 id={`plan-${plan.eventId}`} className="text-2xl font-bold">
                  {plan.title}
                </h2>
                <p className="text-muted">{formatWhen(plan.startsAt, language, plan.timezone)}</p>
                <ul className="flex flex-wrap gap-2 font-semibold" data-testid="door-counts">
                  <li className="rounded-full border-2 border-border px-3 py-1">
                    {fill(plan.paid ? t.door.paid : t.door.confirmed, { count: plan.confirmed })}
                  </li>
                  <li className="rounded-full border-2 border-border px-3 py-1">
                    {fill(t.door.checkedIn, { checked: plan.checkedIn, total: plan.confirmed })}
                  </li>
                </ul>
                {plan.checkInOpen ? null : <p className="text-muted">{t.door.notOpen}</p>}
                <ul className="flex flex-col divide-y-2 divide-border">
                  {plan.people.map((p) => (
                    <li
                      key={p.userId}
                      className="flex min-h-14 items-center gap-3 py-2"
                      data-testid={`door-person-${p.userId}`}
                    >
                      {p.photoUrl ? (
                        // Signed, expiring media URLs cannot go through the Next image optimiser's allow-list.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.photoUrl}
                          alt={fill(t.door.photoOf, { name: p.firstName })}
                          className="size-12 rounded-full object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex size-12 items-center justify-center rounded-full border-2 border-border text-xl font-bold"
                        >
                          {p.firstName.slice(0, 1)}
                        </span>
                      )}
                      <span className="flex-1 text-lg font-semibold">{p.firstName}</span>
                      <span
                        className={
                          p.checkedIn
                            ? 'rounded-full bg-primary px-3 py-1 font-bold text-on-primary'
                            : 'rounded-full border-2 border-border px-3 py-1'
                        }
                      >
                        {p.checkedIn ? t.door.in : t.door.notYet}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </main>
  );
}
