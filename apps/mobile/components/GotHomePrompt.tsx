import type { GotHomeStatus } from '@touchgrass/shared';
import * as SMS from 'expo-sms';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { formatTime } from '../src/features/events/format';
import { useGotHomeHome, useGotHomeSnooze, useTrustedContacts } from '../src/features/safety/api';
import { shareText } from '../src/features/share/share';
import { errorMessage } from '../src/lib/errors';
import { Button, Text } from './ui';

/**
 * "Got home safe?" (D-212). "I got home" records the answer (so we stop asking) and opens the phone's own
 * Messages app filled in for every trusted contact: TouchGrass sends no texts itself (D-166), as with SOS.
 * "Not yet" asks again in 30 minutes, a few times at most. Without trusted contacts it offers to add one.
 */
export function GotHomePrompt({ status, testID }: { status: GotHomeStatus; testID: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const contacts = useTrustedContacts();
  const home = useGotHomeHome(status.eventId);
  const snooze = useGotHomeSnooze(status.eventId);
  const [failed, setFailed] = useState<string | null>(null);
  const phones = (contacts.data?.items ?? []).map((c) => c.phone);
  const noContacts = contacts.data !== undefined && phones.length === 0;

  const textContacts = async (): Promise<void> => {
    if (phones.length === 0) return;
    const message = t('safety.gotHome.message', { title: status.title });
    if (await SMS.isAvailableAsync()) await SMS.sendSMSAsync(phones, message);
    else await shareText(message);
  };
  const gotHome = async (): Promise<void> => {
    setFailed(null);
    try {
      await home.mutateAsync(undefined);
      await textContacts();
    } catch (err) {
      setFailed(errorMessage(t, err) ?? t('states.errorBody'));
    }
  };

  const addContact = noContacts ? (
    <>
      <Text tone="muted" testID={`${testID}-no-contacts`}>
        {t('safety.gotHome.noContacts')}
      </Text>
      <Button
        label={t('safety.gotHome.addContact')}
        variant="secondary"
        onPress={() => {
          router.push('/safety/contacts');
        }}
        testID={`${testID}-add-contact`}
      />
    </>
  ) : null;

  return (
    <View style={{ gap: 10 }} testID={testID}>
      {status.homeAt ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('safety.gotHome.doneTitle')}
          </Text>
          <Text accessibilityLiveRegion="polite" testID={`${testID}-done`}>
            {t('safety.gotHome.doneBody')}
          </Text>
          {phones.length > 0 ? (
            <Button
              label={t('safety.gotHome.textAgain')}
              variant="secondary"
              accessibilityHint={t('safety.gotHome.homeHint')}
              onPress={() => void textContacts().catch(() => undefined)}
              testID={`${testID}-text-again`}
            />
          ) : null}
          {addContact}
        </>
      ) : status.due ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('safety.gotHome.title')}
          </Text>
          <Text>{t('safety.gotHome.body')}</Text>
          <Button
            label={t('safety.gotHome.home')}
            accessibilityHint={t('safety.gotHome.homeHint')}
            loading={home.isPending}
            onPress={() => void gotHome()}
            testID={`${testID}-home`}
          />
          {status.canSnooze ? (
            <Button
              label={t('safety.gotHome.notYet')}
              variant="secondary"
              accessibilityHint={t('safety.gotHome.notYetHint')}
              loading={snooze.isPending}
              onPress={() => {
                setFailed(null);
                snooze.mutate(undefined, {
                  onError: (err) => {
                    setFailed(errorMessage(t, err) ?? t('states.errorBody'));
                  },
                });
              }}
              testID={`${testID}-not-yet`}
            />
          ) : (
            <Text tone="muted">{t('safety.gotHome.noMoreSnoozes')}</Text>
          )}
          {addContact}
        </>
      ) : status.askAgainAt ? (
        <Text accessibilityLiveRegion="polite" testID={`${testID}-snoozed`}>
          {t('safety.gotHome.askAgain', {
            time: formatTime(status.askAgainAt, i18n.language, status.timezone),
          })}
        </Text>
      ) : (
        <Text tone="muted" testID={`${testID}-not-due`}>
          {t('safety.gotHome.notDue')}
        </Text>
      )}
      {failed ? (
        <Text tone="danger" accessibilityRole="alert" testID={`${testID}-error`}>
          {failed}
        </Text>
      ) : null}
    </View>
  );
}
