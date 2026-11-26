import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HostConduct, type HostRule } from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { useApi } from '../../providers/api-context';

/** Host conduct (D-228): the one-time "No payments outside TouchGrass" rule and payment strikes. */
export const HOST_CONDUCT_KEY = ['host', 'conduct'] as const;

export function useHostConduct(enabled = true) {
  const { client } = useApi();
  return useQuery({
    queryKey: HOST_CONDUCT_KEY,
    queryFn: ({ signal }) => client.request('/v1/host/conduct', HostConduct, { signal }),
    enabled,
  });
}

export function useAcknowledgeHostRules() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rule: HostRule) =>
      client.request('/v1/host/rules/ack', HostConduct, {
        method: 'POST',
        body: { rule },
        idempotencyKey: `host-rules-${Crypto.randomUUID()}`,
      }),
    onSuccess: (conduct) => {
      qc.setQueryData(HOST_CONDUCT_KEY, conduct);
    },
  });
}
