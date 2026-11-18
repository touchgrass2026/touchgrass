import type { PersonCard, ProposalOption, ProposalOptionKind } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { formatWhen } from '../../src/features/events/format';
import { useTheme } from '../../src/theme/theme';
import { Avatar } from '../Avatar';
import { Check, Plus } from '../icons';
import { Card, Icon, Pill, Pressable, Text } from '../ui';

/** A time option reads as its date and time; places and activities as their label. */
export function optionText(o: ProposalOption, language: string): string {
  return o.kind === 'time' && o.startsAt ? formatWhen(o.startsAt, language) : o.label;
}

/** The options with the most votes (all of them on a tie); none while nobody has voted. */
export function leaderIds(options: readonly ProposalOption[]): Set<string> {
  const top = Math.max(0, ...options.map((o) => o.votes));
  return new Set(top === 0 ? [] : options.filter((o) => o.votes === top).map((o) => o.id));
}

/**
 * The option the organiser's winner sheet starts on: most votes, ties to the one suggested first (the order the
 * API lists them in, the same rule auto-lock uses). `needsVotes` leaves an optional pick empty until someone votes.
 */
export function defaultPick(options: readonly ProposalOption[], needsVotes = false): string | null {
  let best: ProposalOption | null = null;
  for (const o of options) if (!best || o.votes > best.votes) best = o;
  if (!best || (needsVotes && best.votes === 0)) return null;
  return best.id;
}

/** Overlapping faces; decorative (the row or line beside it names the people or the count). */
export function AvatarStack({
  people,
  max = 3,
  size = 22,
  extra = 0,
}: {
  people: readonly PersonCard[];
  max?: number;
  size?: number;
  /** People not in `people` (the API sends a sample) to count in the "+N". */
  extra?: number;
}) {
  const theme = useTheme();
  const shown = people.slice(0, max);
  const more = people.length - shown.length + extra;
  if (shown.length === 0) return null;
  return (
    <View
      style={styles.stack}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {shown.map((p, i) => (
        <View
          key={p.id}
          style={[
            styles.stackItem,
            {
              marginLeft: i === 0 ? 0 : -size / 3,
              borderRadius: size,
              borderColor: theme.colors.surface,
            },
          ]}
        >
          <Avatar photo={p.photo} name={p.displayName} size={size} />
        </View>
      ))}
      {more > 0 ? (
        <Text variant="caption" tone="muted" style={styles.more}>
          {`+${String(more)}`}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One option in a poll, WhatsApp style (D-224): a check circle (your vote), the option, a bar filled by its share of
 * the section's votes, the count and a few voters. The whole row is the control.
 */
function PollOptionRow({
  option,
  text,
  detail,
  share,
  leading,
  canVote,
  onToggle,
}: {
  option: ProposalOption;
  text: string;
  detail: string | null;
  share: number;
  leading: boolean;
  canVote: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const checked = option.mine;
  const label = [
    text,
    t('proposals.votes', { count: option.votes }),
    leading ? t('proposals.leading') : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !canVote }}
      accessibilityLabel={label}
      accessibilityHint={
        canVote ? t(checked ? 'proposals.unvoteHint' : 'proposals.voteHint') : undefined
      }
      disabled={!canVote}
      onPress={onToggle}
      testID={`option-${option.id}`}
      style={[styles.option, { minHeight: theme.minTouchTarget }]}
    >
      <View style={styles.optionRow}>
        <View
          style={[
            styles.tick,
            {
              borderColor: checked ? theme.colors.primary : theme.colors.textMuted,
              backgroundColor: checked ? theme.colors.primary : 'transparent',
              opacity: canVote || checked ? 1 : 0.5,
            },
          ]}
        >
          {checked ? (
            <Icon icon={Check} size={14} color={theme.colors.onPrimary} strokeWidth={3} />
          ) : null}
        </View>
        <View style={styles.optionBody}>
          <View style={styles.optionTitle}>
            <Text variant="label" style={styles.grow}>
              {text}
            </Text>
            {leading ? (
              <Pill label={t('proposals.leading')} tone="primary" testID={`leading-${option.id}`} />
            ) : null}
          </View>
          {detail ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        <Text variant="label" tone="muted">
          {String(option.votes)}
        </Text>
      </View>
      <View style={styles.barRow}>
        <View style={[styles.track, { backgroundColor: theme.colors.border }]}>
          <View
            style={[
              styles.fill,
              {
                width: `${String(Math.round(share * 100))}%`,
                backgroundColor: leading ? theme.colors.primary : theme.colors.textMuted,
              },
            ]}
          />
        </View>
        <AvatarStack
          people={option.voters}
          extra={Math.max(0, option.votes - option.voters.length)}
        />
      </View>
    </Pressable>
  );
}

/** A poll card for one kind of option (When / Where / What). */
export function PollSection({
  kind,
  title,
  options,
  canVote,
  addLabel,
  onToggle,
  onAdd,
}: {
  kind: ProposalOptionKind;
  title: string;
  options: readonly ProposalOption[];
  canVote: boolean;
  /** Shown (as "+ Suggest a …") while suggestions are open. */
  addLabel: string | null;
  onToggle: (o: ProposalOption) => void;
  onAdd: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const total = options.reduce((s, o) => s + o.votes, 0);
  const leaders = leaderIds(options);
  return (
    <Card testID={`poll-${kind}`} style={styles.card}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {options.length === 0 ? <Text tone="muted">{t('proposals.noOptions')}</Text> : null}
      {options.map((o) => (
        <PollOptionRow
          key={o.id}
          option={o}
          text={optionText(o, i18n.language)}
          detail={kind === 'place' ? o.address : null}
          share={total === 0 ? 0 : o.votes / total}
          leading={leaders.has(o.id)}
          canVote={canVote}
          onToggle={() => {
            onToggle(o);
          }}
        />
      ))}
      {addLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          onPress={onAdd}
          testID={`add-${kind}`}
          style={[styles.add, { minHeight: theme.minTouchTarget }]}
        >
          <Icon icon={Plus} size={18} color={theme.colors.primary} />
          <Text variant="label" tone="primary">
            {addLabel}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

/** A radio row in the organiser's "Pick the winner" sheet. */
export function WinnerRow({
  label,
  votes,
  selected,
  onSelect,
  testID,
}: {
  label: string;
  votes: number | null;
  selected: boolean;
  onSelect: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const a11y = votes === null ? label : `${label}, ${t('proposals.votes', { count: votes })}`;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={a11y}
      onPress={onSelect}
      testID={testID}
      style={[styles.optionRow, styles.winner, { minHeight: theme.minTouchTarget }]}
    >
      <View
        style={[
          styles.radio,
          { borderColor: selected ? theme.colors.primary : theme.colors.textMuted },
        ]}
      >
        {selected ? <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} /> : null}
      </View>
      <Text style={styles.grow}>{label}</Text>
      {votes !== null ? (
        <Text variant="caption" tone="muted">
          {t('proposals.votes', { count: votes })}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  option: { paddingVertical: 8, gap: 6, justifyContent: 'center' },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionBody: { flex: 1, gap: 2 },
  optionTitle: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  grow: { flexShrink: 1 },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 32 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  stack: { flexDirection: 'row', alignItems: 'center' },
  stackItem: { borderWidth: 2, overflow: 'hidden' },
  more: { marginLeft: 4 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  winner: { paddingVertical: 6 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
