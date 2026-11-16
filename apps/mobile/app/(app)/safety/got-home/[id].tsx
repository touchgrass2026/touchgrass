import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { GotHomePrompt } from '../../../../components/GotHomePrompt';
import { ErrorState, LoadingState, Screen, Text } from '../../../../components/ui';
import { useGotHome } from '../../../../src/features/safety/api';
import { errorMessage } from '../../../../src/lib/errors';

/** "Got home safe?" (D-212): where the push after a late plan lands. */
export default function GotHomeScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useGotHome(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  return (
    <Screen testID="got-home-screen">
      <Text variant="title" accessibilityRole="header">
        {q.data.title}
      </Text>
      <GotHomePrompt status={q.data} testID="got-home" />
    </Screen>
  );
}
