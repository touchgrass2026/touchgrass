module.exports = {
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: () => Promise.resolve(),
  requestPermissionsAsync: () => Promise.resolve({ granted: false }),
  getExpoPushTokenAsync: () => Promise.reject(new Error('no push on the capture build')),
  useLastNotificationResponse: () => null,
  setNotificationHandler: () => undefined,
  addNotificationReceivedListener: () => ({ remove() {} }),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
};
