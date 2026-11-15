import { LaunchWaitlistBody, SUPPORTED_LANGUAGES } from '@touchgrass/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useJoinWaitlist } from '../src/features/auth/api';
import { errorMessage } from '../src/lib/errors';
import { Sheet } from './DateTimeFields';
import { Button, SwitchRow, Text, TextField } from './ui';

/**
 * No invite code yet (D-209): a short form that puts the person on the same launch waitlist as the
 * website (name, a phone number or an email, consent), tagged `source: app`. Admins invite them from the
 * waitlist page, which texts or emails a single-use code.
 */
export function WaitlistSheet({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const join = useJoinWaitlist();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const language = (SUPPORTED_LANGUAGES as readonly string[]).includes(i18n.language)
    ? (i18n.language as (typeof SUPPORTED_LANGUAGES)[number])
    : 'en';

  const submit = async (): Promise<void> => {
    const input = { name, phone, email, consent: consent as true, language };
    // One clear thing to fix at a time, in the order of the form.
    const missing = !name.trim()
      ? 'auth.waitlistNeedName'
      : !phone.trim() && !email.trim()
        ? 'auth.waitlistNeedContact'
        : !consent
          ? 'auth.waitlistNeedConsent'
          : null;
    if (missing) {
      setError(t(missing));
      return;
    }
    const parsed = LaunchWaitlistBody.safeParse(input);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(
        field === 'phone'
          ? t('auth.waitlistBadPhone')
          : field === 'email'
            ? t('auth.waitlistBadEmail')
            : t('auth.waitlistNeedContact'),
      );
      return;
    }
    setError(null);
    try {
      await join.mutateAsync(input);
      setDone(true);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  if (done)
    return (
      <Sheet title={t('auth.waitlistDone')} onClose={onClose} testID="waitlist-sheet">
        <View style={styles.done} testID="waitlist-done" accessibilityLiveRegion="polite">
          <Text>{t('auth.waitlistDoneBody')}</Text>
          <Button label={t('common.done')} onPress={onClose} testID="waitlist-close" />
        </View>
      </Sheet>
    );

  return (
    <Sheet
      title={t('auth.waitlistTitle')}
      onClose={onClose}
      testID="waitlist-sheet"
      footer={
        <View style={styles.grow}>
          <Button
            label={t('auth.waitlistSubmit')}
            onPress={() => void submit()}
            loading={join.isPending}
            testID="waitlist-submit"
          />
        </View>
      }
    >
      <Text tone="muted">{t('auth.waitlistBody')}</Text>
      <TextField
        label={t('auth.waitlistName')}
        value={name}
        onChangeText={setName}
        autoComplete="name"
        textContentType="name"
        maxLength={60}
        testID="waitlist-name"
      />
      <TextField
        label={t('auth.waitlistPhone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={20}
        testID="waitlist-phone"
      />
      <TextField
        label={t('auth.waitlistEmail')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        maxLength={254}
        testID="waitlist-email"
      />
      <SwitchRow
        label={t('auth.waitlistConsent')}
        value={consent}
        onChange={setConsent}
        testID="waitlist-consent"
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="waitlist-error">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  done: { gap: 16 },
  grow: { flex: 1 },
});
