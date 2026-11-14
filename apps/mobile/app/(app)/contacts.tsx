import { useMutation } from '@tanstack/react-query';
import type { ContactMatch } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PersonRow } from '../../components/PersonRow';
import { SquadActions } from '../../components/SquadActions';
import { Button, EmptyState, ListRow, Screen, Text, TextField } from '../../components/ui';
import { readAppEnvironment } from '../../src/config';
import { useMyInvites } from '../../src/features/me/api';
import { useMatchContacts } from '../../src/features/social/api';
import { type LocalContact, readHashedContacts } from '../../src/features/social/contacts';
import { inviteUrl } from '../../src/features/social/invite-link';
import { errorMessage } from '../../src/lib/errors';

const PAGE = 100;

/** Friends from contacts (F-SOC-01): hashed matching, add matches, invite everyone else via WhatsApp/SMS. */
export default function ContactsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const match = useMatchContacts();
  const invites = useMyInvites();
  const [denied, setDenied] = useState(false);
  const [local, setLocal] = useState<LocalContact[] | null>(null);
  const [matches, setMatches] = useState<ContactMatch[]>([]);
  // Every contact is reachable: search by name, or page through in steps (it used to stop at the first 200,
  // around the letter C).
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  const scan = useMutation({
    mutationFn: async () => {
      const read = await readHashedContacts();
      if (!read.granted) {
        setDenied(true);
        return;
      }
      setDenied(false);
      setLocal(read.contacts);
      if (read.contacts.length > 0)
        setMatches((await match.mutateAsync(read.contacts.map((c) => c.hash))).items);
    },
  });

  const matchedHashes = new Set(matches.map((m) => m.hash));
  const others = (local ?? []).filter((c) => !matchedHashes.has(c.hash));
  const q = query.trim().toLowerCase();
  const filtered = q
    ? others.filter((c) => c.name.toLowerCase().includes(q) || c.e164.includes(q))
    : others;
  const invite = (c: LocalContact): void => {
    void Share.share({
      message: t('squad.inviteMessage', {
        url: inviteUrl(invites.data, readAppEnvironment().webUrl),
      }),
      title: c.name,
    });
  };

  return (
    <Screen testID="contacts-screen">
      <Text variant="title">{t('squad.contactsTitle')}</Text>
      <Text tone="muted">{t('squad.contactsBody')}</Text>
      <Button
        label={t('squad.scanContacts')}
        onPress={() => {
          scan.mutate();
        }}
        loading={scan.isPending}
        testID="scan-contacts"
      />
      {denied ? (
        <Text tone="danger" accessibilityRole="alert">
          {t('squad.contactsPermissionDenied')}
        </Text>
      ) : null}
      {scan.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, scan.error)}
        </Text>
      ) : null}
      {local !== null ? (
        <>
          <Text variant="heading">{t('squad.onTouchGrass')}</Text>
          {matches.length === 0 ? (
            <EmptyState body={t('squad.noMatches')} />
          ) : (
            matches.map((m) => (
              <PersonRow
                key={m.hash}
                person={m.person}
                detail={local.find((c) => c.hash === m.hash)?.name ?? null}
                onOpen={() => {
                  router.push({ pathname: '/users/[id]', params: { id: m.person.id } });
                }}
                actions={
                  <SquadActions userId={m.person.id} relationship={m.relationship} compact />
                }
              />
            ))
          )}
          {others.length > 0 ? (
            <>
              <Text variant="heading">
                {t('squad.inviteContacts')} ({others.length})
              </Text>
              <TextField
                label={t('squad.searchContacts')}
                value={query}
                onChangeText={(v) => {
                  setQuery(v);
                  setShown(PAGE);
                }}
                autoCorrect={false}
                testID="contacts-search"
              />
            </>
          ) : null}
          {filtered.slice(0, shown).map((c) => (
            <ListRow
              key={c.hash}
              label={c.name}
              detail={t('squad.invite')}
              onPress={() => {
                invite(c);
              }}
              testID={`invite-${c.hash.slice(0, 8)}`}
            />
          ))}
          {filtered.length > shown ? (
            <Button
              label={t('squad.showMoreContacts', { count: filtered.length - shown })}
              variant="secondary"
              onPress={() => {
                setShown((n) => n + PAGE);
              }}
              testID="contacts-more"
            />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
