/* Admin auth permanently removed — View-Only Mode */
window.AridAuth = {
  unlocked: false,
  token: null,
  login() { return Promise.resolve({ ok: false, error: 'disabled' }); },
  lock() {},
  changePassword() { return Promise.resolve({ ok: false, error: 'disabled' }); },
  saveSettings() { return Promise.resolve({ ok: false, error: 'disabled' }); },
  sessionLost() {}
};
