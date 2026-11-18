import type { ProposalDetail, ProposalOption, ProposalOptionKind } from '@touchgrass/shared';
import { LIMITS } from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Avatar } from '../../../components/Avatar';
import { DateField, Sheet, TimeField } from '../../../components/DateTimeFields';
import {
  AvatarStack,
  defaultPick,
  optionText,
  PollSection,
  WinnerRow,
} from '../../../components/engagement/ProposalPoll';
import { type PickedPlace, VenuePicker } from '../../../components/engagement/VenuePicker';
import { Calendar, Check, MapPin, Sprout } from '../../../components/icons';
import {
  Button,
  Card,
  ErrorState,
  IconText,
  LoadingState,
  Pill,
  Pressable,
  Screen,
  Text,
  TextField,
} from '../../../components/ui';
import {
  useAddOption,
  useCancelProposal,
  useLockProposal,
  useProposal,
  useVote,
} from '../../../src/features/engagement/api';
import { useEvent } from '../../../src/features/events/api';
import { formatWhen, istToIso, locationLabel } from '../../../src/features/events/format';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme } from '../../../src/theme/theme';

/**
 * A plan up for a vote (F-ENG-03, D-224): everyone votes on times, places and activities like a chat poll; the
 * organiser picks the winner in one sheet and it becomes a plan.
 */
export default function ProposalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const q = useProposal(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  return <ProposalView p={q.data} />;
}

const SECTIONS: { kind: ProposalOptionKind; title: string; add: string }[] = [
  { kind: 'time', title: 'proposals.times', add: 'proposals.addTime' },
  { kind: 'place', title: 'proposals.places', add: 'proposals.addPlace' },
  { kind: 'activity', title: 'proposals.activities', add: 'proposals.addActivity' },
];

function ProposalView({ p }: { p: ProposalDetail }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const vote = useVote(p.id);
  const cancel = useCancelProposal(p.id);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ProposalOptionKind | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const votingOpen = p.status === 'open' && Date.now() < Date.parse(p.deadline);
  const awaitingPick = p.status === 'open' && !votingOpen;
  const deadline = formatWhen(p.deadline, i18n.language);
  const everyone = [p.creator, ...p.invitees];
  // `voters` per option is a sample: the count comes from the API, the sample only fills in for an older one.
  const sampled = new Set(p.options.flatMap((o) => o.voters.map((v) => v.id))).size;
  const voted = Math.min(everyone.length, Math.max(p.voterCount, sampled));

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorMessage(t, err));
      return false;
    }
  };
  const toggle = (o: ProposalOption): void => {
    void run(() => vote.mutateAsync({ optionId: o.id, vote: !o.mine }));
  };

  const status =
    p.status === 'locked'
      ? t('proposals.statusConfirmed')
      : p.status === 'cancelled'
        ? t('proposals.statusCalledOff')
        : votingOpen
          ? t('proposals.statusVoting')
          : t('proposals.statusClosed');

  return (
    <Screen testID="proposal-screen">
      <Card testID="proposal-header">
        <Text variant="title" accessibilityRole="header">
          {p.title}
        </Text>
        <View style={styles.row}>
          <Avatar photo={p.creator.photo} name={p.creator.displayName} size={28} />
          <Text tone="muted" style={styles.grow}>
            {t('proposals.suggestedBy', { name: p.creator.displayName })}
          </Text>
        </View>
        <View style={styles.row}>
          <Pill
            label={status}
            tone={p.status === 'locked' ? 'primary' : 'glass'}
            testID="proposal-status"
          />
          {votingOpen ? (
            <Text variant="caption" tone="muted">
              {t('proposals.closesAt', { time: deadline })}
            </Text>
          ) : null}
        </View>
        <View style={styles.row}>
          <AvatarStack people={everyone} max={5} size={28} />
          <Text variant="caption" tone="muted" testID="proposal-voted">
            {t('proposals.votedCount', { voted, total: everyone.length })}
          </Text>
        </View>
        {p.status === 'open' ? (
          <Text>
            {p.viewerIsCreator
              ? t('proposals.explainerOrganiser')
              : t('proposals.explainer', { name: p.creator.displayName })}
            {votingOpen && p.autoLock ? ` ${t('proposals.autoLockNote')}` : ''}
          </Text>
        ) : null}
        {p.held ? (
          <Text tone="muted" accessibilityRole="alert" testID="proposal-held">
            {t('moderation.held')}
          </Text>
        ) : null}
      </Card>

      {p.status === 'locked' ? <ConfirmedCard eventId={p.eventId} /> : null}
      {p.status === 'cancelled' ? (
        <Card testID="proposal-called-off">
          <Text variant="heading" accessibilityRole="header">
            {t('proposals.calledOffTitle')}
          </Text>
          <Text tone="muted">
            {p.cancelledReason === 'NO_OPTIONS'
              ? t('proposals.cancelledNoOptions')
              : p.cancelledReason === 'BY_CREATOR'
                ? t('proposals.cancelledByCreator')
                : t('proposals.cancelled')}
          </Text>
        </Card>
      ) : null}
      {awaitingPick ? (
        <Card testID="proposal-waiting">
          <Text accessibilityLiveRegion="polite">
            {p.viewerIsCreator
              ? t('proposals.waitingYou')
              : t('proposals.waiting', { name: p.creator.displayName })}
          </Text>
        </Card>
      ) : null}

      {SECTIONS.map((s) => (
        <PollSection
          key={s.kind}
          kind={s.kind}
          title={t(s.title)}
          options={p.options.filter((o) => o.kind === s.kind)}
          canVote={votingOpen}
          addLabel={votingOpen ? t(s.add) : null}
          onToggle={toggle}
          onAdd={() => {
            setError(null);
            setAdding(s.kind);
          }}
        />
      ))}

      {error && !adding && !picking ? (
        <Text tone="danger" accessibilityRole="alert" testID="proposal-error">
          {error}
        </Text>
      ) : null}

      {p.viewerIsCreator && p.status === 'open' ? (
        <View style={styles.actions}>
          <Button
            label={t('proposals.makePlan')}
            disabled={!p.canLock}
            onPress={() => {
              setError(null);
              setPicking(true);
            }}
            testID="proposal-make-plan"
          />
          {!p.canLock ? (
            <Text variant="caption" tone="muted" style={styles.center}>
              {t('proposals.makePlanNeeds')}
            </Text>
          ) : null}
          {confirmCancel ? (
            <Card testID="proposal-cancel-confirm-card">
              <Text accessibilityRole="alert">{t('proposals.callOffConfirm')}</Text>
              <View style={styles.buttons}>
                <Button
                  label={t('proposals.keepIt')}
                  variant="secondary"
                  style={styles.grow}
                  onPress={() => {
                    setConfirmCancel(false);
                  }}
                  testID="proposal-cancel-keep"
                />
                <Button
                  label={t('proposals.confirmCallOff')}
                  variant="danger"
                  style={styles.grow}
                  loading={cancel.isPending}
                  onPress={() =>
                    void run(() => cancel.mutateAsync()).then((ok) => {
                      if (ok) setConfirmCancel(false);
                    })
                  }
                  testID="proposal-cancel-confirm"
                />
              </View>
            </Card>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('proposals.callOff')}
              onPress={() => {
                setConfirmCancel(true);
              }}
              testID="proposal-cancel"
              style={[styles.quiet, { minHeight: theme.minTouchTarget }]}
            >
              <Text variant="label" tone="danger">
                {t('proposals.callOff')}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {adding ? (
        <SuggestSheet
          p={p}
          kind={adding}
          onClose={() => {
            setAdding(null);
          }}
        />
      ) : null}
      {picking ? (
        <WinnerSheet
          p={p}
          votingOpen={votingOpen}
          onClose={() => {
            setPicking(false);
          }}
        />
      ) : null}
    </Screen>
  );
}

/** "+ Suggest a time / place / activity": pickers in a sheet, Add in its footer. */
function SuggestSheet({
  p,
  kind,
  onClose,
}: {
  p: ProposalDetail;
  kind: ProposalOptionKind;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const add = useAddOption(p.id);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [label, setLabel] = useState('');
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startsAt = kind === 'time' ? istToIso(date, time) : null;
  const ready =
    kind === 'time'
      ? startsAt !== null
      : kind === 'place'
        ? place !== null
        : label.trim().length >= 2;
  const submit = async (): Promise<void> => {
    setError(null);
    try {
      if (kind === 'time' && startsAt)
        await add.mutateAsync({ kind: 'time', startsAt, durationMinutes: 120 });
      else if (kind === 'place' && place)
        await add.mutateAsync({ kind: 'place', where: place.where });
      else if (kind === 'activity')
        await add.mutateAsync({ kind: 'activity', label: label.trim(), interestId: null });
      onClose();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  const title =
    kind === 'time'
      ? t('proposals.addTime')
      : kind === 'place'
        ? t('proposals.addPlace')
        : t('proposals.addActivity');
  return (
    <Sheet
      title={title}
      onClose={onClose}
      testID="option-sheet"
      footer={
        <Button
          label={t('proposals.add')}
          disabled={!ready}
          loading={add.isPending}
          onPress={() => void submit()}
          testID="option-save"
        />
      }
    >
      {kind === 'time' ? (
        <>
          <DateField
            label={t('events.dateLabel')}
            value={date}
            onChange={setDate}
            testID="option-date"
          />
          <TimeField
            label={t('events.timeLabel')}
            value={time}
            onChange={setTime}
            testID="option-time"
          />
        </>
      ) : kind === 'place' ? (
        <VenuePicker picked={place} onPick={setPlace} testID="option-place" />
      ) : (
        <TextField
          label={t('proposals.activityLabel')}
          value={label}
          onChangeText={setLabel}
          maxLength={LIMITS.proposals.optionLabelMaxLength}
          testID="option-activity"
        />
      )}
      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="option-error">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

/** The organiser's "Pick the winner" sheet, starting on the leading time, place and activity. */
function WinnerSheet({
  p,
  votingOpen,
  onClose,
}: {
  p: ProposalDetail;
  votingOpen: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lock = useLockProposal(p.id);
  const of = (kind: ProposalOptionKind) => p.options.filter((o) => o.kind === kind);
  const [time, setTime] = useState(() => defaultPick(of('time')));
  const [place, setPlace] = useState(() => defaultPick(of('place')));
  const [activity, setActivity] = useState(() => defaultPick(of('activity'), true));
  const [error, setError] = useState<string | null>(null);
  const confirm = async (): Promise<void> => {
    if (!time || !place) return;
    setError(null);
    try {
      await lock.mutateAsync({
        timeOptionId: time,
        placeOptionId: place,
        activityOptionId: activity,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  const group = (
    kind: ProposalOptionKind,
    title: string,
    value: string | null,
    set: (id: string | null) => void,
  ) => (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={title}>
      <Text variant="overline" tone="muted">
        {title}
      </Text>
      {of(kind).map((o) => (
        <WinnerRow
          key={o.id}
          label={optionText(o, i18n.language)}
          votes={o.votes}
          selected={value === o.id}
          onSelect={() => {
            set(o.id);
          }}
          testID={`pick-${o.id}`}
        />
      ))}
      {kind === 'activity' ? (
        <WinnerRow
          label={t('proposals.noActivity')}
          votes={null}
          selected={value === null}
          onSelect={() => {
            set(null);
          }}
          testID="pick-no-activity"
        />
      ) : null}
    </View>
  );
  return (
    <Sheet
      title={t('proposals.pickWinner')}
      onClose={onClose}
      testID="proposal-winner-sheet"
      footer={
        <Button
          label={t('proposals.makePlan')}
          disabled={!time || !place}
          loading={lock.isPending}
          onPress={() => void confirm()}
          testID="proposal-lock"
        />
      }
    >
      <Text tone="muted">
        {votingOpen
          ? t('proposals.decideNow', { time: formatWhen(p.deadline, i18n.language) })
          : t('proposals.pickWinnerIntro')}
      </Text>
      {group('time', t('proposals.times'), time, setTime)}
      {group('place', t('proposals.places'), place, setPlace)}
      {of('activity').length > 0
        ? group('activity', t('proposals.activityOptional'), activity, setActivity)
        : null}
      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="proposal-lock-error">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

/** Locked: the plan it became and a way in. */
function ConfirmedCard({ eventId }: { eventId: string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  return (
    <Card testID="proposal-confirmed" style={{ borderColor: theme.colors.primary }}>
      <IconText icon={Check} variant="heading" accessibilityRole="header">
        {t('proposals.confirmedTitle')}
      </IconText>
      <Text tone="muted">{t('proposals.confirmedBody')}</Text>
      {eventId ? <PlanFacts eventId={eventId} /> : null}
      {eventId ? (
        <Button
          label={t('proposals.openPlan')}
          onPress={() => {
            router.push({ pathname: '/events/[id]', params: { id: eventId } });
          }}
          testID="proposal-open-plan"
        />
      ) : null}
    </Card>
  );
}

/** The winning time, place and what, read from the plan itself (it is the source of truth once locked). */
function PlanFacts({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const event = useEvent(eventId);
  const e = event.data;
  if (!e) return null;
  return (
    <View style={styles.group} testID="proposal-confirmed-facts">
      <IconText icon={Calendar}>{formatWhen(e.startsAt, i18n.language, e.timezone)}</IconText>
      <IconText icon={MapPin}>{locationLabel(t, e.location)}</IconText>
      <IconText icon={Sprout}>{e.title}</IconText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  grow: { flexGrow: 1, flexShrink: 1 },
  actions: { gap: 8 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  center: { textAlign: 'center' },
  quiet: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingHorizontal: 16,
  },
  group: { gap: 4 },
});
