import { media } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import {
  compressImage,
  pickImage,
  uploadImage,
  waitUntilReady,
} from '../src/features/media/upload';
import { useApi } from '../src/providers/api-context';
import { useTheme } from '../src/theme/theme';
import { Photo, X } from './icons';
import { Icon, Text } from './ui';

export interface CoverValue {
  /** Uploaded, ready cover to send as `coverMediaId`; null when there is none. */
  id: string | null;
  /** What to show: a local file just picked, or the plan's current cover. */
  uri: string | null;
}

/** Light text on a dark scrim stays readable over any photo (as the kit's dark Pill). */
const SCRIM = media.scrim;
const ON_SCRIM = media.text;

/**
 * The plan's cover photo (D-196), shown large at the top of Plot (D-199). Empty, it is one big "Add a cover
 * photo" target; set, the photo fills the frame with small Change and Remove buttons over it. The picked image
 * is cropped 16:9, compressed, uploaded as an `event_cover` and awaited until the server has scanned and
 * resized it (the plan can only use a ready cover).
 */
export function CoverPicker({
  value,
  onChange,
}: {
  value: CoverValue;
  onChange: (next: CoverValue) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { client } = useApi();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const choose = async (): Promise<void> => {
    setFailed(false);
    try {
      const uri = await pickImage([16, 9]);
      if (!uri) return;
      setBusy(true);
      const image = await compressImage(uri);
      const asset = await uploadImage(client, 'event_cover', image);
      if (!(await waitUntilReady(client, asset, 40))) throw new Error('not ready');
      onChange({ id: asset.id, uri: image.uri });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const frame = [styles.frame, { borderRadius: theme.radii.lg }];
  const uploading = busy ? (
    <View
      style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: theme.colors.overlay }]}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator
        color={ON_SCRIM}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text variant="caption" style={{ color: ON_SCRIM }}>
        {t('events.coverUploading')}
      </Text>
    </View>
  ) : null;

  return (
    <View style={styles.wrap} testID="plot-cover">
      {value.uri ? (
        <View style={[frame, { backgroundColor: theme.colors.surfaceAlt }]}>
          <Image
            source={{ uri: value.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessible
            accessibilityLabel={t('events.coverLabel')}
            accessibilityIgnoresInvertColors
            testID="plot-cover-preview"
          />
          {busy ? null : (
            <View style={styles.actions}>
              <Pressable
                testID="plot-cover-add"
                accessibilityRole="button"
                accessibilityLabel={t('events.coverChange')}
                onPress={() => void choose()}
                style={[
                  styles.overlayButton,
                  {
                    minHeight: theme.minTouchTarget,
                    borderRadius: theme.radii.pill,
                    backgroundColor: SCRIM,
                  },
                ]}
              >
                <Icon icon={Photo} size={16} color={ON_SCRIM} accent={ON_SCRIM} />
                <Text variant="label" style={{ color: ON_SCRIM }}>
                  {t('events.plotUiCoverChange')}
                </Text>
              </Pressable>
              <Pressable
                testID="plot-cover-remove"
                accessibilityRole="button"
                accessibilityLabel={t('events.coverRemove')}
                onPress={() => {
                  onChange({ id: null, uri: null });
                }}
                style={[
                  styles.center,
                  {
                    width: theme.minTouchTarget,
                    height: theme.minTouchTarget,
                    borderRadius: theme.radii.pill,
                    backgroundColor: SCRIM,
                  },
                ]}
              >
                <Icon icon={X} size={18} color={ON_SCRIM} />
              </Pressable>
            </View>
          )}
          {uploading}
        </View>
      ) : (
        <Pressable
          testID="plot-cover-add"
          accessibilityRole="button"
          accessibilityLabel={t('events.coverAdd')}
          accessibilityHint={t('events.coverHint')}
          accessibilityState={{ busy }}
          disabled={busy}
          onPress={() => void choose()}
          style={[
            styles.center,
            styles.empty,
            { borderRadius: theme.radii.lg },
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.inputBorder,
            },
          ]}
        >
          <View
            style={[
              styles.center,
              styles.badge,
              { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.pill },
            ]}
          >
            <Icon icon={Photo} size={22} color={theme.colors.text} accent={theme.colors.text} />
          </View>
          <Text variant="label">{t('events.coverAdd')}</Text>
          <Text variant="caption" tone="muted" style={styles.hint}>
            {t('events.coverHint')}
          </Text>
          {uploading}
        </Pressable>
      )}
      {failed ? (
        <Text tone="danger" variant="caption" accessibilityRole="alert">
          {t('events.coverFailed')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  frame: { width: '100%', aspectRatio: 16 / 9, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  // Grows past 16:9 when large text needs the room.
  empty: {
    width: '100%',
    minHeight: 196,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    padding: 24,
  },
  badge: { width: 48, height: 48 },
  hint: { textAlign: 'center' },
  actions: { position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: 8 },
  overlayButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 },
});
