'use client';

import type { Translation } from '@touchgrass/shared';
import { useActionState } from 'react';
import { checkInviteAction, type InviteCheckState } from './actions';
import { StoreLinks } from './store-links';

const input = 'lp-input lp-code';

export function InviteCheck({
  t,
  errors,
  playUrl,
  appStoreUrl,
}: {
  t: Translation['landing']['check'];
  errors: { RATE_LIMITED: string; INTERNAL: string };
  playUrl: string | null;
  appStoreUrl: string | null;
}) {
  const [state, action, pending] = useActionState<InviteCheckState, FormData>(checkInviteAction, {
    status: 'idle',
    code: null,
    inviterName: null,
    error: null,
  });
  return (
    <div className="lp-check-wrap">
      <form action={action} className="lp-inline-form">
        <label htmlFor="invite-code" className="lp-field">
          {t.label}
          <input
            id="invite-code"
            name="code"
            required
            minLength={4}
            maxLength={32}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={input}
          />
        </label>
        <button type="submit" disabled={pending} className="lp-btn">
          {t.submit}
        </button>
      </form>
      <div aria-live="polite" data-testid="invite-result">
        {state.status === 'valid' ? (
          <div className="lp-result">
            <p className="lp-result-title">{t.valid}</p>
            {state.inviterName ? <p>{t.validFrom.replace('{{name}}', state.inviterName)}</p> : null}
            <p className="lp-strong">{t.nextTitle}</p>
            <ol className="lp-steps">
              <li>{t.step1}</li>
              <li>{t.step2}</li>
              <li>{t.step3.replace('{{code}}', state.code ?? '')}</li>
            </ol>
            <StoreLinks playUrl={playUrl} appStoreUrl={appStoreUrl} />
          </div>
        ) : null}
        {state.status === 'invalid' ? <p className="lp-result">{t.invalid}</p> : null}
        {state.status === 'error' ? (
          <p role="alert" className="lp-error">
            {state.error === 'RATE_LIMITED' ? errors.RATE_LIMITED : errors.INTERNAL}
          </p>
        ) : null}
      </div>
    </div>
  );
}
