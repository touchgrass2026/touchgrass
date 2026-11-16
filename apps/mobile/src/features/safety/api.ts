import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GotHomeStatus,
  type LocationPointBody,
  MyLiveShare,
  MyVerification,
  SafetySettings,
  type SosBody,
  type StartShareBody,
  type SubmitVerificationBody,
  type TrustedContactBody,
  TrustedContactList,
  type UpdateSafetySettingsBody,
} from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { useApi } from '../../providers/api-context';
import { ME_KEY } from '../me/api';

const idem = (prefix: string): string => `${prefix}-${Crypto.randomUUID()}`;

export const SAFETY_KEYS = {
  contacts: ['safety', 'contacts'] as const,
  live: ['safety', 'live'] as const,
  verification: ['verification'] as const,
  settings: ['safety', 'settings'] as const,
  gotHome: (eventId: string) => ['safety', 'got-home', eventId] as const,
};

// ---------- trusted contacts (F-SAF-04) ----------

export function useTrustedContacts() {
  const { client } = useApi();
  return useQuery({
    queryKey: SAFETY_KEYS.contacts,
    queryFn: ({ signal }) => client.request('/v1/safety/contacts', TrustedContactList, { signal }),
  });
}

export function useAddContact() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TrustedContactBody) =>
      client.request('/v1/safety/contacts', TrustedContactList, {
        method: 'POST',
        body,
        idempotencyKey: idem('contact'),
      }),
    onSuccess: (data) => qc.setQueryData(SAFETY_KEYS.contacts, data),
  });
}

export function useRemoveContact() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.request(`/v1/safety/contacts/${id}`, TrustedContactList, { method: 'DELETE' }),
    onSuccess: (data) => qc.setQueryData(SAFETY_KEYS.contacts, data),
  });
}

// ---------- live location and SOS (F-SAF-04) ----------

export function useLiveShare() {
  const { client } = useApi();
  return useQuery({
    queryKey: SAFETY_KEYS.live,
    queryFn: ({ signal }) => client.request('/v1/safety/live', MyLiveShare, { signal }),
  });
}

function useLiveMutation<T>(run: (body: T) => Promise<MyLiveShare>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (data) => qc.setQueryData(SAFETY_KEYS.live, data),
  });
}

export function useStartShare() {
  const { client } = useApi();
  return useLiveMutation((body: StartShareBody) =>
    client.request('/v1/safety/live', MyLiveShare, {
      method: 'POST',
      body,
      idempotencyKey: idem('live'),
    }),
  );
}

export function useStopShare() {
  const { client } = useApi();
  return useLiveMutation(() =>
    client.request('/v1/safety/live/stop', MyLiveShare, { method: 'POST' }),
  );
}

export function useSendPoint() {
  const { client } = useApi();
  return useLiveMutation((body: LocationPointBody) =>
    client.request('/v1/safety/live/points', MyLiveShare, { method: 'POST', body }),
  );
}

export function useSos() {
  const { client } = useApi();
  return useLiveMutation((body: SosBody) =>
    client.request('/v1/safety/sos', MyLiveShare, {
      method: 'POST',
      body,
      idempotencyKey: idem('sos'),
    }),
  );
}

// ---------- settings and "Got home safe?" (D-212) ----------

export function useSafetySettings() {
  const { client } = useApi();
  return useQuery({
    queryKey: SAFETY_KEYS.settings,
    queryFn: ({ signal }) => client.request('/v1/safety/settings', SafetySettings, { signal }),
  });
}

export function useUpdateSafetySettings() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSafetySettingsBody) =>
      client.request('/v1/safety/settings', SafetySettings, { method: 'PATCH', body }),
    onSuccess: (data) => qc.setQueryData(SAFETY_KEYS.settings, data),
  });
}

export function useGotHome(eventId: string, enabled = true) {
  const { client } = useApi();
  return useQuery({
    queryKey: SAFETY_KEYS.gotHome(eventId),
    queryFn: ({ signal }) =>
      client.request(`/v1/safety/got-home/${eventId}`, GotHomeStatus, { signal }),
    enabled,
  });
}

function useGotHomeMutation<T>(eventId: string, run: (body: T) => Promise<GotHomeStatus>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (data) => qc.setQueryData(SAFETY_KEYS.gotHome(eventId), data),
  });
}

/** "I got home": recorded so the question stops (the text to contacts goes from the phone). */
export function useGotHomeHome(eventId: string) {
  const { client } = useApi();
  return useGotHomeMutation(eventId, () =>
    client.request(`/v1/safety/got-home/${eventId}/home`, GotHomeStatus, {
      method: 'POST',
      idempotencyKey: idem('home'),
    }),
  );
}

/** "Not yet": ask again in 30 minutes. */
export function useGotHomeSnooze(eventId: string) {
  const { client } = useApi();
  return useGotHomeMutation(eventId, () =>
    client.request(`/v1/safety/got-home/${eventId}/snooze`, GotHomeStatus, {
      method: 'POST',
      idempotencyKey: idem('snooze'),
    }),
  );
}

/** "Ask me if I got home after this plan". */
export function useGotHomeRequest(eventId: string) {
  const { client } = useApi();
  return useGotHomeMutation(eventId, (ask: boolean) =>
    client.request(`/v1/safety/got-home/${eventId}/request`, GotHomeStatus, {
      method: 'POST',
      body: { ask },
    }),
  );
}

// ---------- verification (F-SAF-01) ----------

export function useMyVerification() {
  const { client } = useApi();
  return useQuery({
    queryKey: SAFETY_KEYS.verification,
    queryFn: ({ signal }) => client.request('/v1/verification', MyVerification, { signal }),
  });
}

export function useStartVerification() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request('/v1/verification/challenge', MyVerification, { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(SAFETY_KEYS.verification, data),
  });
}

export function useSubmitVerification() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitVerificationBody) =>
      client.request('/v1/verification/submit', MyVerification, {
        method: 'POST',
        body,
        idempotencyKey: idem('verify'),
      }),
    onSuccess: async (data) => {
      qc.setQueryData(SAFETY_KEYS.verification, data);
      await qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}
