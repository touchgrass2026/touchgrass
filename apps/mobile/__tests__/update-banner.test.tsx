import { fireEvent, screen } from '@testing-library/react-native';
import * as Updates from 'expo-updates';
import { UpdateBanner, UpdateCard, checkAndFetch } from '../components/UpdateBanner';
import { renderWithProviders, resetStores } from '../test-utils';

const updates = jest.mocked(Updates);

describe('new version banner (D-217)', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
  });

  it('says a new version is ready and restarts or waits', async () => {
    const onRestart = jest.fn();
    const onLater = jest.fn();
    await renderWithProviders(<UpdateCard onRestart={onRestart} onLater={onLater} />);
    expect(screen.getByTestId('update-banner')).toBeOnTheScreen();
    expect(screen.getByText('A new version is ready')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Restart now' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Later' }));
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it('downloads an update only when one is published, and never throws offline', async () => {
    await checkAndFetch();
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.fetchUpdateAsync).not.toHaveBeenCalled();

    updates.checkForUpdateAsync.mockResolvedValueOnce({
      isAvailable: true,
    } as Awaited<ReturnType<typeof Updates.checkForUpdateAsync>>);
    await checkAndFetch();
    expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);

    updates.checkForUpdateAsync.mockRejectedValueOnce(new Error('offline'));
    await expect(checkAndFetch()).resolves.toBeUndefined();
  });

  it('stays out of the way in development and test builds', async () => {
    updates.useUpdates.mockReturnValue({
      isUpdatePending: true,
    } as ReturnType<typeof Updates.useUpdates>);
    await renderWithProviders(<UpdateBanner />);
    expect(screen.queryByTestId('update-banner')).toBeNull();
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });
});
