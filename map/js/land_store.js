/* AridMap — Land store (Locked View-Only Mode — وضع العرض فقط) */
(function () {
  'use strict';
  const empty = () => ({ schema: 'aridmap-admin-store', version: 1, rev: 0, parcels: {}, audit: [] });
  const diskStore = (window.ADMIN_STORE_DISK && typeof window.ADMIN_STORE_DISK === 'object') ? window.ADMIN_STORE_DISK : empty();
  const S = {
    store: diskStore,
    diskRev: 0,
    disk: false,
    browser: false,
    dirty: false,
    lastError: '',
    source: 'view-only',
    writeEnabled: false,
    listeners: []
  };

  window.AridStore = {
    SCHEMA: 'aridmap-admin-store',
    ready: Promise.resolve(S),
    get state() { return S; },
    get store() { return S.store; },
    get(uid) { return S.store.parcels[uid] || null; },
    commit() { return Promise.reject(new Error('Locked in view-only mode')); },
    restoreFrom() { return Promise.reject(new Error('Locked in view-only mode')); },
    ping() { return Promise.resolve(null); },
    retry() { return Promise.resolve(); },
    setWritable() { return false; },
    onChange(fn) { S.listeners.push(fn); },
    served: false,
    exportJSON() { return '{}'; },
    valid() { return false; }
  };

  // Safe View-Only stub for AridAdmin — permanently disables all drawing, editing, and admin features
  window.AridAdmin = {
    init() {},
    onCard() {},
    mapBusy() { return false; },
    onIdle() {},
    get mode() { return 'view'; },
    setMode() {}
  };
})();
