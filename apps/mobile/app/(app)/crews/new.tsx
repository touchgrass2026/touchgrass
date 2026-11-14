import { type CrewJoinPolicy, CreateCrewBody, LIMITS } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '../../../components/SelectField';
import { Button, Screen, Text, TextField } from '../../../components/ui';
import { localized, useInterests } from '../../../src/features/catalog/api';
import { useCreateCrew } from '../../../src/features/engagement/api';
import { errorMessage } from '../../../src/lib/errors';

const CUSTOM = 'custom';

/** Start a crew (F-ENG-02): name, what it does, who can join. */
export default function NewCrewScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const interests = useInterests();
  const create = useCreateCrew();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [interestId, setInterestId] = useState<string | null>(null);
  // What the crew does in the founder's own words, when it is not in the list (D-197).
  const [activity, setActivity] = useState<string | null>(null);
  const [policy, setPolicy] = useState<CrewJoinPolicy>('request');
  const [error, setError] = useState<string | null>(null);
  const parsed = CreateCrewBody.safeParse({
    name,
    description,
    interestId,
    activity,
    joinPolicy: policy,
  });
  const save = async (): Promise<void> => {
    if (!parsed.success) return;
    setError(null);
    try {
      const crew = await create.mutateAsync(parsed.data);
      router.replace({ pathname: '/crews/[id]', params: { id: crew.id } });
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  return (
    <Screen testID="crew-new">
      <TextField
        label={t('crews.name')}
        value={name}
        onChangeText={setName}
        maxLength={LIMITS.crews.nameMaxLength}
        testID="crew-name"
      />
      <TextField
        label={t('crews.description')}
        value={description}
        onChangeText={setDescription}
        maxLength={LIMITS.crews.descriptionMaxLength}
        multiline
        testID="crew-description"
      />
      {/* Dropdowns instead of walls of chips (D-197); anything typed that is not listed becomes the activity. */}
      <SelectField
        label={t('crews.activity')}
        placeholder={t('crews.activityPlaceholder')}
        searchLabel={t('crews.activitySearch')}
        options={[
          ...(activity ? [{ id: CUSTOM, label: activity }] : []),
          ...(interests.data?.items ?? []).map((i) => ({
            id: i.id,
            label: localized(i.name, i18n.language),
          })),
        ]}
        value={activity ? CUSTOM : interestId}
        onChange={(id) => {
          if (id === CUSTOM) return;
          setActivity(null);
          setInterestId(id);
        }}
        onCreate={(text) => {
          setInterestId(null);
          setActivity(text.slice(0, 40));
        }}
        testID="crew-interest"
      />
      <SelectField
        label={t('crews.joinPolicy')}
        placeholder={t('crews.policyRequest')}
        options={[
          { id: 'request', label: t('crews.policyRequest') },
          { id: 'invite_only', label: t('crews.policyInvite') },
        ]}
        value={policy}
        onChange={(id) => {
          if (id === 'request' || id === 'invite_only') setPolicy(id);
        }}
        searchFrom={99}
        testID="crew-policy"
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('crews.create')}
        disabled={!parsed.success}
        loading={create.isPending}
        onPress={() => void save()}
        testID="crew-save"
      />
    </Screen>
  );
}
