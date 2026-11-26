'use server';

import { guarded } from '../../../../lib/admin-action';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const Retry = z.object({ kind: z.enum(['refunds', 'payouts']), id: z.uuid() });

export async function retryAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const { kind, id } = Retry.parse(Object.fromEntries(form));
    await adminApi(
      `/v1/admin/${kind}/${id}/retry`,
      z.undefined(),
      { method: 'POST' },
      '/admin/payments',
    );
    revalidatePath('/admin/payments');
  });
}

const Note = z.string().trim().min(3).max(500);
const Release = z.object({ id: z.uuid(), note: Note });
const Adjust = z.object({ id: z.uuid(), note: Note, rupees: z.coerce.number().min(0) });
const Resolve = z.object({ id: z.uuid(), decision: z.enum(['refund', 'reject']), note: Note });

const post = async (path: string, body: unknown): Promise<void> => {
  await adminApi(
    path,
    z.undefined(),
    { method: 'POST', body: JSON.stringify(body) },
    '/admin/payments',
  );
  revalidatePath('/admin/payments');
};

/** Escrow review (D-229): the payout goes out (or waits for KYC). */
export async function releasePayoutAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const { id, note } = Release.parse(Object.fromEntries(form));
    await post(`/v1/admin/payouts/${id}/release`, { note });
  });
}

/** Escrow review (D-229): what the host is paid, up to the host share of every paid seat. */
export async function adjustPayoutAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const { id, note, rupees } = Adjust.parse(Object.fromEntries(form));
    await post(`/v1/admin/payouts/${id}/adjust`, { netPaise: Math.round(rupees * 100), note });
  });
}

/** Answers a buyer's dispute with the check-in evidence (D-229). */
export async function resolveDisputeAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const { id, decision, note } = Resolve.parse(Object.fromEntries(form));
    await post(`/v1/admin/payment-disputes/${id}/resolve`, { decision, note });
  });
}
