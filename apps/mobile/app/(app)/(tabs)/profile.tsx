import { ageInYears } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { BackButton } from '../../../components/BackButton';
import { ProfileCard } from '../../../components/ProfileCard';
import { StreakCard } from '../../../components/engagement/StreakCard';
import { PlanRail } from '../../../components/explore/PlanRail';
import {
  Award,
  ChevronRight,
  Gear,
  type GlyphIcon,
  Link,
  Repeat,
  Send,
  Shield,
  Ticket,
  ShareIcon,
  Trophy,
} from '../../../components/icons';
import {
  Button,
  ErrorState,
  FadeIn,
  Icon,
  IconButton,
  LoadingState,
  Screen,
  Text,
} from '../../../components/ui';
import { useFlag } from '../../../src/features/app-config/use-flag';
import { useMyEvents } from '../../../src/features/events/api';
import { useMe } from '../../../src/features/me/api';
import { shareLinks, shareText } from '../../../src/features/share/share';
import { flatten } from '../../../src/features/social/api';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme } from '../../../src/theme/theme';

/** Matches the Screen's side padding so rails run edge to edge. */
const GUTTER = 20;

type Shortcut = {
  path: '/invites' | '/hosting' | '/badges' | '/challenges' | '/recaps' | '/referrals' | '/safety';
  label: string;
  icon: GlyphIcon;
  testID: string;
  on: boolean;
};

/**
 * Your profile (F-ACC-05, D-200): back, share and settings as small header buttons; your photos, name and
 * details as others see them; one clear "Edit profile"; your streak and next plans; then everything else as
 * grouped rows (icon, label, chevron), like a settings list.
 */
export default function MyProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useMe();
  const upcoming = useMyEvents('upcoming');
  const flags = {
    challenges: useFlag('challenges'),
    recaps: useFlag('recaps'),
    referrals: useFlag('referrals'),
  };
  if (me.isPending) {
    return (
      <Screen testID="my-profile">
        <LoadingState />
      </Screen>
    );
  }
  if (me.isError) {
    return (
      <Screen testID="my-profile">
        <ErrorState
          message={errorMessage(t, me.error) ?? undefined}
          onRetry={() => void me.refetch()}
        />
      </Screen>
    );
  }
  const m = me.data;
  const plans = flatten(upcoming.data);
  const groups: { title: string; items: Shortcut[] }[] = [
    {
      title: t('profile.uiGroupActivity'),
      items: [
        {
          path: '/hosting',
          label: t('hosting.title'),
          icon: Ticket,
          testID: 'open-hosting',
          on: true,
        },
        { path: '/badges', label: t('badges.title'), icon: Award, testID: 'open-badges', on: true },
        {
          path: '/challenges',
          label: t('challenges.title'),
          icon: Trophy,
          testID: 'open-challenges',
          on: flags.challenges,
        },
        {
          path: '/recaps',
          label: t('recap.title'),
          icon: Repeat,
          testID: 'open-recaps',
          on: flags.recaps,
        },
      ],
    },
    {
      title: t('profile.uiGroupFriends'),
      items: [
        {
          path: '/invites',
          label: t('profile.invites'),
          icon: Send,
          testID: 'open-invites',
          on: true,
        },
        {
          path: '/referrals',
          label: t('referrals.title'),
          icon: Link,
          testID: 'open-referrals',
          on: flags.referrals,
        },
      ],
    },
    {
      title: t('profile.uiGroupSupport'),
      items: [
        {
          path: '/safety',
          label: t('safety.title'),
          icon: Shield,
          testID: 'open-safety',
          on: true,
        },
      ],
    },
  ];

  return (
    <Screen testID="my-profile">
      <View style={styles.header}>
        <BackButton testID="profile-back" />
        <View style={styles.grow} />
        <IconButton
          icon={<Icon icon={ShareIcon} size={18} />}
          label={t('share.shareProfile')}
          onPress={() =>
            void shareText(t('share.profileMessage', { url: shareLinks.profile(m.id) }))
          }
          testID="share-my-profile"
        />
        <IconButton
          icon={<Icon icon={Gear} size={18} />}
          label={t('nav.settings')}
          onPress={() => {
            router.push('/settings');
          }}
          testID="open-settings"
        />
      </View>
      <FadeIn style={styles.top}>
        <ProfileCard
          displayName={m.displayName ?? ''}
          age={m.dateOfBirth ? ageInYears(m.dateOfBirth, new Date()) : null}
          subtitle={m.pronouns}
          bio={m.bio}
          photos={m.photos.flatMap((p) => (p.urls ? [p.urls] : []))}
          interests={m.interests}
          customInterests={m.customInterests}
          vibeTags={m.vibeTags}
          stats={m.stats}
          verified={m.verified}
        />
        <Button
          label={t('profile.edit')}
          onPress={() => {
            router.push('/profile-edit');
          }}
          testID="edit-profile"
        />
      </FadeIn>
      <StreakCard />
      {plans.length > 0 ? (
        <PlanRail
          railKey="profile-upcoming"
          title={t('events.upcoming')}
          items={plans}
          gutter={GUTTER}
          onOpen={(e) => {
            router.push({ pathname: '/events/[id]', params: { id: e.id } });
          }}
        />
      ) : null}
      {groups.map((g) => {
        const items = g.items.filter((s) => s.on);
        if (items.length === 0) return null;
        return (
          <RowGroup key={g.title} title={g.title}>
            {items.map((s, i) => (
              <ShortcutRow
                key={s.path}
                label={s.label}
                icon={s.icon}
                testID={s.testID}
                first={i === 0}
                onPress={() => {
                  router.push(s.path);
                }}
              />
            ))}
          </RowGroup>
        );
      })}
    </Screen>
  );
}

function RowGroup({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.group}>
      <Text variant="label" tone="muted" accessibilityRole="header">
        {title}
      </Text>
      <View
        style={[
          styles.groupBox,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radii.md,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function ShortcutRow({
  label,
  icon,
  testID,
  first,
  onPress,
}: {
  label: string;
  icon: GlyphIcon;
  testID: string;
  first: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('a11y.opensScreen', { screen: label })}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.minTouchTarget + 8,
          backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
        },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: theme.colors.surfaceAlt }]}>
        <Icon icon={icon} size={18} color={theme.colors.text} />
      </View>
      <View
        style={[
          styles.rowBody,
          first
            ? null
            : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
        ]}
      >
        <Text style={styles.grow} numberOfLines={2}>
          {label}
        </Text>
        <Icon icon={ChevronRight} size={16} color={theme.colors.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  top: { gap: 16 },
  group: { gap: 8 },
  groupBox: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'stretch', paddingLeft: 14 },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 14,
    paddingVertical: 12,
  },
});
