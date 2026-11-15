import { CreatePollBody } from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { X } from '../../../../components/icons';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Icon,
  Screen,
  SwitchRow,
  Text,
  TextField,
  Pressable,
} from '../../../../components/ui';
import { fontFamilyFor } from '../../../../src/theme/fonts';
import { useTheme, TOUCH_TARGET } from '../../../../src/theme/theme';
import { useCreatePoll } from '../../../../src/features/chat/api';
import { errorMessage } from '../../../../src/lib/errors';

/** Hosts ask the group (F-CHT-05): 2–10 options, single or multiple choice, optionally anonymous. */
export default function NewPollScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const create = useCreatePoll(id);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const parsed = CreatePollBody.safeParse({
      question,
      options: options.map((o) => o.trim()).filter(Boolean),
      multi,
      anonymous,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      router.back();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="poll-screen">
      <Text variant="title" accessibilityRole="header">
        {t('chat.newPoll')}
      </Text>
      <TextField
        label={t('chat.pollQuestion')}
        value={question}
        onChangeText={setQuestion}
        maxLength={200}
        testID="poll-question"
      />
      {/* Options stacked in one box like a WhatsApp poll: no gaps, a new empty row appears as you type. */}
      <Text variant="overline" tone="muted">
        {t('chat.pollOptions')}
      </Text>
      <View
        style={[
          styles.box,
          { borderColor: theme.colors.inputBorder, borderRadius: theme.radii.md },
        ]}
      >
        {options.map((o, i) => (
          <View
            key={i}
            style={[
              styles.optionRow,
              i > 0 ? { borderTopColor: theme.colors.border, borderTopWidth: 1 } : null,
            ]}
          >
            <TextInput
              value={o}
              maxLength={80}
              placeholder={i < 2 ? t('chat.pollOption', { n: i + 1 }) : t('chat.addOption')}
              placeholderTextColor={theme.colors.textMuted}
              accessibilityLabel={t('chat.pollOption', { n: i + 1 })}
              onChangeText={(v) => {
                setOptions((list) => {
                  const next = list.map((x, j) => (j === i ? v : x));
                  // Typing in the last row opens a fresh one (up to 10).
                  if (i === list.length - 1 && v.trim() && list.length < 10) next.push('');
                  return next;
                });
              }}
              maxFontSizeMultiplier={2}
              style={[
                styles.optionInput,
                { color: theme.colors.text, fontFamily: fontFamilyFor('400') },
              ]}
              testID={`poll-option-input-${String(i)}`}
            />
            {options.length > 2 && o ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chat.removeOption', { n: i + 1 })}
                hitSlop={8}
                onPress={() => {
                  setOptions((list) => {
                    const next = list.filter((_, j) => j !== i);
                    return next.length < 2 ? [...next, ''] : next;
                  });
                }}
                style={styles.remove}
                testID={`poll-option-remove-${String(i)}`}
              >
                <Icon icon={X} size={16} color={theme.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
      <SwitchRow label={t('chat.pollMulti')} value={multi} onChange={setMulti} />
      <SwitchRow label={t('chat.pollAnonymous')} value={anonymous} onChange={setAnonymous} />
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="poll-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('chat.createPoll')}
        loading={create.isPending}
        onPress={() => void submit()}
        testID="create-poll"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 2, overflow: 'hidden' },
  optionRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 14 },
  optionInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  remove: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
