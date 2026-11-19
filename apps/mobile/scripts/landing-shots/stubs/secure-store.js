module.exports = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: (k) => Promise.resolve(window.localStorage.getItem(k)),
  setItemAsync: (k, v) => Promise.resolve(window.localStorage.setItem(k, v)),
  deleteItemAsync: (k) => Promise.resolve(window.localStorage.removeItem(k)),
};
