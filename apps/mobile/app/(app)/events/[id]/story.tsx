import type { EventDetail } from '@touchgrass/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StoryBackgroundPicker } from '../../../../components/StoryBackgroundPicker';
import {
  type StoryBackground,
  StoryCard,
  type StoryCardRef,
} from '../../../../components/StoryCard';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../../../components/ui';
import { useTrack } from '../../../../src/features/analytics/analytics';
import { useEvent, useInviteLink } from '../../../../src/features/events/api';
import { formatWhen, locationLabel } from '../../../../src/features/events/format';
import { shareStory } from '../../../../src/features/share/share';
import { errorMessage } from '../../../../src/lib/errors';

/** The plan's own look first: its cover photo, else its category artwork. */
function defaultBackground(e: EventDetail): StoryBackground {
  return e.cover
    ? { kind: 'photo', source: 'cover', uri: e.cover.lg }
    : { kind: 'art', category: e.category };
}

/** People on the plan can invite: their card links back with their invite token, so joins count for them. */
const canInvite = (e: EventDetail): boolean =>
  e.status === 'published' &&
  (e.viewer.isHost || e.viewer.rsvp === 'going' || e.viewer.rsvp === 'checked_in');

/**
 * A plan as a 9:16 story card (F-GRW-02), mystery-safe: it shows what this viewer may see. Any background
 * (D-212): the cover, the artwork, the member's own photo (kept on the phone), gradients or a colour. The
 * picked one is what gets captured and shared.
 */
export default function EventStoryScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useEvent(id);
  const card = useRef<StoryCardRef>(null);
  const track = useTrack();
  const invite = useInviteLink(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<StoryBackground | null>(null);
  const inviting = q.data ? canInvite(q.data) : false;
  const { mutate: mintLink } = invite;
  useEffect(() => {
    // One invite link per visit; without one the card shows the plan's public link.
    if (inviting) mintLink();
  }, [inviting, mintLink]);

  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const e = q.data;
  const background = chosen ?? defaultBackground(e);
  const link = invite.data?.url ?? e.shareUrl;
  const share = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      track('share_tapped', { target: 'event_story' });
      await shareStory(card);
    } catch {
      setError(t('states.errorBody'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen testID="event-story-screen">
      <StoryCard
        ref={card}
        title={e.title}
        lines={[formatWhen(e.startsAt, i18n.language, e.timezone), locationLabel(t, e.location)]}
        footer={link.replace(/^https?:\/\//, '')}
        background={background}
        testID="event-story-card"
      />
      <Button
        label={t('share.shareStory')}
        loading={busy}
        onPress={() => void share()}
        testID="event-story-share"
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <StoryBackgroundPicker
        value={background}
        onChange={setChosen}
        coverUri={e.cover?.lg ?? null}
        category={e.category}
      />
    </Screen>
  );
}
