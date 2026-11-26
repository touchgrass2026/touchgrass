import { HOST_PAYMENT_STRIKES } from '@touchgrass/shared';
import { AppError } from '../../common/errors/app-error.js';

/** What a new confirmed payment strike does (D-228): a warning, or hosting removed at the threshold. */
export function strikeOutcome(
  strikes: number,
  revokeAt: number = HOST_PAYMENT_STRIKES.revokeAt,
): 'warn' | 'revoke' {
  return strikes >= revokeAt ? 'revoke' : 'warn';
}

/** Hosting removed for payment strikes blocks plotting new plans (crew sessions are the crew's, not theirs). */
export function assertMayHost(standing: { hostingRevokedAt: Date | null } | null): void {
  if (standing?.hostingRevokedAt)
    throw new AppError('HOSTING_REVOKED', 'Hosting is paused on this account', {
      reason: 'PAYMENT_STRIKES',
    });
}
