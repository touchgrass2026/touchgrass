import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../../components/ui';
import { formatWhen } from '../../../src/features/events/format';
import { money } from '../../../src/features/payments/format';
import { useAnswerTransfer, useTransfer } from '../../../src/features/payments/tickets-api';
import { errorMessage } from '../../../src/lib/errors';

/**
 * A ticket offered to you (D-229). Free: accepting moves the seat now. Priced: you pay on the checkout page and
 * the seat moves once the payment is confirmed. Saying no changes nothing for the sender.
 */
export default function TransferOfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const transfer = useTransfer(id);
  const { accept, decline } = useAnswerTransfer(id);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (transfer.isPending) return <LoadingState />;
  if (transfer.isError)
    return (
      <ErrorState
        message={errorMessage(t, transfer.error) ?? undefined}
        onRetry={() => void transfer.refetch()}
      />
    );
  const x = transfer.data;
  const free = x.pricePaise === 0;
  const amount = money(x.pricePaise, i18n.language);
  const open = x.status === 'pending' && x.direction === 'incoming';

  const take = async (): Promise<void> => {
    setError(null);
    try {
      const res = await accept.mutateAsync();
      if (res.kind === 'transferred') {
        setNotice(t('tickets.accepted'));
        router.replace({ pathname: '/events/[id]', params: { id: res.eventId } });
        return;
      }
      await Linking.openURL(res.session.checkoutUrl);
      router.replace({
        pathname: '/payments/[id]',
        params: { id: res.session.paymentId, url: res.session.checkoutUrl },
      });
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  const no = async (): Promise<void> => {
    setError(null);
    try {
      await decline.mutateAsync();
      setNotice(t('tickets.declined'));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="transfer-offer-screen">
      <Text variant="title" accessibilityRole="header">
        {t('tickets.offerTitle')}
      </Text>
      <Text testID="transfer-offer-body">
        {free
          ? t('tickets.offerFree', { name: x.from.displayName, title: x.eventTitle })
          : t('tickets.offerPaid', { name: x.from.displayName, title: x.eventTitle, amount })}
      </Text>
      <Text tone="muted">{formatWhen(x.eventStartsAt, i18n.language, x.eventTimezone)}</Text>
      <Text tone="muted" testID="transfer-offer-status">
        {t(`tickets.offerStatus.${x.status}`)}
      </Text>
      {open && !notice ? (
        <>
          <Button
            label={free ? t('tickets.accept') : t('tickets.payAndAccept', { amount })}
            loading={accept.isPending}
            onPress={() => void take()}
            testID="transfer-accept"
          />
          <Button
            label={t('tickets.decline')}
            variant="ghost"
            loading={decline.isPending}
            onPress={() => void no()}
            testID="transfer-decline"
          />
        </>
      ) : null}
      {notice ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID="transfer-offer-notice">
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="transfer-offer-error">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
