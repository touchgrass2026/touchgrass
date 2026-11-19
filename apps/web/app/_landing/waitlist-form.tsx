'use client';

import type { SupportedLanguage, Translation } from '@touchgrass/shared';
import Link from 'next/link';
import { useActionState } from 'react';
import { joinWaitlistAction, type WaitlistField, type WaitlistState } from './actions';

const input = 'lp-input';
const label = 'lp-field';

/** Name, one "mobile number or email", city and consent (D-226); the server action routes the contact. */
export function WaitlistForm({
  t,
  errors,
  language,
  source = null,
  referral = null,
}: {
  t: Translation['landing']['waitlist'];
  errors: { RATE_LIMITED: string; INTERNAL: string };
  language: SupportedLanguage;
  /** The link's utm_source (D-191), e.g. instagram. */
  source?: string | null;
  /** A friend's referral code from the link (?ref=). */
  referral?: string | null;
}) {
  const [state, action, pending] = useActionState<WaitlistState, FormData>(joinWaitlistAction, {
    done: false,
    fields: [],
    error: null,
    values: { name: '', contact: '', city: 'Hyderabad', consent: false },
  });
  if (state.done)
    return (
      <p role="status" className="lp-done" data-testid="waitlist-done">
        {t.done}
      </p>
    );
  const invalid = (f: WaitlistField) => state.fields.includes(f);
  // The phone and email checks both belong to the one contact input.
  const contactErrors = (['contact', 'phone', 'email'] as const).filter(invalid);
  const errorId = (f: string) => `waitlist-${f}-error`;
  const describedBy = (ids: (string | null)[]) => ids.filter(Boolean).join(' ') || undefined;
  const fieldError = (f: WaitlistField) =>
    invalid(f) ? (
      <span id={errorId(f)} className="lp-error">
        {t.errors[f]}
      </span>
    ) : null;
  const [beforePrivacy = '', afterPrivacy = ''] = t.consent.split('{{privacy}}');
  return (
    <form action={action} className="lp-form" noValidate>
      <input type="hidden" name="language" value={language} />
      {source ? <input type="hidden" name="source" value={source} /> : null}
      {referral ? <input type="hidden" name="ref" value={referral} /> : null}
      {state.fields.length > 0 || state.error ? (
        <p role="alert" className="lp-error lp-form-wide">
          {state.error
            ? state.error === 'RATE_LIMITED'
              ? errors.RATE_LIMITED
              : errors.INTERNAL
            : state.fields.map((f) => t.errors[f]).join(' ')}
        </p>
      ) : null}
      <label htmlFor="waitlist-name" className={label}>
        {t.name}
        <input
          id="waitlist-name"
          name="name"
          required
          maxLength={60}
          autoComplete="name"
          defaultValue={state.values.name}
          aria-invalid={invalid('name') || undefined}
          aria-describedby={describedBy([invalid('name') ? errorId('name') : null])}
          className={input}
        />
        {fieldError('name')}
      </label>
      <label htmlFor="waitlist-city" className={label}>
        {t.city}
        <input
          id="waitlist-city"
          name="city"
          maxLength={60}
          autoComplete="address-level2"
          defaultValue={state.values.city}
          aria-invalid={invalid('city') || undefined}
          aria-describedby={describedBy([invalid('city') ? errorId('city') : null])}
          className={input}
        />
        {fieldError('city')}
      </label>
      <label htmlFor="waitlist-contact" className={`${label} lp-form-wide`}>
        {t.contact}
        <input
          id="waitlist-contact"
          name="contact"
          required
          maxLength={254}
          autoComplete="email"
          spellCheck={false}
          autoCapitalize="none"
          defaultValue={state.values.contact}
          aria-invalid={contactErrors.length > 0 || undefined}
          aria-describedby={describedBy([
            'waitlist-contact-hint',
            ...contactErrors.map((f) => errorId(f)),
          ])}
          className={input}
        />
        <span id="waitlist-contact-hint" className="lp-hint">
          {t.contactHint}
        </span>
        {contactErrors.map((f) => (
          <span key={f} id={errorId(f)} className="lp-error">
            {t.errors[f]}
          </span>
        ))}
      </label>
      <div className="lp-consent lp-form-wide">
        <input
          id="waitlist-consent"
          name="consent"
          type="checkbox"
          required
          defaultChecked={state.values.consent}
          aria-invalid={invalid('consent') || undefined}
          aria-describedby={describedBy([invalid('consent') ? errorId('consent') : null])}
          className="lp-checkbox"
        />
        <label htmlFor="waitlist-consent" className="lp-check">
          {beforePrivacy}
          <Link href="/privacy" className="lp-inline-link">
            {t.privacyLink}
          </Link>
          {afterPrivacy}
        </label>
        {fieldError('consent')}
      </div>
      <button type="submit" disabled={pending} className="lp-btn lp-form-wide">
        {t.submit}
      </button>
    </form>
  );
}
