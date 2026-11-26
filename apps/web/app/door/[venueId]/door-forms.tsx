'use client';

import type { Translation } from '@touchgrass/shared';
import { useActionState, useEffect, useRef } from 'react';
import {
  doorCheckInAction,
  type DoorCheckInState,
  doorSignInAction,
  type DoorSignInState,
} from './actions';

const inputClass =
  'min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-2xl tracking-widest text-text';
const buttonClass =
  'min-h-11 self-start rounded-full bg-primary px-6 font-bold text-on-primary disabled:opacity-50';

function messageFor(t: Translation, key: string | null): string | null {
  if (!key) return null;
  if (key === 'signedOut') return t.door.signedOut;
  const reasons = t.events.reasons as Record<string, string>;
  const errors = t.errors as Record<string, string>;
  return reasons[key] ?? errors[key] ?? errors.INTERNAL ?? null;
}

export function DoorSignInForm({ venueId, t }: { venueId: string; t: Translation }) {
  const [state, action, pending] = useActionState<DoorSignInState, FormData>(doorSignInAction, {
    error: null,
  });
  const message = messageFor(t, state.error);
  return (
    <form action={action} className="flex flex-col gap-3" aria-label={t.door.signInTitle}>
      <input type="hidden" name="venueId" value={venueId} />
      <label htmlFor="door-pin" className="flex flex-col gap-1 font-semibold">
        {t.door.pin}
        <input
          id="door-pin"
          name="pin"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{4,8}"
          required
          className={inputClass}
        />
      </label>
      {message ? (
        <p role="alert" className="font-semibold text-[var(--tg-danger)]" data-testid="door-error">
          {message}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={buttonClass} data-testid="door-sign-in">
        {t.door.signIn}
      </button>
    </form>
  );
}

export function DoorCheckInForm({ venueId, t }: { venueId: string; t: Translation }) {
  const [state, action, pending] = useActionState<DoorCheckInState, FormData>(doorCheckInAction, {
    done: null,
    error: null,
    attempt: 0,
  });
  const field = useRef<HTMLInputElement>(null);
  // Ready for the next person: clear the field and keep the focus there (handheld scanners type into it).
  useEffect(() => {
    if (state.attempt === 0 || !field.current) return;
    field.current.value = '';
    field.current.focus();
  }, [state.attempt]);
  const message = messageFor(t, state.error);
  const done = state.done
    ? (state.done.already ? t.door.already : t.door.done).replace('{{name}}', state.done.firstName)
    : null;
  return (
    <form action={action} className="flex flex-col gap-3" aria-label={t.door.ticket}>
      <input type="hidden" name="venueId" value={venueId} />
      <label htmlFor="door-ticket" className="flex flex-col gap-1 font-semibold">
        {t.door.ticket}
        <span className="text-base font-normal text-muted" id="door-ticket-hint">
          {t.door.ticketHint}
        </span>
        <input
          ref={field}
          id="door-ticket"
          name="ticket"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={6}
          aria-describedby="door-ticket-hint"
          className={inputClass}
          data-testid="door-ticket"
        />
      </label>
      <div aria-live="polite" className="min-h-8">
        {done ? (
          <p role="status" className="text-xl font-bold text-primary" data-testid="door-done">
            {done}
          </p>
        ) : message ? (
          <p
            role="alert"
            className="font-semibold text-[var(--tg-danger)]"
            data-testid="door-error"
          >
            {message}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className={buttonClass} data-testid="door-check-in">
        {t.door.checkIn}
      </button>
    </form>
  );
}
