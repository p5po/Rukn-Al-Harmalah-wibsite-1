/* AridMap v1.14 — Land management store (طبقة الإدارة).
   All admin changes (added parcels, edited data/boundaries, soft deletes, prices, statuses) live in ONE separate store.
   The plan files (data/plans/*.js) and data/sales_status.csv are never written: the map shows "base data + this store".

   Where the store is kept (both copies are written on every change):
     1. On disk  — data/admin/admin_store.json (+ admin_store.js for loading without a server), written by the local
                   service tools/admin_server.ps1 that the start scripts launch. Every overwrite keeps a backup copy in
                   data/admin/backups/, and every operation is appended to data/admin/audit_log.jsonl.
     2. In the browser profile (IndexedDB) — a second copy; used if the disk copy is older (e.g. the service stopped).
   On start the newer copy (higher rev) wins; a newer browser copy is written back to disk automatically. */
(function () {
  'use strict';
  const SCHEMA = 'aridmap-admin-store';
  const DB = 'aridmap-admin', OS = 'kv', KEY = 'store';
  const AUDIT_CAP = 20000;   // entries kept inside the store; the disk log (audit_log.jsonl) keeps everything
  const now = () => new Date().toISOString();
  const empty = () => ({ schema: SCHEMA, version: 1, rev: 0, createdAt: now(), savedAt: null, seq: 0, parcels: {}, audit: [] });
  const valid = s => s && typeof s === 'object' && s.schema === SCHEMA && typeof s.rev === 'number' && s.parcels && typeof s.parcels === 'object' && Array.isArray(s.audit);
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- IndexedDB (browser copy) ---------- */
  function idb() {
    return new Promise((res) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(OS);
        r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
  }
  async function idbGet() {
    const db = await idb(); if (!db) return null;
    return new Promise(res => { try { const q = db.transaction(OS, 'readonly').objectStore(OS).get(KEY); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } });
  }
  async function idbPut(v) {
    const db = await idb(); if (!db) return false;
    return new Promise(res => { try { const t = db.transaction(OS, 'readwrite'); t.objectStore(OS).put(v, KEY); t.oncomplete = () => res(true); t.onerror = () => res(false); t.onabort = () => res(false); } catch (e) { res(false); } });
  }

  /* ---------- local disk service ---------- */
  const SERVED = location.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  async function ping() {
    if (!SERVED) return null;
    try { const r = await fetch('/__admin/ping?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; }
  }

  const S = {
    store: empty(),
    diskRev: 0,            // rev of the copy that is on disk now
    disk: false,           // local service reachable → durable disk save
    browser: false,        // IndexedDB available
    dirty: false,          // a change not yet confirmed on disk
    lastError: '',
    source: '',
    writeEnabled: false,   // set only by admin mode (view mode cannot write, even from code paths of the UI)
    listeners: []
  };
  let saving = Promise.resolve();

  async function load() {
    const diskCopy = valid(window.ADMIN_STORE_DISK) ? window.ADMIN_STORE_DISK : null;
    const [browserCopy, info] = await Promise.all([idbGet(), ping()]);
    S.browser = !!window.indexedDB;
    S.disk = !!(info && info.ok);
    let diskRev = diskCopy ? diskCopy.rev : 0;
    if (S.disk && typeof info.rev === 'number') diskRev = info.rev;   // service knows the real rev on disk
    S.diskRev = diskRev;
    const b = valid(browserCopy) ? browserCopy : null;
    if (diskCopy && (!b || diskCopy.rev >= b.rev)) { S.store = clone(diskCopy); S.source = 'disk'; }
    else if (b) { S.store = clone(b); S.source = 'browser'; if (!diskCopy || b.rev > diskCopy.rev) S.dirty = true; }
    else { S.store = empty(); S.source = 'new'; }
    if (S.dirty && S.disk) await persist();   // newer browser copy → write it back to disk
    return S;
  }

  /* v1.25: every write to the service carries the admin session token (js/admin_auth.js); without it the service refuses */
  const authTok = () => (window.AridAuth && window.AridAuth.unlocked && window.AridAuth.token) || null;
  async function postJSON(url, text) {
    const h = { 'Content-Type': 'application/json; charset=utf-8' }; const t = authTok(); if (t) h['X-Admin-Token'] = t;
    const r = await fetch(url, { method: 'POST', headers: h, body: text, cache: 'no-store' });
    let j = null; try { j = await r.json(); } catch (e) { /* ignore */ }
    return { status: r.status, body: j };
  }

  function persist(auditEntries) {
    saving = saving.then(async () => {
      const snap = JSON.stringify(S.store);
      const okB = await idbPut(JSON.parse(snap));
      let okD = false;
      if (SERVED && !authTok()) { S.lastError = S.lastError === 'conflict' ? 'conflict' : ''; }   // v1.25: not signed in → kept in the browser, written to disk after the next admin login
      else if (SERVED) {
        try {
          const r = await postJSON('/__admin/save?rev=' + S.store.rev + '&base=' + S.diskRev, snap);
          if (r.status === 200 && r.body && r.body.ok) { okD = true; S.diskRev = S.store.rev; S.disk = true; S.lastError = ''; }
          else if (r.status === 409) { S.lastError = 'conflict'; S.disk = true; }
          else if (r.status === 401) { S.lastError = 'auth'; S.disk = true; if (window.AridAuth) window.AridAuth.sessionLost(); }
          else { S.lastError = 'save-failed'; }
          if (okD && auditEntries && auditEntries.length) {
            await postJSON('/__admin/audit', auditEntries.map(a => JSON.stringify(a)).join('\n')).catch(() => {});
          }
        } catch (e) { S.disk = false; S.lastError = 'no-service'; }
      }
      S.dirty = SERVED ? !okD : false;
      if (!okB && !okD) S.lastError = S.lastError || 'no-storage';
      emit();
      return { browser: okB, disk: okD };
    });
    return saving;
  }

  function emit() { S.listeners.forEach(fn => { try { fn(S); } catch (e) { /* ignore */ } }); }

  /* commit: run a mutation, stamp it, append audit entries, then persist (browser + disk).
     mutate(store) must return an array of audit entries {act, uid, plan, no, before, after, note}. */
  function commit(mutate) {
    if (!S.writeEnabled || !(window.AridAuth && window.AridAuth.unlocked)) return Promise.reject(new Error('read-only (view mode)'));
    if (S.lastError === 'conflict') return Promise.reject(new Error('conflict'));
    const before = JSON.stringify(S.store);
    let entries;
    try { entries = mutate(S.store) || []; }
    catch (e) { S.store = JSON.parse(before); return Promise.reject(e); }
    const t = now();
    S.store.rev += 1; S.store.savedAt = t;
    entries.forEach(a => {
      a.id = S.store.rev + '.' + Math.random().toString(36).slice(2, 7); a.at = t; a.rev = S.store.rev;
      S.store.audit.push(a);
    });
    if (S.store.audit.length > AUDIT_CAP) S.store.audit.splice(0, S.store.audit.length - AUDIT_CAP);
    return persist(entries).then(r => ({ entries, saved: r }));
  }

  /* replace the whole store (restore from a backup file) — recorded as one audit entry */
  function restoreFrom(obj, note) {
    if (!valid(obj)) return Promise.reject(new Error('invalid backup'));
    return commit(st => {
      const keepRev = st.rev, keepAudit = st.audit;
      Object.keys(st).forEach(k => delete st[k]);
      Object.assign(st, clone(obj));
      st.rev = keepRev; st.audit = keepAudit.concat([]);   // the log of this machine is kept; the restored log is not merged
      return [{ act: 'restore_backup', note: note || '', after: { parcels: Object.keys(obj.parcels).length, backup_rev: obj.rev, backup_saved: obj.savedAt } }];
    });
  }

  window.AridStore = {
    SCHEMA,
    ready: load(),
    get state() { return S; },
    get store() { return S.store; },
    get(uid) { return S.store.parcels[uid] || null; },
    commit, restoreFrom, ping,
    retry() { return persist(); },
    setWritable(b) { S.writeEnabled = !!b && !!(window.AridAuth && window.AridAuth.unlocked); return S.writeEnabled; },   // v1.25: only after the admin password
    onChange(fn) { S.listeners.push(fn); },
    served: SERVED,
    exportJSON() { return JSON.stringify(S.store, null, 1); },
    valid
  };
})();
