import { categoryHues } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Check } from './icons';
import { Icon } from './ui';

/**
 * The verified badge (D-206): a filled sky-blue disc with a tick, the mark people already read as
 * "verified". Shown next to a verified person's name wherever it appears. Announced as "Verified".
 */
export function VerifiedMark({ size = 18, testID }: { size?: number; testID?: string }) {
  const { t } = useTranslation();
  const hue = categoryHues.sky;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('profile.verified')}
      testID={testID}
      style={[
        styles.disc,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: hue.solid },
      ]}
    >
      <Icon icon={Check} size={Math.round(size * 0.62)} color={hue.onSolid} strokeWidth={3.2} />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { alignItems: 'center', justifyContent: 'center' },
});
