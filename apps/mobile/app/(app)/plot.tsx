import {
  CreateEventBody,
  EventDetail,
  type EventVisibility,
  type EventWhere,
  feeBreakdown,
  InviteUsersResult,
  type GeoPoint,
  LIMITS,
  type PersonCard,
  UpdateEventBody,
} from '@touchgrass/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  Keyboard,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, type MapPressEvent } from 'react-native-maps';
import { ChipGroup } from '../../components/ChipGroup';
import { CoverPicker, type CoverValue } from '../../components/CoverPicker';
import { DateField, Sheet, TimeField } from '../../components/DateTimeFields';
import {
  Calendar,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  Gear,
  Grid,
  MapPin,
  People,
  Ticket,
  Users,
  Zap,
} from '../../components/icons';
import { interestOptions } from '../../components/interest-options';
import { PickList } from '../../components/PickList';
import { PlaceRow } from '../../components/plot/PlaceRow';
import { CoHostsSheet } from '../../components/plot/CoHostsSheet';
import {
  GroupNote,
  RowError,
  RowIcon,
  SettingBlock,
  SettingRow,
  SettingsGroup,
} from '../../components/plot/Settings';
import { SegmentedTabs } from '../../components/SegmentedTabs';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  FadeIn,
  Icon,
  LoadingState,
  Screen,
  staggerDelay,
  SwitchRow,
  Text,
  TextField,
} from '../../components/ui';
import { localized, useInterests, useVibeTags } from '../../src/features/catalog/api';
import {
  EVENT_KEYS,
  useCreateEvent,
  useEvent,
  useReverseGeocode,
  useSavedVenues,
  useUpdateEvent,
  useVenueFromPlace,
  useVenueSearch,
} from '../../src/features/events/api';
import { isoToIst, istToIso, quickPick } from '../../src/features/events/format';
import { useHostStatus } from '../../src/features/payments/api';
import { money } from '../../src/features/payments/format';
import { ApiError } from '../../src/lib/api-client';
import { errorMessage } from '../../src/lib/errors';
import { useApi } from '../../src/providers/api-context';
import { fontFamilyFor } from '../../src/theme/fonts';
import { useTheme } from '../../src/theme/theme';

const HYDERABAD: GeoPoint = { lat: 17.385, lng: 78.4867 };
const Empty = z.undefined();
const VISIBILITIES: EventVisibility[] = [
  'public',
  'friends_of_friends',
  'invite_only',
  'approval',
  'women_only',
  'men_only',
  'balanced',
];
const DURATIONS = [1, 1.5, 2, 3, 4];
const REVEAL_HOURS = [1, 2, 4, 24];
const BALANCED_PCTS = [50, 60, 70];

interface Picked {
  where: EventWhere;
  label: string;
}

interface FormState {
  title: string;
  description: string;
  categoryId: string | null;
  vibeTagIds: string[];
  date: string;
  time: string;
  durationHours: string;
  capacity: string;
  visibility: EventVisibility;
  balancedPct: number;
  soloFriendly: boolean;
  smallGroup: boolean;
  mystery: boolean;
  revealHours: number;
  allowPlusOnes: boolean;
  indoor: boolean;
  stepFree: boolean;
  accessibleRestroom: boolean;
  quietSpace: boolean;
  /** Free or paid (paid only for approved hosts). */
  paid: boolean;
  /** Ticket price in rupees (text), '0' for free. */
  price: string;
  refundKind: 'full' | 'partial' | 'none';
  cutoffHours: string;
  partialPct: string;
  /** Group chat for people pulling up (D-156). */
  chatEnabled: boolean;
}

/** The sheets the setting rows open. */
type SheetName =
  'category' | 'duration' | 'where' | 'who' | 'capacity' | 'coHosts' | 'price' | 'vibes' | 'reveal';

/** A co-host who could not be added (or removed), with the reason in plain words. */
interface HostFailure {
  name: string;
  reason: string;
}

/** Validation keys each row shows (anything else is shown above the main button). */
const ROW_KEYS = new Set([
  'title',
  'description',
  'categoryId',
  'date',
  'startsAt',
  'endsAt',
  'where',
  'capacity',
  'minGroupSize',
  'visibility',
  'balancedMaxSharePct',
  'pricePaise',
  'refundPolicy',
  'vibeTagIds',
  'mysteryRevealMinutesBefore',
]);

/** Editing a field also clears the server-side names of the same error. */
const CLEARS: Partial<Record<keyof FormState, string[]>> = {
  date: ['startsAt'],
  time: ['startsAt', 'date'],
  durationHours: ['endsAt'],
  capacity: ['minGroupSize'],
  smallGroup: ['capacity'],
  visibility: ['balancedMaxSharePct'],
  balancedPct: ['balancedMaxSharePct'],
  paid: ['pricePaise', 'refundPolicy'],
  price: ['pricePaise'],
  refundKind: ['refundPolicy'],
  cutoffHours: ['refundPolicy'],
  partialPct: ['refundPolicy'],
  revealHours: ['mysteryRevealMinutesBefore'],
};

function initialState(): FormState {
  const pick = quickPick('tomorrow');
  return {
    title: '',
    description: '',
    categoryId: null,
    vibeTagIds: [],
    date: pick.date,
    time: pick.time,
    durationHours: '2',
    capacity: '8',
    visibility: 'public',
    balancedPct: 60,
    soloFriendly: true,
    smallGroup: false,
    mystery: false,
    revealHours: 2,
    allowPlusOnes: false,
    indoor: false,
    stepFree: false,
    accessibleRestroom: false,
    quietSpace: false,
    paid: false,
    price: '0',
    refundKind: 'full',
    cutoffHours: '24',
    partialPct: '50',
    chatEnabled: true,
  };
}

function fromEvent(e: EventDetail): FormState {
  const start = isoToIst(e.startsAt);
  const hours = (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 3_600_000;
  return {
    title: e.title,
    description: e.description,
    categoryId: e.category?.id ?? null,
    vibeTagIds: e.vibeTags.map((v) => v.id),
    date: start.date,
    time: start.time,
    durationHours: String(Math.round(hours * 10) / 10),
    capacity: String(e.capacity),
    visibility: e.visibility,
    balancedPct: e.balancedMaxSharePct ?? 60,
    soloFriendly: e.soloFriendly,
    smallGroup: e.smallGroup,
    mystery: e.mystery,
    revealHours: 2,
    allowPlusOnes: e.allowPlusOnes,
    indoor: e.indoor,
    stepFree: e.accessibility.stepFree,
    accessibleRestroom: e.accessibility.accessibleRestroom,
    quietSpace: e.accessibility.quietSpace,
    paid: e.pricePaise > 0,
    price: String(e.pricePaise / 100),
    refundKind: e.refundPolicy?.kind ?? 'full',
    cutoffHours: String(e.refundPolicy?.cutoffHours ?? 24),
    partialPct: String(e.refundPolicy?.partialPct ?? 50),
    chatEnabled: e.chatEnabled,
  };
}

/**
 * Plot a plan (F-EVT-01/02), also edits (F-EVT-16). One image-led page (D-199): cover photo, the name as a
 * heading, one card of setting rows that open sheets (category, when, where, who, how many, price), details,
 * and "More options" folded away. The main button stays pinned at the bottom.
 */
export default function PlotScreen() {
  const { id, venueId, venueName, inviteUserId } = useLocalSearchParams<{
    id?: string;
    venueId?: string;
    venueName?: string;
    /** "Plan with them" from the free-now strip (F-ENG-01): invited as soon as the plan exists. */
    inviteUserId?: string;
  }>();
  if (id) return <EditLoader id={id} />;
  // Plotting from a place found in search starts with that place picked.
  const initialPick = venueId && venueName ? { where: { venueId }, label: venueName } : null;
  return <PlotForm existing={null} initialPick={initialPick} inviteUserId={inviteUserId ?? null} />;
}

function EditLoader({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useEvent(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  return <PlotForm existing={q.data} initialPick={null} />;
}

function PlotForm({
  existing,
  initialPick,
  inviteUserId = null,
}: {
  existing: EventDetail | null;
  initialPick: Picked | null;
  inviteUserId?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const interests = useInterests();
  const vibes = useVibeTags();
  const saved = useSavedVenues();
  // One key for this form: a second tap (or a retry after a lost response) returns the same plan.
  const [createKey] = useState(() => `plot-${Crypto.randomUUID()}`);
  const scrollRef = useRef<ScrollViewInstance>(null);
  // Cover photo (D-196): sent only when changed, so an edit never drops a cover it did not touch.
  const [cover, setCover] = useState<CoverValue>(() => ({
    id: null,
    uri: existing?.cover?.md ?? null,
  }));
  const [coverTouched, setCoverTouched] = useState(false);
  /** Where the details box starts in the scroll content, to lift it above the keyboard. */
  const detailsY = useRef(0);
  const create = useCreateEvent(createKey);
  const [leaving, setLeaving] = useState(false);
  const { client } = useApi();
  const update = useUpdateEvent(existing?.id ?? '');
  const fromPlace = useVenueFromPlace();
  const host = useHostStatus();
  const canSell = host.data?.canHostPaid === true || (existing?.pricePaise ?? 0) > 0;
  const [form, setForm] = useState<FormState>(() =>
    existing ? fromEvent(existing) : initialState(),
  );
  const [picked, setPicked] = useState<Picked | null>(
    existing?.location.kind === 'exact'
      ? {
          where: {
            point: existing.location.point,
            address: existing.location.address,
            placeName: existing.location.placeName,
          },
          label: existing.location.placeName ?? existing.location.address,
        }
      : initialPick,
  );
  const [whereChanged, setWhereChanged] = useState(false);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [query, setQuery] = useState('');
  const [near, setNear] = useState<GeoPoint>(HYDERABAD);
  const [mapOpen, setMapOpen] = useState(false);
  const [pin, setPin] = useState<GeoPoint | null>(null);
  const [pinAddress, setPinAddress] = useState('');
  /** Whether the address box still holds what the map suggested (so a new suggestion may replace it). */
  const [pinAddressSuggested, setPinAddressSuggested] = useState(true);
  const reverse = useReverseGeocode(mapOpen ? pin : null);
  const qc = useQueryClient();
  // Co-hosts (D-203): only the primary host adds or removes them.
  const canPickCoHosts = existing === null || existing.viewer.hostRole === 'host';
  const [coHosts, setCoHosts] = useState<PersonCard[]>(
    () => existing?.hosts.filter((h) => h.role === 'co_host').map((h) => h.person) ?? [],
  );
  /** Co-host changes that did not go through after the plan was saved. */
  const [hostFailures, setHostFailures] = useState<HostFailure[]>([]);
  /** Set once a new plan exists but some co-hosts could not be added: the page offers to open it. */
  const [created, setCreated] = useState<{ id: string; inviteFailed: boolean } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  // Edits only send the reveal time when the host changed it (the detail view does not expose it).
  const [revealTouched, setRevealTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const session = useMemo(() => Crypto.randomUUID(), []);
  const search = useVenueSearch(query, near, session);

  useEffect(() => {
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return;
      const pos = await Location.getLastKnownPositionAsync();
      if (pos) setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    })();
  }, []);

  // The map's address for a dropped pin fills the box until the host types their own.
  const suggestedAddress = reverse.data?.address ?? null;
  useEffect(() => {
    if (suggestedAddress && pinAddressSuggested) setPinAddress(suggestedAddress);
  }, [suggestedAddress, pinAddressSuggested]);
  const pinOutside = pin !== null && reverse.data?.served === false;

  const clearErrors = (keys: string[]): void => {
    setErrors((e) => {
      const next = { ...e };
      for (const k of keys) next[k] = '';
      return next;
    });
  };
  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
    clearErrors([key, ...(CLEARS[key] ?? [])]);
  };
  const open = (name: SheetName): void => {
    // A field typed in just before would keep the keyboard over the sheet's choices.
    Keyboard.dismiss();
    setSheet(name);
  };
  const close = (): void => {
    setSheet(null);
  };
  const choose = (p: Picked): void => {
    setPicked(p);
    setWhereChanged(true);
    setQuery('');
    setMapOpen(false);
    setSheet(null);
    clearErrors(['where']);
  };

  /** Why a co-host change failed, in words that fit a host adding someone (not someone joining). */
  const hostError = (err: unknown): string =>
    err instanceof ApiError && err.code === 'EVENT_FULL'
      ? t('events.coHostNoSeat')
      : err instanceof ApiError && err.code === 'NOT_FOUND'
        ? t('events.coHostUnavailable')
        : (errorMessage(t, err) ?? t('states.errorBody'));

  /** Adds and removes co-hosts one person at a time; returns who could not be changed, and why. */
  const applyCoHosts = async (
    eventId: string,
    add: PersonCard[],
    remove: PersonCard[],
  ): Promise<HostFailure[]> => {
    const failures: HostFailure[] = [];
    for (const person of add) {
      try {
        await client.request(`/v1/events/${eventId}/hosts`, EventDetail, {
          method: 'POST',
          body: { userId: person.id, role: 'co_host' },
        });
      } catch (err) {
        failures.push({ name: person.displayName, reason: hostError(err) });
      }
    }
    for (const person of remove) {
      try {
        await client.request(`/v1/events/${eventId}/hosts/${person.id}`, Empty, {
          method: 'DELETE',
        });
      } catch (err) {
        failures.push({ name: person.displayName, reason: hostError(err) });
      }
    }
    if (add.length + remove.length > 0)
      await qc.invalidateQueries({ queryKey: EVENT_KEYS.detail(eventId) });
    return failures;
  };

  const openCreated = (id: string, inviteFailed: boolean): void => {
    router.replace({
      pathname: '/events/[id]',
      params: inviteFailed ? { id, notice: 'inviteFailed' } : { id },
    });
  };

  const startsAtIso = istToIso(form.date, form.time);
  // The button wakes up once the plan has what it cannot exist without; the rest is checked on submit.
  const ready =
    form.title.trim().length >= LIMITS.event.titleMinLength &&
    (existing !== null || form.categoryId !== null) &&
    picked !== null &&
    startsAtIso !== null;

  const submit = async (): Promise<void> => {
    setFormError(null);
    setHostFailures([]);
    const startsAt = istToIso(form.date, form.time);
    const hours = Number(form.durationHours);
    if (!startsAt) {
      setErrors({ date: t('events.dateLabel') });
      return;
    }
    if (!picked) {
      setErrors({ where: t('events.pickPlace') });
      return;
    }
    const endsAt = new Date(
      new Date(startsAt).getTime() + (Number.isFinite(hours) ? hours : 0) * 3_600_000,
    ).toISOString();
    const fields = {
      title: form.title,
      description: form.description,
      ...(form.categoryId ? { categoryInterestId: form.categoryId } : {}),
      vibeTagIds: form.vibeTagIds,
      startsAt,
      endsAt,
      capacity: Number(form.capacity),
      ...pricing(),
      visibility: form.visibility,
      balancedMaxSharePct: form.visibility === 'balanced' ? form.balancedPct : null,
      soloFriendly: form.soloFriendly,
      smallGroup: form.smallGroup,
      mystery: form.mystery,
      ...(existing && !revealTouched ? {} : { mysteryRevealMinutesBefore: form.revealHours * 60 }),
      // Paid plans have no +1s: every seat is a ticket.
      allowPlusOnes: paidPlan ? false : form.allowPlusOnes,
      chatEnabled: form.chatEnabled,
      ...(coverTouched ? { coverMediaId: cover.id } : {}),
      indoor: form.indoor,
      accessibility: {
        stepFree: form.stepFree,
        accessibleRestroom: form.accessibleRestroom,
        quietSpace: form.quietSpace,
      },
    };
    const showIssues = (
      issues: readonly { path: readonly PropertyKey[]; message: string }[],
    ): void => {
      const next: Record<string, string> = {};
      let other: string | null = null;
      for (const issue of issues) {
        const raw = String(issue.path[0] ?? 'form');
        const key = raw === 'categoryInterestId' ? 'categoryId' : raw;
        if (ROW_KEYS.has(key)) next[key] = next[key] ?? issue.message;
        else other = other ?? issue.message;
      }
      setErrors(next);
      if (other) setFormError(other);
      // An error inside "More options" must not stay folded away.
      if (next.vibeTagIds || next.mysteryRevealMinutesBefore) setAdvanced(true);
    };
    try {
      if (existing) {
        const parsed = UpdateEventBody.safeParse({
          ...fields,
          ...(whereChanged ? { where: picked.where } : {}),
        });
        if (!parsed.success) {
          showIssues(parsed.error.issues);
          return;
        }
        await update.mutateAsync(parsed.data);
        if (canPickCoHosts) {
          const before = existing.hosts.filter((h) => h.role === 'co_host').map((h) => h.person);
          const failures = await applyCoHosts(
            existing.id,
            coHosts.filter((p) => !before.some((b) => b.id === p.id)),
            before.filter((b) => !coHosts.some((p) => p.id === b.id)),
          );
          // The plan is saved; the page stays so the host can see who did not change and try again.
          if (failures.length > 0) {
            setHostFailures(failures);
            return;
          }
        }
        router.back();
      } else {
        const parsed = CreateEventBody.safeParse({ ...fields, where: picked.where });
        if (!parsed.success) {
          showIssues(parsed.error.issues);
          return;
        }
        setLeaving(true);
        const plan = await create.mutateAsync(parsed.data);
        // The plan exists now; a failed squad invite must not keep the person on the form (a second tap
        // would look like it creates another plan), so it becomes a notice on the plan instead.
        const inviteFailed = inviteUserId
          ? await client
              .request(`/v1/events/${plan.id}/invites`, InviteUsersResult, {
                method: 'POST',
                body: { userIds: [inviteUserId] },
              })
              .then(
                () => false,
                () => true,
              )
          : false;
        // Same for co-hosts: the plan exists, so a co-host who could not be added is listed here with the
        // reason, and the page offers to open the plan instead of publishing again.
        const failures = await applyCoHosts(plan.id, coHosts, []);
        if (failures.length > 0) {
          setHostFailures(failures);
          setCreated({ id: plan.id, inviteFailed });
          setLeaving(false);
          return;
        }
        openCreated(plan.id, inviteFailed);
      }
    } catch (err) {
      setLeaving(false);
      setFormError(errorMessage(t, err));
    }
  };

  /** Price and refund policy (F-PAY-01/02): only approved hosts sell tickets. */
  function pricing(): Record<string, unknown> {
    if (!canSell) return {};
    if (!Number.isFinite(pricePaise) || pricePaise <= 0)
      return { pricePaise: 0, refundPolicy: null };
    return {
      pricePaise,
      allowPlusOnes: false,
      refundPolicy: {
        kind: form.refundKind,
        cutoffHours: Number(form.cutoffHours || '0'),
        partialPct: form.refundKind === 'partial' ? Number(form.partialPct || '0') : null,
      },
    };
  }
  const pricePaise = form.paid ? Math.round(Number(form.price || '0') * 100) : 0;
  const paidPlan = canSell && pricePaise > 0;
  const hostShare =
    paidPlan && host.data
      ? feeBreakdown(pricePaise, host.data.platformFeeBps, host.data.gstBps).hostNetPaise
      : null;

  // Suggestions for what was typed (D-203, was D-157): known venues, then map places, each under a label; the
  // sheet scrolls, so nothing is cut off.
  const typing = query.trim().length >= 2;
  interface Suggestion {
    key: string;
    label: string;
    detail: string;
    testID?: string;
    onPick: () => void;
  }
  const knownSuggestions: Suggestion[] = (search.data?.venues ?? [])
    .slice(0, LIMITS.placeSearch.knownVenues)
    .map((v) => ({
      key: `v-${v.id}`,
      label: v.name,
      detail: v.address,
      testID: `venue-${v.id}`,
      onPick: () => {
        choose({ where: { venueId: v.id }, label: v.name });
      },
    }));
  const mapSuggestions: Suggestion[] = (search.data?.places ?? [])
    .slice(0, LIMITS.placeSearch.mapPlaces)
    .map((p) => ({
      key: `p-${p.placeId}`,
      label: p.primaryText,
      detail: p.secondaryText,
      testID: `place-${p.placeId}`,
      onPick: () => {
        void fromPlace.mutateAsync({ placeId: p.placeId, sessionToken: session }).then(
          (v) => {
            choose({ where: { venueId: v.id }, label: v.name });
          },
          (err: unknown) => {
            setErrors((e) => ({ ...e, where: errorMessage(t, err) ?? '' }));
          },
        );
      },
    }));
  const suggestionCount = knownSuggestions.length + mapSuggestions.length;

  const categoryOptions = interestOptions(interests.data?.items ?? [], t, i18n.language);
  const categoryName = categoryOptions.find((o) => o.id === form.categoryId)?.label ?? null;
  const vibeOptions = (vibes.data?.items ?? []).map((v) => ({
    id: v.id,
    label: localized(v.name, i18n.language),
  }));
  const vibeNames = vibeOptions.filter((o) => form.vibeTagIds.includes(o.id)).map((o) => o.label);
  const optionsOn = [
    form.soloFriendly,
    form.smallGroup,
    form.mystery,
    form.allowPlusOnes && !paidPlan,
    form.indoor,
    form.stepFree,
    form.accessibleRestroom,
    form.quietSpace,
    form.chatEnabled,
  ].filter(Boolean).length;
  const durationText = form.durationHours.trim()
    ? t('events.plotUiHours', { n: form.durationHours.trim() })
    : t('events.plotUiChoose');
  const whoText =
    form.visibility === 'balanced'
      ? `${t('events.visibility.balanced')} · ${String(form.balancedPct)}%`
      : t(`events.visibility.${form.visibility}`);
  const whenError = errors.date || errors.startsAt || null;

  const titleError = errors.title || null;
  const failureList =
    hostFailures.length > 0 ? (
      <View style={styles.failures} accessibilityLiveRegion="assertive" testID="plot-host-failures">
        <Text tone="danger">
          {created ? t('events.coHostsFailedCreate') : t('events.coHostsFailedEdit')}
        </Text>
        {hostFailures.map((f) => (
          <Text key={f.name} tone="danger" variant="caption">
            {t('events.coHostFailed', { name: f.name, reason: f.reason })}
          </Text>
        ))}
      </View>
    ) : null;
  const footer = created ? (
    <>
      {failureList}
      <Button
        label={t('events.openPlan')}
        onPress={() => {
          openCreated(created.id, created.inviteFailed);
        }}
        testID="plot-open-plan"
      />
    </>
  ) : (
    <>
      {failureList}
      {formError ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="plot-error">
          {formError}
        </Text>
      ) : !ready ? (
        <Text variant="caption" tone="muted" style={styles.center} testID="plot-needs">
          {existing ? t('events.plotUiNeedsEdit') : t('events.plotUiNeedsCreate')}
        </Text>
      ) : null}
      <Button
        label={existing ? t('events.save') : t('events.plotUiPublish')}
        loading={leaving || create.isPending || update.isPending}
        disabled={!ready}
        onPress={() => void submit()}
        testID="plot-submit"
      />
    </>
  );

  return (
    <Screen testID="plot-screen" scrollRef={scrollRef} footer={footer}>
      <Text variant="title" accessibilityRole="header">
        {existing ? t('events.edit') : t('events.plotTitle')}
      </Text>

      <CoverPicker
        value={cover}
        onChange={(next) => {
          setCover(next);
          setCoverTouched(true);
        }}
      />

      {/* The name is the page's heading: typed straight in, no box around it. */}
      <View style={styles.titleWrap}>
        <TextInput
          testID="plot-title"
          accessibilityLabel={t('events.titleLabel')}
          accessibilityHint={titleError ?? undefined}
          placeholder={t('events.plotUiNamePlaceholder')}
          placeholderTextColor={theme.colors.textMuted}
          value={form.title}
          onChangeText={(v) => {
            set('title', v.replace(/\n/g, ' '));
          }}
          maxLength={LIMITS.event.titleMaxLength}
          multiline
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          maxFontSizeMultiplier={2}
          style={[
            theme.typography.display,
            styles.titleInput,
            {
              color: theme.colors.text,
              fontFamily: fontFamilyFor(theme.typography.display.fontWeight),
              borderBottomColor: titleError ? theme.colors.danger : theme.colors.inputBorder,
            },
          ]}
        />
        {titleError ? (
          <Text
            variant="caption"
            tone="danger"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {titleError}
          </Text>
        ) : null}
      </View>

      <SettingsGroup testID="plot-settings">
        <SettingRow
          icon={Grid}
          label={t('events.categoryLabel')}
          value={categoryName ?? t('events.plotUiChoose')}
          placeholder={categoryName === null}
          onPress={() => {
            open('category');
          }}
          error={errors.categoryId || null}
          testID="plot-category"
        />
        <SettingBlock testID="plot-when">
          <View style={styles.line}>
            <RowIcon icon={Calendar} />
            <Text style={styles.blockLabel}>{t('events.when')}</Text>
            <View style={styles.pills}>
              <DateField
                variant="pill"
                label={t('events.dateLabel')}
                value={form.date}
                onChange={(v) => {
                  set('date', v);
                }}
                error={whenError}
                testID="plot-date"
              />
              <TimeField
                variant="pill"
                label={t('events.timeLabel')}
                value={form.time}
                onChange={(v) => {
                  set('time', v);
                }}
                testID="plot-time"
              />
            </View>
          </View>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.chipRow, styles.indent]}
          >
            {(['tonight', 'tomorrow', 'weekend'] as const).map((k) => {
              const p = quickPick(k);
              return (
                <Chip
                  key={k}
                  kind="radio"
                  label={t(k === 'weekend' ? 'events.thisWeekend' : `events.${k}`)}
                  selected={p.date === form.date && p.time === form.time}
                  onToggle={() => {
                    setForm((f) => ({ ...f, date: p.date, time: p.time }));
                    clearErrors(['date', 'startsAt']);
                  }}
                />
              );
            })}
          </ScrollView>
          {whenError ? <RowError message={whenError} testID="plot-when-error" /> : null}
        </SettingBlock>
        <SettingRow
          icon={Clock}
          label={t('events.plotUiDuration')}
          value={durationText}
          onPress={() => {
            open('duration');
          }}
          error={errors.endsAt || null}
          testID="plot-duration"
        />
        <SettingRow
          icon={MapPin}
          label={t('events.where')}
          value={picked?.label ?? t('events.plotUiAddPlace')}
          placeholder={picked === null}
          onPress={() => {
            open('where');
          }}
          error={errors.where || null}
          testID="plot-where"
          valueTestID={picked ? 'plot-picked' : undefined}
        />
        <SettingRow
          icon={Eye}
          label={t('events.plotUiWho')}
          value={whoText}
          onPress={() => {
            open('who');
          }}
          error={errors.visibility || errors.balancedMaxSharePct || null}
          testID="plot-who"
        />
        <SettingRow
          icon={People}
          label={t('events.plotUiHowMany')}
          value={
            form.capacity
              ? t('events.plotUiPeople', { n: form.capacity })
              : t('events.plotUiChoose')
          }
          placeholder={!form.capacity}
          onPress={() => {
            open('capacity');
          }}
          error={errors.capacity || errors.minGroupSize || null}
          testID="plot-how-many"
        />
        {canPickCoHosts ? (
          <SettingRow
            icon={Users}
            label={t('events.coHosts')}
            value={
              coHosts.length > 0
                ? coHosts.map((p) => p.displayName).join(', ')
                : t('events.plotUiNone')
            }
            placeholder={coHosts.length === 0}
            onPress={() => {
              open('coHosts');
            }}
            testID="plot-cohosts"
          />
        ) : null}
        {canSell ? (
          <SettingRow
            icon={Ticket}
            label={t('events.plotUiPrice')}
            value={pricePaise > 0 ? money(pricePaise, i18n.language) : t('events.free')}
            onPress={() => {
              open('price');
            }}
            error={errors.pricePaise || errors.refundPolicy || null}
            testID="plot-price-row"
          />
        ) : null}
      </SettingsGroup>
      {/* Only while ticket sales are on (D-165/D-206): with free plans only, nobody needs approval. */}
      {!canSell && host.data?.ticketsEnabled === true ? (
        <GroupNote testID="plot-paid-hint">{t('events.paidNeedsHost')}</GroupNote>
      ) : null}

      <View
        style={styles.detailsWrap}
        onLayout={(e) => {
          detailsY.current = e.nativeEvent.layout.y;
        }}
      >
        <Text variant="label">{t('events.descriptionLabel')}</Text>
        <TextInput
          testID="plot-description"
          accessibilityLabel={t('events.descriptionLabel')}
          placeholder={t('events.plotUiDetailsPlaceholder')}
          placeholderTextColor={theme.colors.textMuted}
          value={form.description}
          onChangeText={(v) => {
            set('description', v);
          }}
          onFocus={() => {
            // Lift the box to the top so the keyboard does not cover what is being typed.
            scrollRef.current?.scrollTo({ y: Math.max(0, detailsY.current - 24), animated: true });
          }}
          multiline
          textAlignVertical="top"
          maxLength={LIMITS.event.descriptionMaxLength}
          maxFontSizeMultiplier={2}
          style={[
            theme.typography.body,
            styles.details,
            {
              color: theme.colors.text,
              fontFamily: fontFamilyFor(theme.typography.body.fontWeight),
              backgroundColor: theme.colors.surface,
              borderColor: errors.description ? theme.colors.danger : theme.colors.inputBorder,
              borderRadius: theme.radii.md,
            },
          ]}
        />
        {errors.description ? (
          <Text
            variant="caption"
            tone="danger"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {errors.description}
          </Text>
        ) : null}
      </View>

      <SettingsGroup testID="plot-more-options">
        <SettingRow
          icon={Gear}
          label={t('events.more')}
          value={t('events.plotUiOnCount', { n: optionsOn })}
          expanded={advanced}
          accessibilityHint={t('events.plotUiMoreHint')}
          trailing={
            <View style={advanced ? styles.flipped : null}>
              <Icon icon={ChevronDown} size={16} color={theme.colors.textMuted} />
            </View>
          }
          onPress={() => {
            setAdvanced((a) => !a);
          }}
          testID="plot-more"
        />
        {advanced ? (
          <>
            <SettingRow
              icon={Zap}
              label={t('profile.vibes')}
              value={vibeNames.length > 0 ? vibeNames.join(', ') : t('events.plotUiNone')}
              placeholder={vibeNames.length === 0}
              onPress={() => {
                open('vibes');
              }}
              error={errors.vibeTagIds || null}
              testID="plot-vibes"
            />
            <SwitchRow
              label={t('events.soloFriendly')}
              value={form.soloFriendly}
              onChange={(v) => {
                set('soloFriendly', v);
              }}
            />
            <SwitchRow
              label={t('events.smallGroup')}
              value={form.smallGroup}
              onChange={(v) => {
                set('smallGroup', v);
              }}
            />
            <SwitchRow
              label={t('events.mystery')}
              value={form.mystery}
              onChange={(v) => {
                set('mystery', v);
              }}
              testID="plot-mystery"
            />
            {form.mystery ? (
              <SettingRow
                icon={EyeOff}
                label={t('events.plotUiReveal')}
                value={t('events.plotUiRevealValue', { hours: form.revealHours })}
                onPress={() => {
                  open('reveal');
                }}
                error={errors.mysteryRevealMinutesBefore || null}
                testID="plot-reveal"
              />
            ) : null}
            <SwitchRow
              label={t('events.plusOnes')}
              value={form.allowPlusOnes && !paidPlan}
              disabled={paidPlan}
              onChange={(v) => {
                set('allowPlusOnes', v);
              }}
            />
            <SwitchRow
              label={t('events.indoor')}
              value={form.indoor}
              onChange={(v) => {
                set('indoor', v);
              }}
            />
            <SwitchRow
              label={t('events.stepFree')}
              value={form.stepFree}
              onChange={(v) => {
                set('stepFree', v);
              }}
            />
            <SwitchRow
              label={t('events.accessibleRestroom')}
              value={form.accessibleRestroom}
              onChange={(v) => {
                set('accessibleRestroom', v);
              }}
            />
            <SwitchRow
              label={t('events.quietSpace')}
              value={form.quietSpace}
              onChange={(v) => {
                set('quietSpace', v);
              }}
            />
            <SwitchRow
              label={t('events.chatToggle')}
              hint={t('events.chatToggleHint')}
              value={form.chatEnabled}
              onChange={(v) => {
                set('chatEnabled', v);
              }}
              testID="plot-chat"
            />
          </>
        ) : null}
      </SettingsGroup>

      {sheet === 'category' ? (
        <Sheet title={t('events.categoryLabel')} onClose={close} testID="plot-category-sheet">
          <PickList
            label={t('events.categoryLabel')}
            searchLabel={t('onboarding.interestsSearch')}
            mode="single"
            options={categoryOptions}
            selected={form.categoryId ? [form.categoryId] : []}
            onChange={(ids) => {
              const [chosen] = ids;
              if (chosen) set('categoryId', chosen);
              close();
            }}
            testIDPrefix="plot-category"
            searchFrom={0}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={close} />
        </Sheet>
      ) : null}

      {sheet === 'duration' ? (
        <Sheet title={t('events.plotUiDurationTitle')} onClose={close} testID="plot-duration-sheet">
          <View style={styles.chips} accessibilityRole="radiogroup">
            {DURATIONS.map((h) => (
              <Chip
                key={h}
                kind="radio"
                label={t('events.plotUiHours', { n: h })}
                selected={Number(form.durationHours) === h}
                onToggle={() => {
                  set('durationHours', String(h));
                }}
                testID={`plot-duration-${String(h)}`}
              />
            ))}
          </View>
          <TextField
            label={t('events.durationHours')}
            value={form.durationHours}
            onChangeText={(v) => {
              set('durationHours', v.replace(/[^\d.]/g, ''));
            }}
            keyboardType="decimal-pad"
            error={errors.endsAt || null}
            testID="plot-duration-input"
          />
          <Button label={t('common.done')} onPress={close} testID="plot-duration-done" />
        </Sheet>
      ) : null}

      {sheet === 'where' ? (
        <Sheet title={t('events.plotUiWhereTitle')} onClose={close} testID="plot-where-sheet">
          {mapOpen ? (
            // Drop a pin (D-203): tap the map, the map's address fills in (editable), then use the spot.
            <View style={styles.mapWrap}>
              <Text tone="muted">{t('events.dropPinHint')}</Text>
              <MapView
                style={[styles.map, { borderRadius: theme.radii.md }]}
                initialRegion={{
                  latitude: pin?.lat ?? near.lat,
                  longitude: pin?.lng ?? near.lng,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }}
                onPress={(e: MapPressEvent) => {
                  setPin({
                    lat: e.nativeEvent.coordinate.latitude,
                    lng: e.nativeEvent.coordinate.longitude,
                  });
                }}
                accessibilityLabel={t('events.pickOnMap')}
                accessibilityHint={t('events.dropPinHint')}
                testID="plot-map"
              >
                {pin ? <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} /> : null}
              </MapView>
              {pin && reverse.isFetching ? (
                <Text
                  tone="muted"
                  variant="caption"
                  accessibilityLiveRegion="polite"
                  testID="plot-pin-finding"
                >
                  {t('events.pinFinding')}
                </Text>
              ) : null}
              {pinOutside ? (
                <Text
                  tone="danger"
                  variant="caption"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  testID="plot-pin-outside"
                >
                  {t('events.pinOutside')}
                </Text>
              ) : null}
              <TextField
                label={t('events.addressLabel')}
                value={pinAddress}
                onChangeText={(v) => {
                  setPinAddress(v);
                  // Cleared, the box takes the map's suggestion again.
                  setPinAddressSuggested(v.trim().length === 0);
                }}
                testID="plot-pin-address"
              />
              <Button
                label={t('events.usePin')}
                disabled={!pin || pinAddress.trim().length < 3 || pinOutside}
                onPress={() => {
                  if (pin)
                    choose({
                      where: { point: pin, address: pinAddress.trim(), placeName: null },
                      label: pinAddress.trim(),
                    });
                }}
                testID="plot-use-pin"
              />
              <Button
                label={t('events.searchPlace')}
                variant="ghost"
                onPress={() => {
                  setMapOpen(false);
                }}
                testID="plot-back-to-search"
              />
            </View>
          ) : (
            <>
              <TextField
                label={t('events.searchPlace')}
                placeholder={t('events.searchPlaceHint')}
                value={query}
                onChangeText={setQuery}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
                error={errors.where || null}
                testID="plot-place-search"
              />
              {/* Right under the search box, so it stays in reach above the keyboard. */}
              <Button
                label={t('events.pickOnMap')}
                variant="ghost"
                onPress={() => {
                  Keyboard.dismiss();
                  setMapOpen(true);
                }}
                accessibilityHint={t('events.dropPinHint')}
                testID="plot-drop-pin"
              />
              {typing ? (
                <Card style={styles.suggestions} testID="plot-suggestions">
                  {search.isFetching && suggestionCount === 0 ? (
                    <Text
                      tone="muted"
                      variant="caption"
                      style={styles.sectionLabel}
                      testID="plot-place-searching"
                      accessibilityLiveRegion="polite"
                    >
                      {t('events.searchingPlaces')}
                    </Text>
                  ) : search.isError ? (
                    <Text
                      tone="danger"
                      variant="caption"
                      style={styles.sectionLabel}
                      accessibilityRole="alert"
                      testID="plot-place-error"
                    >
                      {errorMessage(t, search.error) ?? t('events.searchFailed')}
                    </Text>
                  ) : search.data && suggestionCount === 0 ? (
                    <Text
                      tone="muted"
                      variant="caption"
                      style={styles.sectionLabel}
                      testID="plot-place-empty"
                      accessibilityLiveRegion="polite"
                    >
                      {t('events.noPlaces', { q: query.trim() })}
                    </Text>
                  ) : null}
                  {(
                    [
                      ['known', t('events.placesKnown'), knownSuggestions],
                      ['map', t('events.placesMap'), mapSuggestions],
                    ] as const
                  ).map(([section, heading, items]) =>
                    items.length > 0 ? (
                      <View key={section} testID={`plot-places-${section}`}>
                        <Text
                          variant="label"
                          tone="muted"
                          accessibilityRole="header"
                          style={styles.sectionLabel}
                        >
                          {heading}
                        </Text>
                        {items.map((sug, i) => (
                          <FadeIn key={sug.key} delay={staggerDelay(i, 35)} distance={6}>
                            <PlaceRow
                              name={sug.label}
                              address={sug.detail}
                              last={i === items.length - 1}
                              testID={sug.testID}
                              onPress={sug.onPick}
                            />
                          </FadeIn>
                        ))}
                      </View>
                    ) : null,
                  )}
                </Card>
              ) : (saved.data?.items.length ?? 0) > 0 ? (
                <>
                  <Text variant="label" tone="muted">
                    {t('events.savedVenues')}
                  </Text>
                  <ScrollView
                    horizontal
                    keyboardShouldPersistTaps="handled"
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipRow}
                  >
                    {saved.data?.items.map((v) => (
                      <Chip
                        key={v.id}
                        label={v.name}
                        kind="radio"
                        selected={
                          picked?.where !== undefined &&
                          'venueId' in picked.where &&
                          picked.where.venueId === v.id
                        }
                        onToggle={() => {
                          choose({ where: { venueId: v.id }, label: v.name });
                        }}
                      />
                    ))}
                  </ScrollView>
                </>
              ) : null}
            </>
          )}
          <Button label={t('common.cancel')} variant="ghost" onPress={close} />
        </Sheet>
      ) : null}

      {sheet === 'who' ? (
        <Sheet title={t('events.plotUiWho')} onClose={close} testID="plot-who-sheet">
          <PickList
            label={t('events.visibilityLabel')}
            options={VISIBILITIES.map((v) => ({ id: v, label: t(`events.visibility.${v}`) }))}
            selected={[form.visibility]}
            onChange={(ids) => {
              const v = ids[0] as EventVisibility | undefined;
              if (!v) return;
              set('visibility', v);
              // Balanced needs one more choice (the share), so the sheet stays open for it.
              if (v !== 'balanced') close();
            }}
            mode="single"
            testIDPrefix="plot-visibility"
          />
          {form.visibility === 'balanced' ? (
            <View style={styles.chips} accessibilityRole="radiogroup">
              {BALANCED_PCTS.map((pct) => (
                <Chip
                  key={pct}
                  kind="radio"
                  label={t('events.balancedShare', { pct })}
                  selected={form.balancedPct === pct}
                  onToggle={() => {
                    set('balancedPct', pct);
                  }}
                />
              ))}
            </View>
          ) : null}
          <Button label={t('common.done')} onPress={close} testID="plot-who-done" />
        </Sheet>
      ) : null}

      {sheet === 'capacity' ? (
        <Sheet title={t('events.plotUiHowMany')} onClose={close} testID="plot-how-many-sheet">
          <TextField
            label={t('events.capacityLabel')}
            value={form.capacity}
            onChangeText={(v) => {
              set('capacity', v.replace(/\D/g, ''));
            }}
            keyboardType="number-pad"
            autoFocus
            error={errors.capacity || errors.minGroupSize || null}
            testID="plot-capacity"
          />
          <Button label={t('common.done')} onPress={close} testID="plot-how-many-done" />
        </Sheet>
      ) : null}

      {sheet === 'coHosts' ? (
        <CoHostsSheet selected={coHosts} onChange={setCoHosts} onClose={close} />
      ) : null}

      {sheet === 'price' && canSell ? (
        <Sheet title={t('events.plotUiPrice')} onClose={close} testID="plot-price-sheet">
          <SegmentedTabs
            tabs={[
              { key: 'free', label: t('events.free') },
              { key: 'paid', label: t('events.paid') },
            ]}
            value={form.paid ? 'paid' : 'free'}
            onChange={(k) => {
              set('paid', k === 'paid');
            }}
          />
          {form.paid ? (
            <>
              <TextField
                label={t('payments.priceLabel')}
                hint={t('payments.priceHint')}
                value={form.price}
                onChangeText={(v) => {
                  set('price', v.replace(/[^\d.]/g, ''));
                }}
                keyboardType="decimal-pad"
                error={errors.pricePaise || null}
                testID="plot-price"
              />
              {hostShare !== null ? (
                <Text tone="muted" testID="plot-host-share">
                  {t('payments.youGet', { amount: money(hostShare, i18n.language) })}
                </Text>
              ) : null}
              {pricePaise > 0 ? (
                <>
                  <ChipGroup
                    label={t('payments.refundPolicyLabel')}
                    options={(['full', 'partial', 'none'] as const).map((k) => ({
                      id: k,
                      label: t(`payments.refundKinds.${k}`),
                    }))}
                    selected={[form.refundKind]}
                    onChange={(ids) => {
                      const k = ids[0] as FormState['refundKind'] | undefined;
                      if (k) set('refundKind', k);
                    }}
                    mode="single"
                    scroll
                    testIDPrefix="plot-refund"
                  />
                  {form.refundKind !== 'none' ? (
                    <TextField
                      label={t('payments.cutoffLabel')}
                      value={form.cutoffHours}
                      onChangeText={(v) => {
                        set('cutoffHours', v.replace(/\D/g, ''));
                      }}
                      keyboardType="number-pad"
                      error={errors.refundPolicy || null}
                      testID="plot-cutoff"
                    />
                  ) : null}
                  {form.refundKind === 'partial' ? (
                    <TextField
                      label={t('payments.partialPctLabel')}
                      value={form.partialPct}
                      onChangeText={(v) => {
                        set('partialPct', v.replace(/\D/g, ''));
                      }}
                      keyboardType="number-pad"
                      testID="plot-partial-pct"
                    />
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          <Button label={t('common.done')} onPress={close} testID="plot-price-done" />
        </Sheet>
      ) : null}

      {sheet === 'vibes' ? (
        <Sheet title={t('profile.vibes')} onClose={close} testID="plot-vibes-sheet">
          <PickList
            label={t('profile.vibes')}
            options={vibeOptions}
            selected={form.vibeTagIds}
            onChange={(ids) => {
              set('vibeTagIds', ids);
            }}
            mode="multi"
            max={5}
            testIDPrefix="plot-vibe"
          />
          <Button label={t('common.done')} onPress={close} testID="plot-vibes-done" />
        </Sheet>
      ) : null}

      {sheet === 'reveal' ? (
        <Sheet title={t('events.plotUiReveal')} onClose={close} testID="plot-reveal-sheet">
          <PickList
            label={t('events.plotUiReveal')}
            options={REVEAL_HOURS.map((h) => ({
              id: String(h),
              label: t('events.mysteryReveal', { hours: h }),
            }))}
            selected={[String(form.revealHours)]}
            onChange={(ids) => {
              const h = Number(ids[0]);
              if (REVEAL_HOURS.includes(h)) {
                set('revealHours', h);
                setRevealTouched(true);
              }
              close();
            }}
            mode="single"
            testIDPrefix="plot-reveal"
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={close} />
        </Sheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  titleWrap: { gap: 8 },
  titleInput: { borderBottomWidth: 1.5, paddingTop: 0, paddingBottom: 10, paddingHorizontal: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  blockLabel: { flexShrink: 1 },
  pills: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  // Lines the quick picks up with the row's label, past its icon.
  indent: { paddingLeft: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRow: { gap: 8, paddingRight: 8 },
  detailsWrap: { gap: 8 },
  details: { minHeight: 96, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 11 },
  flipped: { transform: [{ rotate: '180deg' }] },
  suggestions: { gap: 0, paddingVertical: 6 },
  sectionLabel: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 2 },
  failures: { gap: 4 },
  mapWrap: { gap: 12 },
  map: { height: 260 },
});
