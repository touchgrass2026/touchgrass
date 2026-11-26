import { type PersonCard, transferClosesAt } from '@touchgrass/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonRow } from '../../../../components/PersonRow';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../../../components/ui';
import { useSearch } from '../../../../src/features/discovery/api';
import { useEvent } from '../../../../src/features/events/api';
import { formatTime } from '../../../../src/features/events/format';
import { money } from '../../../../src/features/payments/format';
import {
  useAnswerTransfer,
  useOfferTransfer,
  useTransfers,
} from '../../../../src/features/payments/tickets-api';
import { flatten, useSquad } from '../../../../src/features/social/api';
import { errorMessage } from '../../../../src/lib/errors';

/** Rupees typed by the seller → paise, or null when it isn't a price. */
function toPaise(text: string): number | null {
  const v = text.trim() === '' ? 0 : Number(text.replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
}

/**
 * Transfer a paid ticket (D-229): to someone from your squad or found by name, free or for at most what the seat
 * cost. The seat stays yours until they accept (and, for a price, until their payment is confirmed). Transfers
 * close when check-in opens.
 */
export default function TransferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const event = useEvent(id);
  const squad = useSquad();
  const transfers = useTransfers();
  const offer = useOfferTransfer(id);
  const [q, setQ] = useState('');
  const search = useSearch(q, 'people');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const pending = transfers.data?.items.find(
    (x) => x.eventId === id && x.direction === 'outgoing' && x.status === 'pending',
  );
  const answer = useAnswerTransfer(pending?.id ?? '');

  if (event.isPending || squad.isPending) return <LoadingState />;
  if (event.isError)
    return (
      <ErrorState
        message={errorMessage(t, event.error) ?? undefined}
        onRetry={() => void event.refetch()}
      />
    );
  if (squad.isError)
    return (
      <ErrorState
        message={errorMessage(t, squad.error) ?? undefined}
        onRetry={() => void squad.refetch()}
      />
    );
  const e = event.data;
  const cap = e.pricePaise;
  const paise = toPaise(price);
  const priceOk = paise !== null && paise <= cap;

  const send = async (to: PersonCard): Promise<void> => {
    if (!priceOk) return;
    setError(null);
    try {
      await offer.mutateAsync({ toUserId: to.id, pricePaise: paise });
      setSent(t('tickets.transferSent', { name: to.displayName }));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  const cancel = async (): Promise<void> => {
    setError(null);
    try {
      await answer.cancel.mutateAsync();
      setSent(t('tickets.transferCancelled'));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const people = q.trim().length >= 2 ? (search.data?.people ?? []) : flatten(squad.data);
  const row = (p: PersonCard) => (
    <PersonRow
      key={p.id}
      person={p}
      onOpen={() => void send(p)}
      actions={
        <Button
          label={t('tickets.transferSend')}
          variant="secondary"
          disabled={!priceOk || pending !== undefined}
          loading={offer.isPending}
          accessibilityLabel={t('tickets.transferSendTo', { name: p.displayName })}
          onPress={() => void send(p)}
          testID={`transfer-to-${p.id}`}
        />
      }
    />
  );

  return (
    <Screen testID="transfer-screen">
      <Text variant="title" accessibilityRole="header">
        {t('tickets.transferTitle')}
      </Text>
      <Text tone="muted">{e.title}</Text>
      <Text>{t('tickets.transferBody', { amount: money(cap, i18n.language) })}</Text>
      <Text tone="muted" testID="transfer-closes">
        {t('tickets.transferClosesAt', {
          time: formatTime(
            transferClosesAt(new Date(e.startsAt)).toISOString(),
            i18n.language,
            e.timezone,
          ),
        })}
      </Text>
      {pending ? (
        <>
          <Text tone="primary" testID="transfer-pending">
            {t('tickets.transferPending', { name: pending.to.displayName })}
          </Text>
          <Button
            label={t('tickets.transferCancel')}
            variant="ghost"
            loading={answer.cancel.isPending}
            onPress={() => void cancel()}
            testID="transfer-cancel"
          />
        </>
      ) : (
        <>
          <TextField
            label={t('tickets.transferPriceLabel')}
            hint={t('tickets.transferPriceHint', { amount: money(cap, i18n.language) })}
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            error={priceOk ? null : t('tickets.transferPriceTooHigh')}
            testID="transfer-price"
          />
          <TextField
            label={t('tickets.transferSearchLabel')}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            testID="transfer-search"
          />
          {q.trim().length < 2 ? <Text variant="label">{t('tickets.transferSquad')}</Text> : null}
          {people.length === 0 ? <EmptyState body={t('squad.empty')} /> : null}
          {people.map(row)}
        </>
      )}
      {sent ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID="transfer-sent">
          {sent}
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="transfer-error">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
