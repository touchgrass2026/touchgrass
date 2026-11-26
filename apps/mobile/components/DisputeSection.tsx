import { DisputeReason } from '@touchgrass/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useOpenDispute, usePaymentDispute } from '../src/features/payments/tickets-api';
import { errorMessage } from '../src/lib/errors';
import { Button, Chip, Text, TextField } from './ui';

/**
 * Report a problem with a paid ticket (D-229). Our team answers with the check-in record; until then the host's
 * payout for the plan waits.
 */
export function DisputeSection({ paymentId }: { paymentId: string }) {
  const { t } = useTranslation();
  const state = usePaymentDispute(paymentId, true);
  const open = useOpenDispute(paymentId);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dispute = state.data?.dispute ?? null;

  if (dispute)
    return (
      <Text tone="muted" testID="dispute-status">
        {t(`tickets.disputeStatus.${dispute.status}`)}
      </Text>
    );
  if (!editing)
    return (
      <Button
        label={t('tickets.disputeTitle')}
        variant="ghost"
        onPress={() => {
          setEditing(true);
        }}
        testID="dispute-open"
      />
    );
  const send = async (): Promise<void> => {
    if (!reason) return;
    setError(null);
    try {
      await open.mutateAsync({ reason, note: note.trim() });
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  return (
    <View style={styles.wrap} testID="dispute-form">
      <Text variant="heading" accessibilityRole="header">
        {t('tickets.disputeTitle')}
      </Text>
      <Text tone="muted">{t('tickets.disputeBody')}</Text>
      <Text variant="label">{t('tickets.disputeReasonLabel')}</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {DisputeReason.options.map((r) => (
          <Chip
            key={r}
            kind="radio"
            label={t(`tickets.disputeReasons.${r}`)}
            selected={reason === r}
            onToggle={() => {
              setReason(r);
            }}
            testID={`dispute-reason-${r}`}
          />
        ))}
      </View>
      <TextField
        label={t('tickets.disputeNote')}
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
        testID="dispute-note"
      />
      <Button
        label={t('tickets.disputeSend')}
        disabled={reason === null}
        loading={open.isPending}
        onPress={() => void send()}
        testID="dispute-send"
      />
      {open.isSuccess ? (
        <Text tone="primary" accessibilityLiveRegion="polite">
          {t('tickets.disputeSent')}
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
