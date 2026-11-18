'use client';

import type { SupportedLanguage, Translation } from '@touchgrass/shared';
import Link from 'next/link';
import { useActionState } from 'react';
import { joinWaitlistAction, type WaitlistField, type WaitlistState } from './actions';

const input = 'lp-input';
const label = 'lp-field';

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
    values: { name: '', phone: '', email: '', city: 'Hyderabad', note: '', consent: false },
  });
  if (state.done)
    return (
      <p role="status" className="lp-done" data-testid="waitlist-done">
        {t.done}
      </p>
    );
  const invalid = (f: WaitlistField) => state.fields.includes(f);
  const describedBy = (f: WaitlistField, hint?: string) =>
    [hint, invalid(f) ? `waitlist-${f}-error` : null].filter(Boolean).join(' ') || undefined;
  const fieldError = (f: WaitlistField) =>
    invalid(f) ? (
      <span id={`waitlist-${f}-error`} className="lp-error">
        {t.errors[f]}
      </span>
    ) : null;
  const contactInvalid = invalid('contact');
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
          aria-describedby={describedBy('name')}
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
          aria-describedby={describedBy('city')}
          className={input}
        />
        {fieldError('city')}
      </label>
      <fieldset
        className="lp-contact lp-form-wide"
        aria-describedby={describedBy('contact', 'waitlist-contact-hint')}
      >
        <legend className="lp-legend">{`${t.phone} / ${t.email}`}</legend>
        <p id="waitlist-contact-hint" className="lp-hint">
          {t.contactHint}
        </p>
        {fieldError('contact')}
        <div className="lp-pair">
          <label htmlFor="waitlist-phone" className={label}>
            {t.phone}
            <input
              id="waitlist-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              maxLength={20}
              autoComplete="tel-national"
              defaultValue={state.values.phone}
              aria-invalid={invalid('phone') || contactInvalid || undefined}
              aria-describedby={describedBy('phone')}
              className={input}
            />
            {fieldError('phone')}
          </label>
          <label htmlFor="waitlist-email" className={label}>
            {t.email}
            <input
              id="waitlist-email"
              name="email"
              type="email"
              maxLength={254}
              autoComplete="email"
              defaultValue={state.values.email}
              aria-invalid={invalid('email') || contactInvalid || undefined}
              aria-describedby={describedBy('email')}
              className={input}
            />
            {fieldError('email')}
          </label>
        </div>
      </fieldset>
      <label htmlFor="waitlist-note" className={`${label} lp-form-wide`}>
        {t.note}
        <textarea
          id="waitlist-note"
          name="note"
          maxLength={200}
          rows={3}
          defaultValue={state.values.note}
          aria-describedby="waitlist-note-hint"
          className={`${input} lp-textarea`}
        />
        <span id="waitlist-note-hint" className="lp-hint">
          {t.noteHint}
        </span>
      </label>
      <div className="lp-consent lp-form-wide">
        <label htmlFor="waitlist-consent" className="lp-check">
          <input
            id="waitlist-consent"
            name="consent"
            type="checkbox"
            required
            defaultChecked={state.values.consent}
            aria-invalid={invalid('consent') || undefined}
            aria-describedby={describedBy('consent')}
            className="lp-checkbox"
          />
          <span>{t.consent}</span>
        </label>
        {fieldError('consent')}
        <Link href="/privacy" className="lp-textlink">
          {t.privacy}
        </Link>
      </div>
      <button type="submit" disabled={pending} className="lp-btn lp-form-wide">
        {t.submit}
      </button>
    </form>
  );
}
