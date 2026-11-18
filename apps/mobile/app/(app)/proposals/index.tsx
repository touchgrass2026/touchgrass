import type { ProposalSummary } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Avatar } from '../../../components/Avatar';
import { ChevronRight } from '../../../components/icons';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Pill,
  Pressable,
  Screen,
  Text,
} from '../../../components/ui';
import { useProposals } from '../../../src/features/engagement/api';
import { formatWhen } from '../../../src/features/events/format';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme } from '../../../src/theme/theme';

/** Plans up for a vote (F-ENG-03): one card each, with what needs you first (D-224). */
export default function ProposalsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useProposals();
  return (
    <Screen testID="proposals-screen" onRefresh={() => q.refetch()}>
      <Text tone="muted">{t('proposals.listIntro')}</Text>
      <Button
        label={t('proposals.create')}
        onPress={() => {
          router.push('/proposals/new');
        }}
        testID="proposal-create"
      />
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState
          message={errorMessage(t, q.error) ?? undefined}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.items.length === 0 ? (
        <EmptyState title={t('proposals.empty')} body={t('proposals.emptyBody')} />
      ) : (
        q.data.items.map((p) => (
          <ProposalCard
            key={p.id}
            p={p}
            onPress={() => {
              router.push({ pathname: '/proposals/[id]', params: { id: p.id } });
            }}
          />
        ))
      )}
    </Screen>
  );
}

function ProposalCard({ p, onPress }: { p: ProposalSummary; onPress: () => void }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const open = p.status === 'open' && Date.now() < Date.parse(p.deadline);
  const needsVote = open && !p.viewerIsCreator && !p.viewerHasVoted;
  const status =
    p.status === 'locked'
      ? t('proposals.statusConfirmed')
      : p.status === 'cancelled'
        ? t('proposals.statusCalledOff')
        : open
          ? t('proposals.statusVoting')
          : t('proposals.statusClosed');
  const lines = [
    t('proposals.suggestedBy', { name: p.creator.displayName }),
    status,
    open ? t('proposals.closesAt', { time: formatWhen(p.deadline, i18n.language) }) : null,
    t('proposals.suggestions', { count: p.optionCount }),
  ].filter((x): x is string => x !== null);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[p.title, needsVote ? t('proposals.voteNeeded') : null, ...lines]
        .filter(Boolean)
        .join(', ')}
      onPress={onPress}
      testID={`proposal-${p.id}`}
      style={[
        styles.card,
        {
          minHeight: theme.minTouchTarget,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.lg,
        },
      ]}
    >
      <View style={styles.top}>
        <Text variant="heading" style={styles.grow}>
          {p.title}
        </Text>
        <Icon icon={ChevronRight} size={18} color={theme.colors.textMuted} />
      </View>
      {needsVote ? (
        <Pill
          label={t('proposals.voteNeeded')}
          tone="accent"
          testID={`proposal-needs-vote-${p.id}`}
        />
      ) : null}
      <View style={styles.row}>
        <Avatar photo={p.creator.photo} name={p.creator.displayName} size={22} />
        <Text variant="caption" tone="muted" style={styles.grow}>
          {lines[0]}
        </Text>
      </View>
      <View style={styles.row}>
        <Pill label={status} tone={p.status === 'locked' ? 'primary' : 'glass'} />
        <Text variant="caption" tone="muted" style={styles.grow}>
          {lines.slice(2).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 8, borderWidth: StyleSheet.hairlineWidth },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  grow: { flexShrink: 1, flexGrow: 1 },
});
