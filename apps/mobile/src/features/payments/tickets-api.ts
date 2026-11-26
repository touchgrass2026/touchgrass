import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AcceptTransferResult,
  CheckoutResult,
  PaymentDispute,
  PaymentDisputeState,
  type CreateDisputeBody,
  PlusOneCheckout,
  PlusOneLink,
  PlusOneTicket,
  TicketTransfer,
  TicketTransferList,
} from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';
import { EVENT_KEYS } from '../events/api';
import { PAY_KEYS } from './api';

const Empty = z.undefined();
const idem = (prefix: string): string => `${prefix}-${Crypto.randomUUID()}`;

/** Paid seats after the sale (D-229): transfers, paid +1s, deposits and disputes. */
export const TICKET_KEYS = {
  transfers: ['ticket-transfers'] as const,
  transfer: (id: string) => ['ticket-transfers', id] as const,
  plusOne: (eventId: string) => ['payments', 'plus-one', eventId] as const,
  dispute: (paymentId: string) => ['payments', 'dispute', paymentId] as const,
};

function useRefresh() {
  const qc = useQueryClient();
  return async (): Promise<void> => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: TICKET_KEYS.transfers }),
      qc.invalidateQueries({ queryKey: PAY_KEYS.all }),
      qc.invalidateQueries({ queryKey: EVENT_KEYS.all }),
    ]);
  };
}

// ---------- transfers ----------

export function useTransfers() {
  const { client } = useApi();
  return useQuery({
    queryKey: TICKET_KEYS.transfers,
    queryFn: ({ signal }) => client.request('/v1/ticket-transfers', TicketTransferList, { signal }),
  });
}

export function useTransfer(id: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: TICKET_KEYS.transfer(id),
    queryFn: ({ signal }) =>
      client.request(`/v1/ticket-transfers/${id}`, TicketTransfer, { signal }),
  });
}

export function useOfferTransfer(eventId: string) {
  const { client } = useApi();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { toUserId: string; pricePaise: number }) =>
      client.request(`/v1/events/${eventId}/ticket-transfers`, TicketTransfer, {
        method: 'POST',
        body,
        idempotencyKey: idem('transfer'),
      }),
    onSuccess: refresh,
  });
}

export function useAnswerTransfer(id: string) {
  const { client } = useApi();
  const refresh = useRefresh();
  const accept = useMutation({
    mutationFn: () =>
      client.request(`/v1/ticket-transfers/${id}/accept`, AcceptTransferResult, {
        method: 'POST',
        idempotencyKey: idem('accept'),
      }),
    onSuccess: refresh,
  });
  const decline = useMutation({
    mutationFn: () =>
      client.request(`/v1/ticket-transfers/${id}/decline`, Empty, { method: 'POST' }),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () =>
      client.request(`/v1/ticket-transfers/${id}/cancel`, Empty, { method: 'POST' }),
    onSuccess: refresh,
  });
  return { accept, decline, cancel };
}

// ---------- paid +1 ----------

export function usePlusOneTicket(eventId: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: TICKET_KEYS.plusOne(eventId),
    retry: false,
    queryFn: ({ signal }) =>
      client.request(`/v1/events/${eventId}/plus-one-ticket`, PlusOneTicket, { signal }),
    // While the bank has not answered, keep checking (only verified webhooks change it).
    refetchInterval: (q) =>
      q.state.data && (q.state.data.status === 'created' || q.state.data.status === 'failed')
        ? 3000
        : false,
  });
}

export function usePlusOneCheckout(eventId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request(`/v1/events/${eventId}/plus-one-checkout`, PlusOneCheckout, {
        method: 'POST',
        body: {},
        idempotencyKey: idem('plus-one-checkout'),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: TICKET_KEYS.plusOne(eventId) });
    },
  });
}

export function useNewPlusOneLink(eventId: string) {
  const { client } = useApi();
  return useMutation({
    mutationFn: () =>
      client.request(`/v1/events/${eventId}/plus-one-ticket/link`, PlusOneLink, {
        method: 'POST',
      }),
  });
}

// ---------- deposits ----------

export function useDepositCheckout(eventId: string) {
  const { client } = useApi();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { receiptEmail: string | null; fromOffer: boolean }) =>
      client.request(`/v1/events/${eventId}/deposit-checkout`, CheckoutResult, {
        method: 'POST',
        body,
        idempotencyKey: idem('deposit'),
      }),
    onSuccess: refresh,
  });
}

// ---------- disputes ----------

export function usePaymentDispute(paymentId: string, enabled: boolean) {
  const { client } = useApi();
  return useQuery({
    queryKey: TICKET_KEYS.dispute(paymentId),
    enabled,
    queryFn: ({ signal }) =>
      client.request(`/v1/payments/${paymentId}/dispute`, PaymentDisputeState, { signal }),
  });
}

export function useOpenDispute(paymentId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDisputeBody) =>
      client.request(`/v1/payments/${paymentId}/disputes`, PaymentDispute, {
        method: 'POST',
        body,
        idempotencyKey: idem('dispute'),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: TICKET_KEYS.dispute(paymentId) });
    },
  });
}
