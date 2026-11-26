import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '../DateTimeFields';
import { Button, Text } from '../ui';

/**
 * The one rule before a first plan (D-228): no payments outside TouchGrass. Agreeing is stored, so it is asked
 * once; "Not now" closes the sheet and keeps the draft.
 */
export function HostRulesSheet({
  onAgree,
  onClose,
  busy,
  error,
}: {
  onAgree: () => void;
  onClose: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Sheet
      title={t('hostRules.title')}
      onClose={onClose}
      testID="host-rules-sheet"
      footer={
        <View style={styles.actions}>
          <Button
            label={t('hostRules.agree')}
            accessibilityHint={t('hostRules.agreeHint')}
            loading={busy}
            onPress={onAgree}
            testID="host-rules-agree"
          />
          <Button
            label={t('hostRules.later')}
            variant="ghost"
            onPress={onClose}
            testID="host-rules-later"
          />
        </View>
      }
    >
      <Text variant="heading">{t('hostRules.rule')}</Text>
      <Text>{t('hostRules.body')}</Text>
      <Text tone="muted">{t('hostRules.consequence')}</Text>
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({ actions: { gap: 8 } });
