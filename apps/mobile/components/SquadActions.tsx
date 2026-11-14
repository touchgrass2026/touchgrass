import type { RelationshipStatus } from '@touchgrass/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { type SquadAction, useSquadAction } from '../src/features/social/api';
import { errorMessage } from '../src/lib/errors';
import { Button, Text } from './ui';

/** The right squad buttons for a relationship: add / cancel / accept+decline / remove. */
export function SquadActions({
  userId,
  relationship,
  compact = false,
  onChange,
}: {
  userId: string;
  relationship: RelationshipStatus;
  compact?: boolean;
  /** Told when this person's status changes here (e.g. so a list keeps someone just requested). */
  onChange?: (next: RelationshipStatus) => void;
}) {
  const { t } = useTranslation();
  const action = useSquadAction();
  // What the server said, overridden by what was just done here, so "Add to squad" turns into "Requested"
  // at once (like Instagram) instead of the row vanishing when lists refresh.
  const [override, setOverride] = useState<RelationshipStatus | null>(null);
  useEffect(() => {
    setOverride(null);
  }, [relationship]);
  const current = override ?? relationship;
  const run = (a: SquadAction): void => {
    action.mutate(
      { action: a, userId },
      {
        onSuccess: () => {
          const next: RelationshipStatus | null =
            a === 'request' ? 'request_sent' : a === 'cancel' ? 'none' : null;
          if (next) {
            setOverride(next);
            onChange?.(next);
          }
        },
      },
    );
  };
  const variant = compact ? 'ghost' : 'primary';
  const failure = action.isError ? (
    <Text tone="danger" accessibilityLiveRegion="assertive" testID={`squad-error-${userId}`}>
      {errorMessage(t, action.error)}
    </Text>
  ) : null;
  const withError = (buttons: ReactNode) => (
    <>
      {buttons}
      {failure}
    </>
  );
  switch (current) {
    case 'self':
      return null;
    case 'none':
      return withError(
        <Button
          label={t('squad.add')}
          variant={variant}
          loading={action.isPending}
          onPress={() => {
            run('request');
          }}
          testID={`add-${userId}`}
        />,
      );
    case 'request_sent':
      return withError(
        <Button
          label={t('squad.requested')}
          variant="secondary"
          accessibilityHint={t('squad.cancelRequest')}
          loading={action.isPending}
          onPress={() => {
            run('cancel');
          }}
          testID={`cancel-${userId}`}
        />,
      );
    case 'request_received':
      return withError(
        <>
          <Button
            label={t('squad.accept')}
            loading={action.isPending}
            onPress={() => {
              run('accept');
            }}
            testID={`accept-${userId}`}
          />
          <Button
            label={t('squad.decline')}
            variant="ghost"
            disabled={action.isPending}
            onPress={() => {
              run('decline');
            }}
            testID={`decline-${userId}`}
          />
        </>,
      );
    case 'squad':
      return compact
        ? null
        : withError(
            <Button
              label={t('squad.remove')}
              variant="ghost"
              loading={action.isPending}
              onPress={() => {
                // Removing someone is hard to undo (they'd have to accept a new request), so ask first.
                Alert.alert(t('squad.removeConfirmTitle'), t('squad.removeConfirmBody'), [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('squad.remove'),
                    style: 'destructive',
                    onPress: () => {
                      run('remove');
                    },
                  },
                ]);
              }}
              testID={`remove-${userId}`}
            />,
          );
  }
}
