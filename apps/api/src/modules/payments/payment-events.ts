/**
 * Payments domain events other modules subscribe to, in a file with no imports so a subscriber never pulls in
 * the payments module (D-229).
 */

/** A host called off a plan people paid for; the reliability module records it against them. */
export const HOST_CANCELLED_PAID_EVENT = 'payments.host_cancelled_paid';
