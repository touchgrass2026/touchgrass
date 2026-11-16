import { type EventDetail, LIMITS } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useGotHome, useGotHomeRequest } from '../src/features/safety/api';
import { GotHomePrompt } from './GotHomePrompt';
import { SwitchRow, Text } from './ui';

/**
 * "Got home safe?" on the plan screen (D-212). Before the plan ends, people going can ask to be checked on
 * (late plans are asked about anyway while the Safety centre setting is on). Once it has ended, people who
 * checked in get the question right here as well as by push.
 */
export function GotHomeSection({ event, now }: { event: EventDetail; now: number }) {
  const { t } = useTranslation();
  const v = event.viewer;
  const seated = v.rsvp === 'going' || v.rsvp === 'checked_in';
  const ends = new Date(event.endsAt).getTime();
  const open =
    seated && event.status !== 'cancelled' && now < ends + LIMITS.safety.gotHome.windowMs;
  const q = useGotHome(event.id, open);
  const request = useGotHomeRequest(event.id);
  if (!open || !q.data) return null;
  const s = q.data;
  if (now >= ends) {
    // After the plan: only the open question (or the answer just given on this screen).
    if (!s.due && !s.askAgainAt && !s.homeAt) return null;
    return <GotHomePrompt status={s} testID="event-got-home" />;
  }
  return (
    <View style={{ gap: 6 }} testID="event-got-home-ask">
      {s.late && s.willAsk && !s.requested ? (
        <Text tone="muted" testID="event-got-home-late">
          {t('safety.gotHome.lateNote')}
        </Text>
      ) : (
        <SwitchRow
          label={t('safety.gotHome.askLabel')}
          hint={t('safety.gotHome.askHint')}
          value={s.requested}
          disabled={request.isPending}
          onChange={(ask) => {
            request.mutate(ask);
          }}
          testID="event-got-home-toggle"
        />
      )}
    </View>
  );
}
