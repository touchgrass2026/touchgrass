import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { Button, Screen, Text, TextField } from '../../../../components/ui';
import { useCheckIn } from '../../../../src/features/events/api';
import { errorMessage } from '../../../../src/lib/errors';

/**
 * Hosts scan tickets at the door (F-EVT-14). Tickets rotate every 30 seconds (D-227), so a screenshot fails
 * with "expired". The six-digit code under a ticket works when the camera cannot read it.
 */
export default function ScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const checkIn = useCheckIn(id);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [manual, setManual] = useState('');
  const busy = useRef(false);
  const last = useRef<string | null>(null);

  const submit = async (qr: string): Promise<void> => {
    if (busy.current || qr === last.current) return;
    busy.current = true;
    last.current = qr;
    try {
      // Six digits are the short code under the QR; anything else is a scanned or pasted QR payload.
      const r = await checkIn.mutateAsync(/^\d{6}$/.test(qr) ? { code: qr } : { qr });
      setResult({ ok: true, text: t('events.scanned', { name: r.displayName }) });
    } catch (err) {
      setResult({ ok: false, text: errorMessage(t, err) ?? '' });
    } finally {
      busy.current = false;
    }
  };

  return (
    <Screen testID="scan-screen">
      <Text variant="title" accessibilityRole="header">
        {t('events.scan')}
      </Text>
      <Text>{t('events.scanBody')}</Text>
      {permission?.granted ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(r: BarcodeScanningResult) => void submit(r.data)}
          accessibilityLabel={t('events.scanBody')}
        />
      ) : (
        <>
          {permission && !permission.canAskAgain ? (
            <Text tone="danger">{t('events.cameraDenied')}</Text>
          ) : null}
          <Button
            label={t('events.allowCamera')}
            onPress={() => void requestPermission()}
            testID="allow-camera"
          />
        </>
      )}
      {result ? (
        <Text
          variant="heading"
          tone={result.ok ? 'primary' : 'danger'}
          accessibilityLiveRegion="assertive"
          testID="scan-result"
        >
          {result.text}
        </Text>
      ) : null}
      <TextField
        label={t('events.manualCode')}
        value={manual}
        onChangeText={setManual}
        autoCapitalize="none"
        inputMode="numeric"
        testID="manual-code"
      />
      <Button
        label={t('events.checkInCode')}
        disabled={manual.trim().length < 6}
        loading={checkIn.isPending}
        testID="manual-check-in"
        onPress={() => {
          last.current = null;
          void submit(manual.trim());
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ camera: { height: 320, borderRadius: 12, overflow: 'hidden' } });
