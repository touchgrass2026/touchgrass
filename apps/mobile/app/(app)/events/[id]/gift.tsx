import { useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share } from 'react-native';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../../../components/ui';
import { useEvent } from '../../../../src/features/events/api';
import { money } from '../../../../src/features/payments/format';
import {
  useNewPlusOneLink,
  usePlusOneCheckout,
  usePlusOneTicket,
} from '../../../../src/features/payments/tickets-api';
import { ApiError } from '../../../../src/lib/api-client';
import { errorMessage } from '../../../../src/lib/errors';

/**
 * A paid +1 (D-229): one more seat at the plan's price, for a friend who claims it with a link and is (or
 * becomes) a member. Their name goes on the ticket. The link works once the payment is confirmed.
 */
export default function GiftSeatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const event = useEvent(id);
  const ticket = usePlusOneTicket(id);
  const checkout = usePlusOneCheckout(id);
  const relink = useNewPlusOneLink(id);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const none = ticket.error instanceof ApiError && ticket.error.code === 'NOT_FOUND';
  if (event.isPending || (ticket.isPending && !none)) return <LoadingState />;
  if (event.isError)
    return (
      <ErrorState
        message={errorMessage(t, event.error) ?? undefined}
        onRetry={() => void event.refetch()}
      />
    );
  if (ticket.isError && !none)
    return (
      <ErrorState
        message={errorMessage(t, ticket.error) ?? undefined}
        onRetry={() => void ticket.refetch()}
      />
    );
  const e = event.data;
  const amount = money(e.pricePaise, i18n.language);
  const p = none ? null : ticket.data;
  const paid = p?.status === 'captured';
  const open = p !== null && p !== undefined && (p.status === 'created' || p.status === 'failed');

  const buy = async (): Promise<void> => {
    setError(null);
    try {
      const res = await checkout.mutateAsync();
      setLink(res.claimUrl);
      await Linking.openURL(res.session.checkoutUrl);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  const share = async (url: string): Promise<void> => {
    await Share.share({ message: t('tickets.plusOneShareMessage', { title: e.title, url }) });
  };
  const newLink = async (): Promise<void> => {
    setError(null);
    try {
      const res = await relink.mutateAsync();
      setLink(res.claimUrl);
      await share(res.claimUrl);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="gift-screen">
      <Text variant="title" accessibilityRole="header">
        {t('tickets.plusOneTitle')}
      </Text>
      <Text tone="muted">{e.title}</Text>
      <Text>{t('tickets.plusOneBody', { amount })}</Text>
      {p?.holder ? (
        <Text tone="primary" testID="gift-claimed">
          {t('tickets.plusOneClaimed', { name: p.holder.displayName })}
        </Text>
      ) : null}
      {paid && !p.holder ? (
        <>
          <Text tone="primary" testID="gift-unclaimed">
            {t('tickets.plusOneUnclaimed')}
          </Text>
          {link ? (
            <Button
              label={t('tickets.plusOneShare')}
              onPress={() => void share(link)}
              testID="gift-share"
            />
          ) : null}
          <Button
            label={t('tickets.plusOneNewLink')}
            variant={link ? 'ghost' : 'primary'}
            loading={relink.isPending}
            onPress={() => void newLink()}
            testID="gift-new-link"
          />
        </>
      ) : null}
      {p && (p.status === 'refunded' || p.status === 'partially_refunded') ? (
        <Text tone="muted" testID="gift-refunded">
          {t('tickets.plusOneRefunded')}
        </Text>
      ) : null}
      {open ? <Text testID="gift-checking">{t('payments.checkingPayment')}</Text> : null}
      {!p || open || p.status === 'expired' ? (
        <Button
          label={t('tickets.plusOnePay', { amount })}
          loading={checkout.isPending}
          onPress={() => void buy()}
          testID="gift-pay"
        />
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="gift-error">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
