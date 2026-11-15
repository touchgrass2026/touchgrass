import type { PersonCard } from '@touchgrass/shared';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { flatten, useSquad } from '../../src/features/social/api';
import { errorMessage } from '../../src/lib/errors';
import { Sheet } from '../DateTimeFields';
import { PickList } from '../PickList';
import { Button, ErrorState, LoadingState, Text } from '../ui';

/** A plan has the primary host plus at most this many co-hosts picked while plotting (D-203). */
export const MAX_CO_HOSTS = 3;

/**
 * Picks co-hosts from the squad while plotting (D-203). The whole squad is loaded (it is paged by 30) so the
 * search finds anyone; people who are co-hosts already but not in the squad (promoted from the guest list)
 * stay in the list so they can be removed.
 */
export function CoHostsSheet({
  selected,
  onChange,
  onClose,
}: {
  selected: PersonCard[];
  onChange: (people: PersonCard[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const squad = useSquad();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = squad;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const people = flatten(squad.data);
  const known = new Map<string, PersonCard>();
  for (const p of [...selected, ...people]) known.set(p.id, p);
  const options = [...known.values()].map((p) => ({ id: p.id, label: p.displayName }));

  return (
    <Sheet title={t('events.coHosts')} onClose={onClose} testID="plot-cohosts-sheet">
      <Text tone="muted">{t('events.coHostsHint', { max: MAX_CO_HOSTS })}</Text>
      {squad.isPending ? (
        <LoadingState />
      ) : squad.isError ? (
        <ErrorState
          message={errorMessage(t, squad.error) ?? undefined}
          onRetry={() => void squad.refetch()}
        />
      ) : options.length === 0 ? (
        <Text tone="muted" testID="plot-cohosts-empty">
          {t('events.coHostsEmpty')}
        </Text>
      ) : (
        <PickList
          label={t('events.coHosts')}
          searchLabel={t('events.coHostsSearch')}
          options={options}
          selected={selected.map((p) => p.id)}
          onChange={(ids) => {
            onChange(ids.flatMap((id) => known.get(id) ?? []));
          }}
          mode="multi"
          max={MAX_CO_HOSTS}
          searchFrom={6}
          testIDPrefix="plot-cohost"
        />
      )}
      <Button label={t('common.done')} onPress={onClose} testID="plot-cohosts-done" />
    </Sheet>
  );
}
