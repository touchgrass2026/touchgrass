import { InviteCodeInput } from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Screen, Text, TextField } from '../../components/ui';
import { WaitlistSheet } from '../../components/WaitlistSheet';
import { readAppEnvironment } from '../../src/config';
import { useCheckInvite } from '../../src/features/auth/api';
import { errorMessage } from '../../src/lib/errors';
import { useAuthFlowStore } from '../../src/stores/auth-flow-store';

/** Invite gate (F-ACC-01). Reached from welcome, or from OTP when the server says an invite is required. */
export default function InviteScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [code, setCode] = useState(useAuthFlowStore.getState().inviteCode ?? '');
  const [error, setError] = useState<string | null>(null);
  const check = useCheckInvite();
  const [waitlist, setWaitlist] = useState(false);

  const submit = async (): Promise<void> => {
    const parsed = InviteCodeInput.safeParse(code);
    if (!parsed.success) {
      setError(t('errors.INVITE_INVALID'));
      return;
    }
    try {
      const res = await check.mutateAsync(parsed.data);
      if (!res.valid) {
        setError(t('errors.INVITE_INVALID'));
        return;
      }
      useAuthFlowStore.getState().setInvite(parsed.data, res.inviterName);
      setError(null);
      if (next === 'otp') router.back();
      else router.push('/phone');
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const inviter = useAuthFlowStore((s) => s.inviterName);
  const accepted = useAuthFlowStore((s) => s.inviteCode);
  return (
    <Screen testID="invite-screen">
      <Text variant="title">{t('auth.inviteTitle')}</Text>
      <Text tone="muted">{t('auth.inviteBody')}</Text>
      <TextField
        label={t('auth.inviteLabel')}
        value={code}
        onChangeText={(v) => {
          setCode(v.toUpperCase());
          setError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        error={error}
        testID="invite-input"
      />
      {accepted && !error ? (
        <Text tone="primary">
          {inviter ? t('auth.inviteValid', { name: inviter }) : t('auth.inviteValidAnon')}
        </Text>
      ) : null}
      <Button
        label={t('auth.checkInvite')}
        onPress={() => void submit()}
        loading={check.isPending}
        disabled={code.trim().length < 4}
        testID="invite-submit"
      />
      {/* No code yet (D-209): join the waitlist right here, or read more on the website. */}
      <View style={styles.noCode} testID="no-code">
        <Text variant="heading">{t('auth.noCodeTitle')}</Text>
        <Text tone="muted">{t('auth.noCodeBody')}</Text>
        <Button
          label={t('auth.joinWaitlist')}
          variant="secondary"
          onPress={() => {
            setWaitlist(true);
          }}
          testID="open-waitlist"
        />
        <Button
          label={t('auth.visitWebsite')}
          variant="ghost"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(readAppEnvironment().webUrl)}
          testID="open-website"
        />
      </View>
      {waitlist ? (
        <WaitlistSheet
          onClose={() => {
            setWaitlist(false);
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  noCode: { gap: 8, marginTop: 24 },
});
