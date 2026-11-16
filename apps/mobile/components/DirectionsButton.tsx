import type { EventLocationView } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { openDirections } from '../src/features/events/directions';
import { Button } from './ui';

/**
 * "Directions" to a plan's spot (D-211). Rendered only for an exact location, which the API sends once the
 * viewer may see it, so a mystery plan shows no button until its reveal.
 */
export function DirectionsButton({
  location,
  variant = 'secondary',
  testID = 'event-directions',
}: {
  location: EventLocationView;
  variant?: 'primary' | 'secondary';
  testID?: string;
}) {
  const { t } = useTranslation();
  if (location.kind !== 'exact') return null;
  const place = location.placeName ?? location.address;
  return (
    <Button
      label={t('directions.button')}
      variant={variant}
      accessibilityLabel={t('directions.to', { place })}
      accessibilityHint={t('directions.hint')}
      onPress={() => void openDirections(location.point, location.placeName)}
      testID={testID}
    />
  );
}
