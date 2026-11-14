import { zodResolver } from '@hookform/resolvers/zod';
import { LIMITS } from '@touchgrass/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { interestOptions } from '../../components/interest-options';
import { MultiSelectField } from '../../components/MultiSelectField';
import { PhotoGrid } from '../../components/PhotoGrid';
import type { PickOption } from '../../components/PickList';
import { Button, ErrorState, LoadingState, Screen, Text, TextField } from '../../components/ui';
import { localized, useInterests, useVibeTags } from '../../src/features/catalog/api';
import { usePhotoEditor } from '../../src/features/media/use-photo-editor';
import {
  useMe,
  useSetInterests,
  useSetVibeTags,
  useUpdateProfile,
} from '../../src/features/me/api';
import { errorMessage } from '../../src/lib/errors';

const P = LIMITS.profile;
const FormSchema = z.object({
  displayName: z.string().trim().min(P.displayNameMin).max(P.displayNameMax),
  bio: z.string().trim().max(P.bioMaxLength),
  pronouns: z.string().trim().max(P.pronounsMax),
  languages: z.string().max(200),
});
type FormValues = z.infer<typeof FormSchema>;

/** Typed interests live in the same selection as listed ones, under ids with this prefix (D-199). */
const CUSTOM = 'custom:';
const isCustom = (id: string): boolean => id.startsWith(CUSTOM);
const sameText = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/**
 * Edit everything shown on the profile (F-ACC-05, D-199): photos, the basics, then interests and mood as
 * dropdowns (a searchable checklist in a sheet) instead of a long checklist and a wall of chips. Interests that
 * are not listed can be typed in; they count toward the same limits.
 */
export default function ProfileEditScreen() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const interests = useInterests();
  const vibes = useVibeTags();
  const photos = usePhotoEditor();
  const update = useUpdateProfile();
  const saveInterests = useSetInterests();
  const saveVibes = useSetVibeTags();
  const [interestIds, setInterestIds] = useState<string[] | null>(null);
  const [typed, setTyped] = useState<string[]>([]);
  const [vibeIds, setVibeIds] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    values: me.data
      ? {
          displayName: me.data.displayName ?? '',
          bio: me.data.bio,
          pronouns: me.data.pronouns ?? '',
          languages: me.data.spokenLanguages.join(', '),
        }
      : undefined,
  });

  if (me.isPending || interests.isPending || vibes.isPending) {
    return (
      <Screen testID="profile-edit">
        <LoadingState />
      </Screen>
    );
  }
  const loadError = me.error ?? interests.error ?? vibes.error;
  if (loadError || !me.data || !interests.data || !vibes.data) {
    return (
      <Screen testID="profile-edit">
        <ErrorState
          message={errorMessage(t, loadError) ?? undefined}
          onRetry={() => void Promise.all([me.refetch(), interests.refetch(), vibes.refetch()])}
        />
      </Screen>
    );
  }

  const savedCustom = me.data.customInterests;
  const customTexts = [
    ...savedCustom,
    ...typed.filter((x) => !savedCustom.some((s) => sameText(s, x))),
  ];
  const interestChoices: PickOption[] = [
    ...customTexts.map((text) => ({
      id: `${CUSTOM}${text}`,
      label: text,
      group: t('profile.uiCustomGroup'),
    })),
    ...interestOptions(interests.data.items, t, i18n.language),
  ];
  const currentInterests = interestIds ?? [
    ...me.data.interests.map((i) => i.id),
    ...savedCustom.map((text) => `${CUSTOM}${text}`),
  ];
  const customCount = currentInterests.filter(isCustom).length;
  const currentVibes = vibeIds ?? me.data.vibeTags.map((v) => v.id);

  const addTyped = (raw: string): string => {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, P.customInterestMax).trim();
    const existing = customTexts.find((x) => sameText(x, text));
    if (existing) return `${CUSTOM}${existing}`;
    setTyped((prev) => [...prev, text]);
    return `${CUSTOM}${text}`;
  };

  const onSave = form.handleSubmit(async (values) => {
    setSaved(false);
    await update.mutateAsync({
      displayName: values.displayName,
      bio: values.bio,
      pronouns: values.pronouns || null,
      spokenLanguages: values.languages
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean),
    });
    if (interestIds)
      await saveInterests.mutateAsync({
        interestIds: interestIds.filter((id) => !isCustom(id)),
        customInterests: interestIds.filter(isCustom).map((id) => id.slice(CUSTOM.length)),
      });
    if (vibeIds) await saveVibes.mutateAsync(vibeIds);
    setSaved(true);
  });

  const error = update.error ?? saveInterests.error ?? saveVibes.error;
  return (
    <Screen testID="profile-edit">
      <View style={styles.section}>
        <View style={styles.heading}>
          <Text variant="heading">{t('profile.uiPhotos')}</Text>
          <Text variant="caption" tone="muted">
            {t('profile.uiPhotosHint', { min: P.minPhotos, max: P.maxPhotos })}
          </Text>
        </View>
        <PhotoGrid
          photos={photos.photos}
          max={P.maxPhotos}
          canAdd={photos.canAdd}
          adding={photos.adding}
          onAdd={() => void photos.add().catch(() => undefined)}
          onRemove={(id) => {
            if (photos.photos.length > P.minPhotos) void photos.remove(id).catch(() => undefined);
          }}
        />
      </View>
      <View style={styles.section}>
        <Text variant="heading">{t('profile.uiAboutYou')}</Text>
        <Controller
          control={form.control}
          name="displayName"
          render={({ field, fieldState }) => (
            <TextField
              label={t('onboarding.nameLabel')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error ? t('errors.VALIDATION_FAILED') : null}
              testID="edit-name"
            />
          )}
        />
        <Controller
          control={form.control}
          name="pronouns"
          render={({ field }) => (
            <TextField
              label={t('onboarding.pronounsLabel')}
              value={field.value}
              onChangeText={field.onChange}
              maxLength={P.pronounsMax}
              testID="edit-pronouns"
            />
          )}
        />
        <Controller
          control={form.control}
          name="bio"
          render={({ field, fieldState }) => (
            <TextField
              label={t('profile.bioLabel')}
              placeholder={t('profile.bioPlaceholder')}
              value={field.value}
              onChangeText={field.onChange}
              multiline
              maxLength={P.bioMaxLength}
              error={fieldState.error ? t('errors.VALIDATION_FAILED') : null}
              hint={me.data.bioHeld ? t('moderation.held') : undefined}
              testID="edit-bio"
            />
          )}
        />
        <Controller
          control={form.control}
          name="languages"
          render={({ field }) => (
            <TextField
              label={t('profile.languagesLabel')}
              hint={t('profile.languagesHint')}
              value={field.value}
              onChangeText={field.onChange}
              testID="edit-languages"
            />
          )}
        />
      </View>
      <View style={styles.section}>
        <View style={styles.heading}>
          <MultiSelectField
            label={t('profile.interests')}
            placeholder={t('profile.uiInterestsPlaceholder')}
            searchLabel={t('onboarding.interestsSearch')}
            options={interestChoices}
            selected={currentInterests}
            onChange={setInterestIds}
            max={P.maxInterests}
            onCreate={customCount < P.maxCustomInterests ? addTyped : undefined}
            // The search box is also where people type their own, so it is always there.
            searchFrom={0}
            testID="edit-interest"
          />
          <Text variant="caption" tone="muted">
            {t('profile.uiInterestsHint', { min: P.minInterests })}
          </Text>
        </View>
        <MultiSelectField
          label={t('profile.vibes')}
          placeholder={t('profile.uiVibesPlaceholder')}
          options={vibes.data.items.map((v) => ({
            id: v.id,
            label: localized(v.name, i18n.language),
          }))}
          selected={currentVibes}
          onChange={setVibeIds}
          max={P.maxVibeTags}
          testID="edit-vibe"
        />
      </View>
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, error)}
        </Text>
      ) : null}
      {saved ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID="profile-saved">
          {t('profile.uiSaved')}
        </Text>
      ) : null}
      <Button
        label={t('common.save')}
        onPress={() => void onSave()}
        loading={update.isPending || saveInterests.isPending || saveVibes.isPending}
        disabled={currentInterests.length < P.minInterests}
        testID="save-profile"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 16 },
  heading: { gap: 4 },
});
