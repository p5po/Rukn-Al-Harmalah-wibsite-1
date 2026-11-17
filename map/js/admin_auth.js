/* AridMap v1.25 — admin password (حماية وضع الإدارة).
   - View mode needs no password. Admin mode opens only after the admin password is entered.
   - The password is never stored: only a random salt and a PBKDF2-SHA256 hash (150,000 rounds) in data/admin/admin_auth.json.
   - With the local service (start_kiosk / start_window / start_mac): the service checks the password and returns a session
     token; every write on disk (/__admin/save, /__admin/audit, /__admin/settings) is refused without it. Locking or leaving
     admin mode ends the session on the service as well.
   - Opened from the files directly (no service): the hash is read from data/admin/admin_auth.js and checked in the browser;
     a password changed in this mode is kept in this browser (IndexedDB) and used from then on in this browser.
   - 5 wrong passwords → 30 s wait. */
(function () {
  'use strict';
  const ITER = 150000;
  const enc = new TextEncoder();
  const b64 = u8 => btoa(String.fromCharCode.apply(null, Array.from(u8)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const DB = 'aridmap-admin', OS = 'kv', KEY = 'auth';
  const A = { unlocked: false, token: null, mode: null, fails: 0, waitUntil: 0, listeners: [] };
  const served = () => !!(window.AridStore && window.AridStore.served);

  async function pbkdf2(pw, salt, iter) {
    const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256));
  }
  const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
  const validRec = r => r && r.algo === 'pbkdf2-sha256' && typeof r.salt === 'string' && typeof r.hash === 'string' && r.iter >= 10000;

  /* browser copy (file mode only) */
  function idb() {
    return new Promise(res => { try { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(OS); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); } catch (e) { res(null); } });
  }
  async function idbGet() { const db = await idb(); if (!db) return null; return new Promise(res => { try { const q = db.transaction(OS, 'readonly').objectStore(OS).get(KEY); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }); }
  async function idbPut(v) { const db = await idb(); if (!db) return false; return new Promise(res => { try { const t = db.transaction(OS, 'readwrite'); t.objectStore(OS).put(v, KEY); t.oncomplete = () => res(true); t.onerror = () => res(false); } catch (e) { res(false); } }); }
  async function localRecord() {
    const f = validRec(window.ADMIN_AUTH) ? window.ADMIN_AUTH : null, b = await idbGet();
    const bb = validRec(b) ? b : null;
    if (f && bb) return (Date.parse(bb.changedAt) || 0) > (Date.parse(f.changedAt) || 0) ? bb : f;
    return bb || f;
  }

  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', cache: 'no-store', headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, A.token ? { 'X-Admin-Token': A.token } : {}), body: JSON.stringify(body || {}) });
    let j = null; try { j = await r.json(); } catch (e) { /* ignore */ }
    return { status: r.status, body: j || {} };
  }
  function waitLeft() { return Math.max(0, Math.ceil((A.waitUntil - Date.now()) / 1000)); }
  function failed() { A.fails++; if (A.fails >= 5) { A.fails = 0; A.waitUntil = Date.now() + 30000; } }
  function emit() { A.listeners.forEach(fn => { try { fn(A.unlocked); } catch (e) { /* ignore */ } }); }

  /* returns {ok, error: 'password'|'wait'|'nohash'|'service', wait, isDefault} */
  async function login(pw) {
    if (waitLeft()) return { ok: false, error: 'wait', wait: waitLeft() };
    if (served()) {
      let r; try { r = await post('/__admin/login', { password: pw }); } catch (e) { return { ok: false, error: 'service' }; }
      if (r.status === 200 && r.body.ok && r.body.token) { A.token = r.body.token; A.mode = 'service'; A.unlocked = true; A.fails = 0; emit(); return { ok: true, isDefault: !!r.body.default }; }
      if (r.status === 429) { A.waitUntil = Date.now() + (r.body.wait || 30) * 1000; return { ok: false, error: 'wait', wait: r.body.wait || 30 }; }
      if (r.status === 404) return { ok: false, error: 'service' };   // an older service without password support
      failed(); return { ok: false, error: waitLeft() ? 'wait' : 'password', wait: waitLeft() };
    }
    const rec = await localRecord();
    if (!rec) return { ok: false, error: 'nohash' };
    const k = await pbkdf2(pw, unb64(rec.salt), rec.iter);
    if (!same(k, unb64(rec.hash))) { failed(); return { ok: false, error: waitLeft() ? 'wait' : 'password', wait: waitLeft() }; }
    A.token = null; A.mode = 'browser'; A.unlocked = true; A.fails = 0; emit();
    return { ok: true, isDefault: !!rec.default };
  }
  async function lock() {
    const t = A.token; A.unlocked = false; A.token = null; A.mode = null;
    if (window.AridStore) window.AridStore.setWritable(false);
    emit();
    if (t && served()) { try { await fetch('/__admin/logout', { method: 'POST', cache: 'no-store', headers: { 'X-Admin-Token': t, 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { /* the session also ends when the service stops */ } }
  }
  /* returns {ok, error: 'password'|'length'|'wait'|'locked'|'service'|'storage'} */
  async function changePassword(current, next) {
    if (!A.unlocked) return { ok: false, error: 'locked' };
    if (typeof next !== 'string' || next.length < 4 || next.length > 64) return { ok: false, error: 'length' };
    if (waitLeft()) return { ok: false, error: 'wait', wait: waitLeft() };
    if (A.mode === 'service') {
      let r; try { r = await post('/__admin/password', { current, new: next }); } catch (e) { return { ok: false, error: 'service' }; }
      if (r.status === 200 && r.body.ok) return { ok: true, where: 'disk' };
      if (r.status === 429) { A.waitUntil = Date.now() + (r.body.wait || 30) * 1000; return { ok: false, error: 'wait', wait: r.body.wait || 30 }; }
      if (r.status === 401 && r.body.error === 'login') { await lock(); return { ok: false, error: 'locked' }; }
      if (r.status === 400) return { ok: false, error: r.body.error === 'length' ? 'length' : 'service' };
      failed(); return { ok: false, error: 'password' };
    }
    const rec = await localRecord();
    if (!rec) return { ok: false, error: 'service' };
    const k = await pbkdf2(current, unb64(rec.salt), rec.iter);
    if (!same(k, unb64(rec.hash))) { failed(); return { ok: false, error: 'password' }; }
    const salt = crypto.getRandomValues(new Uint8Array(16)), h = await pbkdf2(next, salt, ITER);
    const ok = await idbPut({ schema: 'aridmap-admin-auth', algo: 'pbkdf2-sha256', iter: ITER, salt: b64(salt), hash: b64(h), changedAt: new Date().toISOString(), default: false });
    return ok ? { ok: true, where: 'browser' } : { ok: false, error: 'storage' };
  }
  async function saveSettings(obj) {
    if (!A.unlocked) return { ok: false, error: 'locked' };
    if (A.mode !== 'service') return { ok: false, error: 'service' };
    try { const r = await post('/__admin/settings', obj); return r.status === 200 && r.body.ok ? { ok: true } : { ok: false, error: r.body.error || 'service' }; }
    catch (e) { return { ok: false, error: 'service' }; }
  }
  /* the service answered 401 to a save: the session ended (service restarted, expired) → lock the tools again */
  function sessionLost() { if (A.unlocked) { lock(); } }

  window.AridAuth = {
    login, lock, changePassword, saveSettings, sessionLost,
    get unlocked() { return A.unlocked; }, get token() { return A.token; }, get mode() { return A.mode; },
    waitLeft, onChange(fn) { A.listeners.push(fn); }
  };
})();
