/* AridMap v1.14 — Admin mode (وضع الإدارة): add / edit / delete parcels, boundaries, prices and statuses.
   The app always starts in view mode. View mode has no admin controls and the store refuses writes (AridStore.setWritable).
   Every change goes through change() → AridStore.commit(): it is stamped, written to the audit log with the exact
   previous values (so any operation can be undone), saved to the browser copy and to disk (data/admin/). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORE = window.AridStore;
  let A = null, map = null, L = null;   // __app, map, AridLand
  let admin = false, acked = false, session = null, lastUndo = null;
  const num = v => '<bdi dir="ltr" class="num">' + v + '</bdi>';
  const n0 = v => Number(v).toLocaleString('en-US');
  const ACT = { add: 'إضافة قطعة', edit: 'تعديل البيانات', geom: 'تعديل الحدود', delete: 'حذف قطعة', restore: 'استعادة قطعة محذوفة', revert: 'استعادة الأصل',
    status: 'تغيير الحالة', price: 'تعديل السعر', price_remove: 'إزالة السعر', undo: 'تراجع عن عملية', restore_backup: 'استعادة نسخة احتياطية' };
  const ST_SET = ['available', 'reserved', 'sold', 'unknown'];
  const CUR_ORDER = ['SAR', 'USD', 'AED', 'EUR'];
  const isoNow = () => new Date().toISOString();

  /* ---------------- effective values (base + csv + a given store record) ---------------- */
  function csvPrice(uid) { const s = A.sales.get(uid); const a = s && s.price ? Number(String(s.price).replace(/[^\d.]/g, '')) : 0; return a > 0 ? { amount: a, currency: 'SAR', unit: 'total', src: 'csv' } : null; }
  function effFrom(uid, r) {
    r = r || {}; const b = A.BASE_UID.get(uid); const bp = b ? b.properties : {};
    const s = A.sales.get(uid);
    return {
      plan: r.plan !== undefined ? r.plan : bp.plan, no: r.no !== undefined ? r.no : (bp.no || ''),
      area: r.area !== undefined ? r.area : bp.area,
      status: r.status !== undefined ? (r.status || 'unknown') : (s ? s.status : 'unknown'),
      price: r.price !== undefined ? r.price : csvPrice(uid),
      notes: r.notes !== undefined ? r.notes : (s && s.notes) || '',
      deleted: !!r.deleted, geom: !!r.geom
    };
  }
  const priceTxt = p => p ? A.fmtMoney(p.amount) + ' ' + (A.CURRENCY[p.currency] || p.currency) + (p.unit === 'sqm' ? ' / م²' : ' (إجمالي)') : 'غير محدد';

  /* ---------------- the only write path ---------------- */
  function canWrite() {
    if (!admin) { A.toast('التعديل متاح في وضع الإدارة فقط.'); return false; }
    if (STORE.state.lastError === 'conflict') { conflictMsg(); return false; }
    return true;
  }
  async function ackBrowserOnly() {
    if (STORE.state.disk || acked) return true;
    const ok = await L.confirm('الحفظ على القرص غير متاح الآن',
      'الخريطة مفتوحة دون خدمة الحفظ المحلية (فُتحت من الملف مباشرة أو لم تبدأ الخدمة). ستُحفظ التعديلات في هذا المتصفح فقط، ولن تُكتب في مجلد <bdi dir="ltr">data\\admin</bdi>. '
      + 'للحفظ الدائم على القرص افتح الخريطة من <b>start_window.bat</b> أو <b>start_kiosk.bat</b>. يُنصح بتنزيل نسخة احتياطية بعد التعديل.', 'متابعة والحفظ في المتصفح');
    acked = ok; return ok;
  }
  function changedFields(a, b) {
    const ks = new Set(Object.keys(a).concat(Object.keys(b))); ['updatedAt', 'sh', 'ph'].forEach(k => ks.delete(k));
    return [...ks].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  }
  /* change(uid, act, fn(record, store), opts) — applies, audits (with exact previous values) and saves */
  async function change(uid, act, fn, opts) {
    opts = opts || {};
    if (!canWrite() || !(await ackBrowserOnly())) return false;
    const structuralBefore = isStructural(STORE.get(uid));
    let entry = null;
    const p = STORE.commit(st => {
      const had = !!st.parcels[uid];
      const r = st.parcels[uid] || (st.parcels[uid] = {});
      const rawB = JSON.parse(JSON.stringify(r));
      const before = effFrom(uid, rawB);
      fn(r, st, before);
      const fields = changedFields(rawB, r);
      if (!fields.length) { if (!had) delete st.parcels[uid]; throw new Error('nochange'); }
      r.updatedAt = isoNow();
      const after = effFrom(uid, r);
      const rb = {}, ra = {}; fields.forEach(k => { if (k in rawB) rb[k] = rawB[k]; if (k in r) ra[k] = r[k]; });
      const sum = e => ({ plan: e.plan, no: e.no, area: e.area, status: e.status, price: e.price, notes: e.notes, deleted: e.deleted });
      entry = { act, uid, plan: after.plan, no: after.no, fields, rb, ra, before: sum(before), after: sum(after), mode: 'admin' };
      if (opts.note) entry.note = opts.note;
      if (opts.ref) entry.ref = opts.ref;
      return [entry];
    });
    let ok = true;
    await Promise.resolve();   // the mutation above has run synchronously; refresh the map right away
    if (!entry) { try { await p; } catch (e) { if (e.message === 'nochange') A.toast('لا يوجد تغيير للحفظ.'); else if (e.message === 'conflict') conflictMsg(); else A.toast('تعذّر تنفيذ العملية: ' + e.message, 8000); } return false; }
    if (structuralBefore || isStructural(STORE.get(uid))) A.rebuildLive(); else A.applyState(uid);
    A.applyState(uid); A.refreshCard(); L.refresh(); renderAdmin();
    p.then(() => { chip(); if (STORE.state.lastError === 'conflict') conflictMsg(); }).catch(() => { ok = false; chip(); });
    lastUndo = entry;
    return entry;
  }
  const isStructural = r => !!(r && (r.added || r.deleted || r.geom || r.no !== undefined || r.area !== undefined || r.plan !== undefined));
  function conflictMsg() {
    L.sheet({ title: 'تعارض في الحفظ', body: '<p class="sheet-p">بيانات الإدارة على القرص تغيّرت من نافذة أخرى للخريطة (مثلًا شاشة المعرض ونافذة المراجعة مفتوحتان معًا). لم يُكتب هذا التغيير فوقها حتى لا تضيع تعديلات النافذة الأخرى. أغلق هذه النافذة وافتح الخريطة من جديد، ثم أعد التعديل.</p>',
      actions: [{ label: 'إعادة تحميل الخريطة الآن', kind: 'primary', onClick: () => location.reload() }, { label: 'إغلاق', kind: 'ghost' }] });
  }

  /* ---------------- v1.25: admin password ---------------- */
  const AUTH = window.AridAuth;
  const ERR = { password: 'كلمة المرور غير صحيحة.', length: 'كلمة المرور الجديدة يجب أن تكون من 4 إلى 64 خانة.', service: 'تعذّر الاتصال بخدمة الحفظ المحلية. أعد تشغيل الخريطة من ملف التشغيل.',
    nohash: 'ملف كلمة المرور غير موجود (data/admin/admin_auth.js). انسخ المجلد كاملًا.', storage: 'تعذّر الحفظ في المتصفح.', locked: 'انتهت جلسة الإدارة. ادخل مرة أخرى.' };
  const errTxt = r => r.error === 'wait' ? 'محاولات خاطئة كثيرة. انتظر ' + num(r.wait || AUTH.waitLeft()) + ' ثانية ثم حاول مرة أخرى.' : (ERR[r.error] || 'تعذّر التحقق.');
  /* password field + on-screen digits (the exhibition screen may have no keyboard). Letters can be typed with a keyboard. */
  function pwField(label, id) {
    return `<label class="pw-l" for="${id}">${label}</label><div class="pw-row"><input class="pw-in" id="${id}" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" dir="ltr" maxlength="64"><button type="button" class="pw-eye" data-for="${id}" aria-label="إظهار أو إخفاء">إظهار</button></div>`;
  }
  function pwKeys(wrap) {
    let cur = wrap.querySelector('.pw-in');
    wrap.querySelectorAll('.pw-in').forEach(i => i.addEventListener('focus', () => { cur = i; }));
    const k = document.createElement('div'); k.className = 'pw-keys';
    k.innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(x => x === '' ? '<span></span>' : `<button type="button" data-k="${x}">${x === 'del' ? '⌫' : x}</button>`).join('');
    k.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b || !cur) return; cur.value = b.dataset.k === 'del' ? cur.value.slice(0, -1) : (cur.value + b.dataset.k).slice(0, 64); cur.focus(); });
    wrap.appendChild(k);
    wrap.querySelectorAll('.pw-eye').forEach(b => b.addEventListener('click', () => { const i = wrap.querySelector('#' + b.dataset.for); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'إظهار' : 'إخفاء'; }));
  }
  function askLogin() {
    return new Promise(res => {
      const wrap = document.createElement('div'); wrap.className = 'frm pw';
      wrap.innerHTML = `<p class="sheet-p">وضع الإدارة محمي بكلمة مرور. وضع العرض متاح للزوار دون كلمة مرور.</p>${pwField('كلمة مرور الإدارة', 'pw-login')}<p class="pw-err" role="alert" hidden></p>`;
      pwKeys(wrap);
      let done = false, busy = false;
      const err = wrap.querySelector('.pw-err'), inp = wrap.querySelector('#pw-login');
      const go = async () => {
        if (busy) return; busy = true; err.hidden = true;
        const r = await AUTH.login(inp.value); busy = false;
        if (r.ok) { inp.value = ''; done = true; sh.close(true); res(r); return; }
        err.innerHTML = errTxt(r); err.hidden = false; inp.value = ''; inp.focus();
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } e.stopPropagation(); });
      const sh = L.sheet({ title: 'الدخول إلى وضع الإدارة', body: wrap, onClose: () => { inp.value = ''; if (!done) res(null); },
        actions: [{ label: 'دخول', kind: 'primary', close: false, onClick: () => { go(); return false; } }, { label: 'إلغاء', kind: 'ghost', value: null }] });
      setTimeout(() => inp.focus(), 50);
    });
  }
  function changePasswordSheet(forced) {
    const wrap = document.createElement('div'); wrap.className = 'frm pw';
    wrap.innerHTML = (forced ? '<p class="sheet-p"><b>كلمة المرور الحالية هي الافتراضية.</b> يُنصح بتغييرها الآن.</p>' : '')
      + pwField('كلمة المرور الحالية', 'pw-cur') + pwField('كلمة المرور الجديدة (4 خانات على الأقل)', 'pw-new') + pwField('تأكيد كلمة المرور الجديدة', 'pw-new2')
      + '<p class="pw-err" role="alert" hidden></p><p class="muted small">يُفضَّل استخدام 6 خانات أو أكثر.</p>';
    pwKeys(wrap);
    const err = wrap.querySelector('.pw-err'), v = id => wrap.querySelector('#' + id).value;
    const clear = () => wrap.querySelectorAll('.pw-in').forEach(i => { i.value = ''; });
    wrap.querySelectorAll('.pw-in').forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
    let busy = false;
    const sh = L.sheet({ title: 'تغيير كلمة مرور الإدارة', body: wrap, onClose: clear, actions: [{ label: 'حفظ كلمة المرور الجديدة', kind: 'primary', close: false, onClick: () => {
      if (busy) return false; err.hidden = true;
      if (v('pw-new') !== v('pw-new2')) { err.textContent = 'كلمة المرور الجديدة وتأكيدها غير متطابقين.'; err.hidden = false; return false; }
      if (v('pw-new') === v('pw-cur')) { err.textContent = 'كلمة المرور الجديدة مطابقة للحالية.'; err.hidden = false; return false; }
      busy = true;
      AUTH.changePassword(v('pw-cur'), v('pw-new')).then(r => {
        busy = false;
        if (r.ok) { clear(); sh.close(true); A.toast(r.where === 'disk' ? 'تم تغيير كلمة مرور الإدارة وحفظها على هذا الجهاز.' : 'تم تغيير كلمة المرور وحفظها في هذا المتصفح (الخريطة مفتوحة دون خدمة الحفظ).', 6000); return; }
        if (r.error === 'locked') { clear(); sh.close(false); setMode('view'); A.toast(ERR.locked, 5000); return; }
        err.innerHTML = errTxt(r); err.hidden = false;
      });
      return false; } }, { label: 'إلغاء', kind: 'ghost', value: null }] });
  }
  function settingsSheet() {
    const key = (window.ADMIN_SETTINGS && window.ADMIN_SETTINGS.esri_api_key) || '';
    const wrap = document.createElement('div'); wrap.className = 'frm';
    wrap.innerHTML = `<div class="btn-col">
        <button type="button" class="btn primary" data-a="pw">تغيير كلمة مرور الإدارة</button>
        <button type="button" class="btn" data-a="lock">قفل وضع الإدارة الآن</button>
      </div>
      <h3 class="set-h">صور الأقمار الصناعية عالية الدقة (عبر الإنترنت)</h3>
      <p class="muted small">مفتاح خدمة الصور عالية الدقة، يُستخدم عند توفر الإنترنت. دون اتصال تُعرض الصور المخزّنة. ${key ? 'يوجد مفتاح محفوظ.' : 'لا يوجد مفتاح محفوظ.'}</p>
      <input class="pw-in" id="set-key" type="password" autocomplete="off" spellcheck="false" dir="ltr" placeholder="الصق المفتاح هنا" maxlength="400">
      <div class="btn-col"><button type="button" class="btn" data-a="key">حفظ المفتاح</button>${key ? '<button type="button" class="btn ghost" data-a="nokey">إزالة المفتاح</button>' : ''}</div>
      <p class="pw-err" role="alert" hidden></p>`;
    const err = wrap.querySelector('.pw-err');
    wrap.querySelector('#set-key').addEventListener('keydown', e => e.stopPropagation());
    const saveKey = async k => {
      const r = await AUTH.saveSettings({ esri_api_key: k });
      if (r.ok) { window.ADMIN_SETTINGS = { esri_api_key: k }; sh.close(true); A.toast(k ? 'حُفظ المفتاح. أعد تشغيل الخريطة لتفعيل الصور عالية الدقة.' : 'أُزيل المفتاح.', 6000); }
      else { err.textContent = r.error === 'key' ? 'المفتاح يحتوي على رموز غير صالحة.' : r.error === 'service' ? 'حفظ المفتاح يحتاج تشغيل الخريطة من ملف التشغيل (خدمة الحفظ المحلية).' : ERR.locked; err.hidden = false; }
    };
    wrap.querySelector('[data-a="pw"]').addEventListener('click', () => { sh.close(); changePasswordSheet(false); });
    wrap.querySelector('[data-a="lock"]').addEventListener('click', () => { sh.close(); setMode('view'); });
    wrap.querySelector('[data-a="key"]').addEventListener('click', () => { const k = wrap.querySelector('#set-key').value.trim(); if (k) saveKey(k); });
    const nk = wrap.querySelector('[data-a="nokey"]'); if (nk) nk.addEventListener('click', () => saveKey(''));
    const sh = L.sheet({ title: 'إعدادات الإدارة', body: wrap });
  }

  /* ---------------- mode switch ---------------- */
  let asking = false;
  async function setMode(m) {
    const want = m === 'admin';
    if (want === admin) return;
    if (want && !AUTH.unlocked) {   // v1.25: the password is asked before any admin tool appears
      if (asking) return; asking = true;
      document.querySelectorAll('#modesw button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === 'view')));
      const r = await askLogin(); asking = false;
      if (!r || !AUTH.unlocked) return;
      if (r.isDefault) setTimeout(() => changePasswordSheet(true), 400);
    }
    if (!want) { cancelSession(); document.querySelectorAll('.sheet-back').forEach(e => e.querySelector('.sheet-x').click()); }
    admin = want && STORE.setWritable(true);
    if (!want) { STORE.setWritable(false); if (AUTH.unlocked) AUTH.lock(); }
    else if (STORE.state.dirty && STORE.served) STORE.retry().then(chip);   // changes kept in the browser while signed out → write them to disk now
    if (want && !admin) return;
    document.body.classList.toggle('admin-mode', want);
    document.querySelectorAll('#modesw button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === (want ? 'admin' : 'view'))));
    renderAdmin(); if (A.refreshCard) A.refreshCard(); onCard(A.selected);
    A.toast(want ? 'وضع الإدارة: يمكنك الآن إضافة القطع وتعديلها وتغيير الأسعار والحالات.' : 'وضع العرض: أدوات الإدارة مخفية، والبيانات المحفوظة كما هي.', 3500);
  }

  /* ---------------- admin section in the panel ---------------- */
  function buildAdmin() {
    const sec = document.createElement('section'); sec.className = 'adm'; sec.id = 'adm'; sec.hidden = true;
    sec.innerHTML = `<div class="adm-head"><h2>إدارة الأراضي</h2><span class="chip" id="adm-chip"></span></div>
      <div class="adm-grid">
        <button type="button" class="btn primary" id="adm-add">إضافة قطعة جديدة</button>
        <button type="button" class="btn" id="adm-deleted">المحذوفات</button>
        <button type="button" class="btn" id="adm-log">سجل العمليات</button>
        <button type="button" class="btn" id="adm-backup">النسخ الاحتياطي</button>
        <button type="button" class="btn" id="adm-settings">الإعدادات وكلمة المرور</button>
        <button type="button" class="btn" id="adm-lock">قفل وضع الإدارة</button>
      </div>
      <p class="adm-tip">لتعديل قطعة: اضغط عليها على الخريطة أو ابحث برقمها، ثم استخدم أزرار الإدارة في بطاقتها.</p>`;
    $('panel').insertAdjacentElement('afterbegin', sec);
    $('adm-add').addEventListener('click', startDraw);
    $('adm-deleted').addEventListener('click', showDeleted);
    $('adm-log').addEventListener('click', () => showLog(null));
    $('adm-backup').addEventListener('click', showBackup);
    $('adm-settings').addEventListener('click', settingsSheet);
    $('adm-lock').addEventListener('click', () => setMode('view'));
  }
  function chip() {
    const c = $('adm-chip'); if (!c) return; const s = STORE.state;
    let cls = 'ok', t = 'محفوظ على القرص';
    if (s.lastError === 'conflict') { cls = 'bad'; t = 'تعارض — أعد التحميل'; }
    else if (s.lastError === 'auth') { cls = 'bad'; t = 'انتهت الجلسة — ادخل مرة أخرى'; }
    else if (!STORE.served) { cls = 'warn'; t = 'الحفظ في المتصفح فقط'; }
    else if (s.dirty || !s.disk) { cls = 'warn'; t = 'لم يُكتب على القرص — اضغط لإعادة المحاولة'; }
    c.className = 'chip ' + cls; c.textContent = t;
    c.onclick = (cls === 'warn' && STORE.served) ? () => STORE.retry().then(chip) : null;
  }
  function renderAdmin() {
    const sec = $('adm'); if (!sec) return; sec.hidden = !admin; if (!admin) return;
    const del = Object.values(STORE.store.parcels).filter(r => r.deleted).length;
    $('adm-deleted').innerHTML = 'المحذوفات' + (del ? ' ' + num(del) : '');
    chip();
  }

  /* ---------------- admin actions on the parcel card ---------------- */
  function onCard(f) {
    const box = $('c-admin'); if (!box) return;
    if (!admin || !f) { box.hidden = true; box.innerHTML = ''; return; }
    const uid = f.properties.uid, st = A.statusOf(f), r = STORE.get(uid) || {};
    const base = A.BASE_UID.has(uid), modified = base && isStructural(r);
    const src = A.statusSource(f);
    box.hidden = false;
    box.innerHTML = `<div class="adm-label">الحالة ${src === 'admin' ? '<small class="muted">(من لوحة الإدارة)</small>' : src === 'csv' ? '<small class="muted">(من ملف البيع)</small>' : ''}</div>
      <div class="seg st-seg" role="group" aria-label="حالة الأرض">${ST_SET.map(s => `<button type="button" data-s="${s}" aria-pressed="${s === st}" style="--c:${L.ST_COLOR[s]}"><i class="sw"></i>${L.ST_SHORT[s]}</button>`).join('')}</div>
      <div class="adm-btns">
        <button type="button" class="btn" data-a="price">السعر</button>
        <button type="button" class="btn" data-a="edit">تعديل البيانات</button>
        <button type="button" class="btn" data-a="geom">تعديل الحدود</button>
        <button type="button" class="btn" data-a="hist">سجل القطعة</button>
        ${modified ? '<button type="button" class="btn" data-a="revert">استعادة الأصل</button>' : ''}
        <button type="button" class="btn danger" data-a="del">حذف القطعة</button>
      </div>
      <div class="adm-flash" id="adm-flash" hidden></div>`;
    box.querySelectorAll('.st-seg button').forEach(b => b.addEventListener('click', () => setStatus(uid, b.dataset.s)));
    box.querySelectorAll('.adm-btns button').forEach(b => b.addEventListener('click', () => ({ price: editPrice, edit: editData, geom: startEdit, hist: () => showLog(uid), revert: revertParcel, del: deleteParcel })[b.dataset.a](uid)));
    if (lastUndo && lastUndo.uid === uid && Date.now() - Date.parse(lastUndo.at) < 60000) flash(lastUndo);
  }
  function flash(e) {
    const el = $('adm-flash'); if (!el) return;
    el.hidden = false;
    el.innerHTML = `<span>تم الحفظ: ${ACT[e.act] || e.act}${e.act === 'status' ? ' ← ' + L.ST_SHORT[e.after.status] : ''}</span><button type="button" class="link">تراجع</button>`;
    el.querySelector('button').addEventListener('click', () => undoEntry(e, true));
  }

  async function setStatus(uid, s) {
    const f = A.byUid.get(uid); if (!f) return;
    if (A.statusOf(f) === 'service' && !(await L.confirm('أرض خدمات', 'استخدام هذه القطعة: «' + A.svcLabel(f.properties) + '». هل تريد تغيير حالتها إلى «' + L.ST_SHORT[s] + '»؟', 'تغيير الحالة'))) return;
    const e = await change(uid, 'status', (r, st, before) => {
      r.status = s; r.sh = (r.sh || []).concat([{ at: isoNow(), from: before.status, to: s }]);
    });
    if (e) A.toast('الحالة الآن: ' + L.ST_SHORT[s], 2500);
  }

  /* ---------------- price ---------------- */
  function editPrice(uid) {
    const f = A.byUid.get(uid); if (!f) return;
    const area = Number(f.properties.area) || 0;
    const cur = A.priceInfo(f);
    const d = { amount: cur ? cur.amount : null, currency: cur ? cur.currency : 'SAR', unit: cur ? cur.unit : 'total' };
    const r = STORE.get(uid) || {};
    const wrap = document.createElement('div'); wrap.className = 'frm';
    const draw = () => {
      const total = d.amount ? (d.unit === 'sqm' ? d.amount * area : d.amount) : null, per = d.amount ? (d.unit === 'sqm' ? d.amount : (area ? d.amount / area : null)) : null;
      const cn = A.CURRENCY[d.currency];
      wrap.innerHTML = `<p class="sheet-p">قطعة ${num(A.esc(f.properties.no || '—'))} — ${A.planLabel(f.properties.plan)} — المساحة ${num(n0(Math.round(area)))} م²</p>
        <div class="frm-row"><span class="frm-l">نوع السعر</span><div class="seg" data-g="unit"><button type="button" data-v="total" aria-pressed="${d.unit === 'total'}">سعر إجمالي للقطعة</button><button type="button" data-v="sqm" aria-pressed="${d.unit === 'sqm'}">سعر للمتر المربع</button></div></div>
        <div class="frm-row"><span class="frm-l">${d.unit === 'sqm' ? 'سعر المتر' : 'السعر'}</span><button type="button" class="nf big" data-f="amount">${d.amount ? num(A.fmtMoney(d.amount)) : '<span class="muted">اضغط لإدخال السعر</span>'}</button></div>
        <div class="frm-row"><span class="frm-l">العملة</span><div class="seg" data-g="currency">${CUR_ORDER.map(c => `<button type="button" data-v="${c}" aria-pressed="${d.currency === c}">${A.CURRENCY[c]}</button>`).join('')}</div></div>
        <div class="calc">${total ? `الإجمالي: <b>${num(A.fmtMoney(total))}</b> ${cn}<br>سعر المتر: <b>${per != null ? num(A.fmtMoney(per)) : '—'}</b> ${cn} / م²` : 'لم يُدخل سعر.'}</div>
        <div class="hist"><h3>السعر الحالي: ${cur ? priceTxt(cur) + (cur.src === 'csv' ? ' <small class="muted">(من ملف البيع)</small>' : '') : 'غير محدد'}</h3>
        ${(r.ph || []).length ? '<ol>' + r.ph.slice().reverse().map(h => `<li>${A.fmtDate(h.at)}: ${priceTxt(h.from)} ← ${priceTxt(h.to)}</li>`).join('') + '</ol>' : '<p class="muted">لا يوجد تاريخ تعديلات سابق لهذه القطعة.</p>'}</div>`;
      wrap.querySelectorAll('.seg').forEach(g => g.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { d[g.dataset.g] = b.dataset.v; draw(); })));
      wrap.querySelector('[data-f="amount"]').addEventListener('click', async () => { const v = await L.numpad({ title: d.unit === 'sqm' ? 'سعر المتر المربع' : 'السعر الإجمالي', value: d.amount, decimals: true }); if (v !== null && v !== '') { d.amount = v; draw(); } });
    };
    draw();
    L.sheet({ title: 'سعر القطعة', body: wrap, actions: [
      { label: 'حفظ السعر', kind: 'primary', close: false, onClick: (close) => {
        if (!(d.amount > 0)) { A.toast('أدخل سعرًا أكبر من صفر، أو استخدم «إزالة السعر».'); return false; }
        const np = { amount: d.amount, currency: d.currency, unit: d.unit };
        change(uid, 'price', (rr, st, before) => { rr.price = np; rr.ph = (rr.ph || []).concat([{ at: isoNow(), from: before.price, to: np }]); }).then(e => { if (e) close(); });
        return false; } },
      { label: 'إزالة السعر (غير محدد)', kind: 'danger', close: false, onClick: (close) => {
        if (!cur) { A.toast('لا يوجد سعر لهذه القطعة.'); return false; }
        L.confirm('إزالة السعر', 'سيُعرض سعر هذه القطعة «غير محدد». السعر الحالي يبقى في تاريخ التعديلات ويمكن التراجع.', 'إزالة السعر', 'danger').then(ok => {
          if (ok) change(uid, 'price_remove', (rr, st, before) => { rr.price = null; rr.ph = (rr.ph || []).concat([{ at: isoNow(), from: before.price, to: null }]); }).then(e => { if (e) close(); });
        });
        return false; } },
      { label: 'إلغاء', kind: 'ghost' }] });
  }

  /* ---------------- parcel data form (edit an existing parcel, or a newly drawn one) ---------------- */
  function planOptions() { return A.plans.slice().sort(); }
  function dupCount(plan, no, exceptUid) { if (!no) return 0; return (A.byNo.get(plan + '|' + A.normNo(no)) || []).filter(f => f.properties.uid !== exceptUid).length; }
  function dataForm(init, opts) {
    return new Promise(res => {
      const d = Object.assign({}, init);
      const wrap = document.createElement('div'); wrap.className = 'frm';
      const draw = () => {
        const dups = dupCount(d.plan, d.no, opts.uid);
        wrap.innerHTML = `${opts.intro || ''}
          <div class="frm-row"><span class="frm-l">رقم المخطط</span><button type="button" class="nf" data-f="plan">${d.plan ? num(A.esc(d.plan)) : '<span class="muted">اختر المخطط</span>'}</button></div>
          ${opts.planNote ? '<p class="muted small">' + opts.planNote + '</p>' : ''}
          <div class="frm-row"><span class="frm-l">رقم القطعة</span><button type="button" class="nf big" data-f="no">${d.no ? num(A.esc(d.no)) : '<span class="muted">اضغط لإدخال الرقم</span>'}</button></div>
          ${dups ? `<p class="warn small">الرقم ${num(A.esc(d.no))} مكتوب على ${dups === 1 ? 'قطعة أخرى' : dups + ' قطع أخرى'} في هذا المخطط. يمكن الحفظ، والتمييز بالمعرّف.</p>` : ''}
          <div class="frm-row"><span class="frm-l">المساحة (م²)</span><button type="button" class="nf" data-f="area">${d.area ? num(n0(d.area)) : '<span class="muted">—</span>'}</button></div>
          ${d.computedArea ? `<p class="muted small">المساحة المحسوبة من الحدود: ${num(n0(Math.round(d.computedArea)))} م² ${Math.round(d.computedArea) !== Math.round(d.area || 0) ? '<button type="button" class="link" data-f="usecomp">استخدامها</button>' : '✓'}</p>` : ''}
          ${opts.withStatus ? `<div class="frm-row"><span class="frm-l">الحالة</span><div class="seg" data-g="status">${ST_SET.map(s => `<button type="button" data-v="${s}" aria-pressed="${d.status === s}">${L.ST_SHORT[s]}</button>`).join('')}</div></div>` : ''}
          <div class="frm-row col"><span class="frm-l">ملاحظات (اختياري)</span><textarea rows="2" maxlength="300" data-f="notes" dir="rtl"></textarea></div>
          ${opts.warn ? '<p class="warn small">' + opts.warn + '</p>' : ''}`;
        const ta = wrap.querySelector('textarea'); ta.value = d.notes || ''; ta.addEventListener('input', () => { d.notes = ta.value; });
        wrap.querySelector('[data-f="plan"]').addEventListener('click', async () => { const p = await pickPlan(d.plan); if (p) { d.plan = p; draw(); } });
        wrap.querySelector('[data-f="no"]').addEventListener('click', async () => { const v = await L.numpad({ title: 'رقم القطعة', value: d.no, parcelNo: true, allowEmpty: true, hint: 'للأرقام مثل 3437/أ استخدم زر / ثم أ.' }); if (v !== null) { d.no = String(v).trim(); draw(); } });
        wrap.querySelector('[data-f="area"]').addEventListener('click', async () => { const v = await L.numpad({ title: 'المساحة (م²)', value: d.area, decimals: true }); if (v !== null && v !== '') { d.area = v; draw(); } });
        const uc = wrap.querySelector('[data-f="usecomp"]'); if (uc) uc.addEventListener('click', () => { d.area = Math.round(d.computedArea * 100) / 100; draw(); });
        wrap.querySelectorAll('.seg[data-g]').forEach(g => g.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { d[g.dataset.g] = b.dataset.v; draw(); })));
      };
      draw();
      let out = null;
      L.sheet({ title: opts.title, body: wrap, onClose: () => res(out), actions: [
        { label: opts.okLabel || 'حفظ', kind: 'primary', close: false, onClick: (close) => {
          if (!d.plan) { A.toast('اختر رقم المخطط.'); return false; }
          if (!(d.area > 0)) { A.toast('أدخل مساحة صحيحة.'); return false; }
          if (!d.no && opts.requireNo) { A.toast('أدخل رقم القطعة.'); return false; }
          out = d; close(true); return false; } },
        { label: 'إلغاء', kind: 'ghost' }] });
    });
  }
  function pickPlan(cur) {
    return new Promise(res => {
      const wrap = document.createElement('div'); wrap.className = 'plan-pick';
      wrap.innerHTML = planOptions().map(p => `<button type="button" data-p="${A.esc(p)}" aria-pressed="${p === cur}">${num(A.esc(p))}</button>`).join('');
      let out = null;
      const sh = L.sheet({ title: 'اختر المخطط', body: wrap, onClose: () => res(out) });
      wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { out = b.dataset.p; sh.close(true); }));
    });
  }
  async function editData(uid) {
    const f = A.byUid.get(uid); if (!f) return;
    const p = f.properties, comp = A.geomArea(f.geometry);
    const d = await dataForm({ plan: p.plan, no: p.no || '', area: Math.round(p.area * 100) / 100, notes: A.notesOf(f), computedArea: comp },
      { title: 'تعديل بيانات القطعة', uid, planNote: A.BASE_UID.has(uid) ? 'تغيير المخطط لقطعة من بيانات المصدر يحتاج تأكيدًا.' : '' });
    if (!d) return;
    if (A.BASE_UID.has(uid) && d.plan !== A.BASE_UID.get(uid).properties.plan && !(await L.confirm('تغيير المخطط', 'ستُنقل القطعة من ' + A.planLabel(p.plan) + ' إلى ' + A.planLabel(d.plan) + ' في العرض والبحث. الأصل محفوظ ويمكن استعادته.', 'نقل القطعة'))) return;
    const bp = A.BASE_UID.has(uid) ? A.BASE_UID.get(uid).properties : null;
    await change(uid, 'edit', (r) => {
      // a value equal to the source data is not stored as an override
      const setOv = (k, v, bv) => { if (bp && v === bv) delete r[k]; else r[k] = v; };
      setOv('plan', d.plan, bp && bp.plan); setOv('no', d.no, bp && (bp.no || '')); setOv('area', d.area, bp && bp.area);
      const s = A.sales.get(uid); const csvN = (s && s.notes) || '';
      if ((d.notes || '') === csvN) delete r.notes; else r.notes = d.notes || '';
      if (r.added) { r.plan = d.plan; r.no = d.no; r.area = d.area; }
    });
  }

  /* ---------------- delete / restore / revert ---------------- */
  async function deleteParcel(uid) {
    const f = A.byUid.get(uid); if (!f) return;
    const p = f.properties;
    const ok = await L.confirm('حذف القطعة', `هل تريد حذف القطعة رقم ${num(A.esc(p.no || '—'))} من ${A.planLabel(p.plan)} (المساحة ${num(n0(Math.round(p.area)))} م²)؟<br>ستختفي من الخريطة والبحث والإحصاءات. لا يُحذف شيء نهائيًا: تبقى في «المحذوفات» ويمكن استعادتها مع حالتها وسعرها.`, 'حذف القطعة', 'danger');
    if (!ok) return;
    const e = await change(uid, 'delete', (r) => { r.deleted = { at: isoNow() }; });
    if (e) { A.clearSelection(); A.toast('حُذفت القطعة. يمكن استعادتها من «المحذوفات».', 5000); }
  }
  async function restoreParcel(uid) {
    const e = await change(uid, 'restore', (r) => { delete r.deleted; });
    if (e) { A.selectUid(uid, true); A.toast('استُعيدت القطعة.', 3000); }
    return e;
  }
  async function revertParcel(uid) {
    const ok = await L.confirm('استعادة الأصل', 'ستعود حدود القطعة ورقمها ومساحتها ومخططها وملاحظاتها كما في بيانات المصدر. الحالة والسعر لا يتغيران. العملية تُسجَّل ويمكن التراجع عنها.', 'استعادة الأصل');
    if (!ok) return;
    await change(uid, 'revert', (r) => { ['geom', 'no', 'area', 'plan', 'notes'].forEach(k => delete r[k]); });
  }
  async function undoEntry(e, fromFlash) {
    if (!e || !e.fields) return;
    const r = STORE.get(e.uid) || {};
    const later = e.fields.some(k => JSON.stringify(r[k]) !== JSON.stringify(e.ra[k]));
    const ok = await L.confirm('تراجع عن العملية', `تراجع عن «${ACT[e.act] || e.act}» للقطعة ${num(A.esc(e.no || '—'))} (${A.planLabel(e.plan)}) بتاريخ ${A.fmtDate(e.at)}.` + (later ? '<br><b>تنبيه:</b> عُدّلت القطعة بعد هذه العملية؛ التراجع يعيد القيم التي كانت قبلها.' : ''), 'تراجع');
    if (!ok) return;
    const res = await change(e.uid, 'undo', (rr, st, before) => {
      e.fields.forEach(k => { if (k in e.rb) rr[k] = JSON.parse(JSON.stringify(e.rb[k])); else delete rr[k]; });
      const after = effFrom(e.uid, rr);
      if (e.fields.includes('status')) rr.sh = (rr.sh || []).concat([{ at: isoNow(), from: before.status, to: after.status, undo: e.id }]);
      if (e.fields.includes('price')) rr.ph = (rr.ph || []).concat([{ at: isoNow(), from: before.price, to: after.price, undo: e.id }]);
    }, { ref: e.id });
    if (res) { if (A.byUid.get(e.uid)) A.selectUid(e.uid, !fromFlash); else A.clearSelection(); }
  }

  /* ---------------- lists: deleted, audit log, backup ---------------- */
  function showDeleted() {
    const rows = Object.entries(STORE.store.parcels).filter(([, r]) => r.deleted);
    const wrap = document.createElement('div'); wrap.className = 'list';
    if (!rows.length) wrap.innerHTML = '<p class="muted">لا توجد قطع محذوفة.</p>';
    rows.sort((a, b) => b[1].deleted.at.localeCompare(a[1].deleted.at)).forEach(([uid, r]) => {
      const e = effFrom(uid, r); const it = document.createElement('div'); it.className = 'list-row';
      it.innerHTML = `<div><b>قطعة ${num(A.esc(e.no || '—'))}</b> — ${A.planLabel(e.plan)} — ${num(n0(Math.round(e.area || 0)))} م²<br><small class="muted">حُذفت ${A.fmtDate(r.deleted.at)} · ${L.ST_SHORT[e.status] || ''}${e.price ? ' · ' + priceTxt(e.price) : ''} · <bdi dir="ltr">${A.esc(uid)}</bdi></small></div><button type="button" class="btn primary">استعادة</button>`;
      it.querySelector('button').addEventListener('click', async () => { const ok = await restoreParcel(uid); if (ok) sh.close(); });
      wrap.appendChild(it);
    });
    const sh = L.sheet({ title: 'القطع المحذوفة', body: wrap, wide: true });
  }
  const KIND = { all: () => true, add: a => a.act === 'add', edit: a => ['edit', 'geom', 'revert'].includes(a.act), del: a => ['delete', 'restore'].includes(a.act), price: a => ['price', 'price_remove'].includes(a.act), status: a => a.act === 'status', other: a => ['undo', 'restore_backup'].includes(a.act) };
  function describe(a) {
    const b = a.before || {}, c = a.after || {}, out = [];
    if (a.act === 'add') return 'رقم ' + (c.no || '—') + ' · ' + n0(Math.round(c.area || 0)) + ' م² · ' + (L.ST_SHORT[c.status] || c.status) + (c.price ? ' · ' + priceTxt(c.price) : '');
    if (a.act === 'restore_backup') return 'استُعيدت نسخة احتياطية (' + (a.after ? a.after.parcels : '') + ' قطعة معدّلة)';
    (a.fields || []).forEach(k => {
      if (k === 'status') out.push('الحالة: ' + (L.ST_SHORT[b.status] || b.status) + ' ← ' + (L.ST_SHORT[c.status] || c.status));
      else if (k === 'price') out.push('السعر: ' + priceTxt(b.price) + ' ← ' + priceTxt(c.price));
      else if (k === 'no') out.push('الرقم: ' + (b.no || '—') + ' ← ' + (c.no || '—'));
      else if (k === 'area') out.push('المساحة: ' + n0(Math.round(b.area || 0)) + ' ← ' + n0(Math.round(c.area || 0)) + ' م²');
      else if (k === 'plan') out.push('المخطط: ' + b.plan + ' ← ' + c.plan);
      else if (k === 'geom') out.push('الحدود الهندسية');
      else if (k === 'notes') out.push('الملاحظات');
      else if (k === 'deleted') out.push(c.deleted ? 'حُذفت' : 'استُعيدت');
      else if (k === 'added') out.push('أضيفت');
    });
    return out.join(' · ');
  }
  function showLog(uid) {
    const wrap = document.createElement('div'); wrap.className = 'log';
    let kind = 'all';
    const draw = () => {
      const all = STORE.store.audit.filter(a => (!uid || a.uid === uid) && KIND[kind](a)).slice().reverse();
      wrap.innerHTML = (uid ? '' : `<div class="seg wrap" role="group">${[['all', 'الكل'], ['add', 'إضافة'], ['edit', 'تعديل'], ['del', 'حذف واستعادة'], ['price', 'الأسعار'], ['status', 'الحالات'], ['other', 'أخرى']].map(([k, t]) => `<button type="button" data-k="${k}" aria-pressed="${k === kind}">${t}</button>`).join('')}</div>`)
        + `<p class="muted small">${n0(all.length)} عملية${uid ? ' على هذه القطعة' : ''}. السجل الكامل محفوظ أيضًا في <bdi dir="ltr">data/admin/audit_log.jsonl</bdi>.</p>`
        + (all.length ? '' : '<p class="muted">لا توجد عمليات مسجلة بعد.</p>')
        + all.slice(0, 300).map(a => `<div class="log-row"><div class="log-main"><b>${ACT[a.act] || a.act}</b>${a.uid ? ` — قطعة ${num(A.esc(a.no || '—'))} · ${A.planLabel(a.plan || '')}` : ''}<br><span>${A.esc(describe(a))}</span><br><small class="muted">${A.fmtDate(a.at)}${a.ref ? ' · تراجع عن عملية سابقة' : ''}</small></div>
          <div class="log-act">${a.uid && A.byUid.get(a.uid) ? `<button type="button" class="link" data-go="${A.esc(a.uid)}">عرض</button>` : ''}${a.fields && a.act !== 'restore_backup' ? `<button type="button" class="link" data-undo="${a.id}">تراجع</button>` : ''}</div></div>`).join('');
      wrap.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { kind = b.dataset.k; draw(); }));
      wrap.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { sh.close(); A.selectUid(b.dataset.go, true); }));
      wrap.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', () => { const e = STORE.store.audit.find(x => x.id === b.dataset.undo); sh.close(); undoEntry(e); }));
    };
    draw();
    const sh = L.sheet({ title: uid ? 'سجل القطعة' : 'سجل العمليات الإدارية', body: wrap, wide: true,
      actions: uid ? [] : [{ label: 'تنزيل السجل (CSV)', kind: '', close: false, onClick: () => { download('aridmap_audit_' + stamp() + '.csv', auditCSV()); return false; } }] });
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const csvCell = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function auditCSV() {
    const h = ['time', 'action', 'action_ar', 'parcel_uid', 'plan', 'parcel_no', 'details', 'fields', 'rev', 'id', 'undo_of'];
    return '﻿' + h.join(',') + '\r\n' + STORE.store.audit.map(a => [a.at, a.act, ACT[a.act] || '', a.uid || '', a.plan || '', a.no || '', describe(a), (a.fields || []).join('|'), a.rev, a.id, a.ref || ''].map(csvCell).join(',')).join('\r\n');
  }
  function tableCSV(onlyChanged) {
    const h = ['parcel_uid', 'plan', 'parcel_no', 'area_m2', 'status', 'price_total', 'price_per_m2', 'currency', 'price_entered_as', 'notes', 'last_admin_update', 'source'];
    const rows = [];
    const add = (uid, f, del) => {
      const p = f.properties; const pr = A.priceInfo(f);
      rows.push([uid, p.plan, p.no, Math.round(p.area * 100) / 100, del ? 'محذوفة' : L.ST_SHORT[A.statusOf(f)], pr ? Math.round(pr.total) : '', pr && pr.perSqm != null ? Math.round(pr.perSqm * 100) / 100 : '', pr ? pr.currency : '', pr ? (pr.unit === 'sqm' ? 'per_m2' : 'total') : '', A.notesOf(f), (STORE.get(uid) || {}).updatedAt || '', p.flags.includes('admin_added') ? 'admin' : (p.adm ? 'base+admin' : 'base')].map(csvCell).join(','));
    };
    if (onlyChanged) Object.keys(STORE.store.parcels).forEach(uid => { const f = A.byUid.get(uid); if (f) add(uid, f); else { const r = STORE.get(uid); if (r.deleted) { const b = A.BASE_UID.get(uid); const e = effFrom(uid, r); rows.push([uid, e.plan, e.no, e.area, 'محذوفة', '', '', '', '', e.notes, r.updatedAt || '', b ? 'base' : 'admin'].map(csvCell).join(',')); } } });
    else for (const [uid, f] of A.byUid) add(uid, f);
    return '﻿' + h.join(',') + '\r\n' + rows.join('\r\n');
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv;charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    A.toast('تم تنزيل الملف ' + name + ' إلى مجلد التنزيلات.', 4000);
  }
  function showBackup() {
    const s = STORE.state, st = STORE.store;
    const wrap = document.createElement('div'); wrap.className = 'frm';
    wrap.innerHTML = `<div class="calc">
      ${STORE.served ? (s.disk && !s.dirty ? '✓ كل التعديلات محفوظة على القرص في مجلد <bdi dir="ltr">data\\admin</bdi> (نسخة لكل تعديل في <bdi dir="ltr">data\\admin\\backups</bdi>).' : '⚠ آخر تعديل لم يُكتب على القرص بعد — محفوظ في المتصفح.') : '⚠ الخريطة مفتوحة دون خدمة الحفظ: التعديلات في هذا المتصفح فقط. نزّل نسخة احتياطية.'}
      <br>قطع لها تعديلات: <b>${num(n0(Object.keys(st.parcels).length))}</b> · عمليات في السجل: <b>${num(n0(st.audit.length))}</b> · رقم الإصدار: ${num(st.rev)}${st.savedAt ? ' · آخر حفظ: ' + A.fmtDate(st.savedAt) : ''}</div>
      <div class="btn-col">
        <button type="button" class="btn primary" data-a="json">تنزيل نسخة احتياطية كاملة (JSON)</button>
        <button type="button" class="btn" data-a="csv1">تنزيل جدول القطع المعدّلة (CSV — Excel)</button>
        <button type="button" class="btn" data-a="csv2">تنزيل جدول كل القطع بالحالة والسعر (CSV — Excel)</button>
        <button type="button" class="btn" data-a="log">تنزيل سجل العمليات (CSV)</button>
        <label class="btn file">استعادة من نسخة احتياطية…<input type="file" accept=".json,application/json" hidden></label>
      </div>
      <p class="muted small">الاستعادة تستبدل كل تعديلات الإدارة الحالية بمحتوى النسخة المختارة (بيانات المخططات الأصلية لا تتأثر). تُحفظ نسخة من الوضع الحالي تلقائيًا قبل الاستبدال، والعملية تُسجَّل.</p>`;
    wrap.querySelector('[data-a="json"]').addEventListener('click', () => download('aridmap_admin_backup_' + stamp() + '.json', STORE.exportJSON(), 'application/json'));
    wrap.querySelector('[data-a="csv1"]').addEventListener('click', () => download('aridmap_parcels_changed_' + stamp() + '.csv', tableCSV(true)));
    wrap.querySelector('[data-a="csv2"]').addEventListener('click', () => download('aridmap_parcels_all_' + stamp() + '.csv', tableCSV(false)));
    wrap.querySelector('[data-a="log"]').addEventListener('click', () => download('aridmap_audit_' + stamp() + '.csv', auditCSV()));
    wrap.querySelector('input[type=file]').addEventListener('change', ev => {
      const file = ev.target.files[0]; if (!file) return;
      const rd = new FileReader();
      rd.onload = async () => {
        let obj = null; try { obj = JSON.parse(rd.result); } catch (e) { /* invalid */ }
        if (!STORE.valid(obj)) { A.toast('الملف ليس نسخة احتياطية صحيحة لخريطة عريض.', 6000); return; }
        const unknown = Object.keys(obj.parcels).filter(u => !A.BASE_UID.has(u) && !obj.parcels[u].added).length;
        const ok = await L.confirm('استعادة نسخة احتياطية', `النسخة: ${A.esc(file.name)}<br>قطع معدّلة فيها: ${n0(Object.keys(obj.parcels).length)} · تاريخ آخر حفظ: ${obj.savedAt ? A.fmtDate(obj.savedAt) : '—'}${unknown ? '<br><b>تنبيه:</b> ' + unknown + ' معرّفًا غير موجود في المخططات المعروضة وسيُتجاهل في العرض.' : ''}<br>ستُستبدل تعديلات الإدارة الحالية (${n0(Object.keys(STORE.store.parcels).length)} قطعة).`, 'استعادة', 'danger');
        if (!ok || !canWrite() || !(await ackBrowserOnly())) return;
        const before = JSON.parse(STORE.exportJSON());
        download('aridmap_admin_before_restore_' + stamp() + '.json', JSON.stringify(before), 'application/json');
        const changedUids = new Set(Object.keys(before.parcels).concat(Object.keys(obj.parcels)));
        try { await STORE.restoreFrom(obj, file.name); } catch (e) { A.toast('تعذّرت الاستعادة: ' + e.message, 8000); return; }
        A.rebuildLive(); changedUids.forEach(u => A.applyState(u)); A.refreshCard(); L.refresh(); renderAdmin();
        A.toast('تمت استعادة النسخة الاحتياطية.', 4000); sh.close();
      };
      rd.readAsText(file, 'utf-8');
    });
    const sh = L.sheet({ title: 'النسخ الاحتياطي والتصدير', body: wrap, wide: true });
  }

  /* ---------------- drawing a new parcel / editing a boundary ---------------- */
  const EDIT_SRC = 'adm-edit';
  function ensureEditLayers() {
    if (map.getSource(EDIT_SRC)) return;
    map.addSource(EDIT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'adm-edit-fill', type: 'fill', source: EDIT_SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#f2d48c', 'fill-opacity': 0.28 } });
    map.addLayer({ id: 'adm-edit-line', type: 'line', source: EDIT_SRC, paint: { 'line-color': '#fff6dc', 'line-width': 2.5 * A.TS, 'line-dasharray': [2, 1] } });
  }
  function sessionGeoJSON() {
    const p = session.pts, fs = [];
    if (p.length >= 3) fs.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [p.concat([p[0]])] } });
    else if (p.length >= 2) fs.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p } });
    return { type: 'FeatureCollection', features: fs };
  }
  function bar() {
    let b = $('edit-bar');
    if (!b) { b = document.createElement('div'); b.id = 'edit-bar'; b.className = 'edit-bar'; document.body.appendChild(b); }
    return b;
  }
  function polyArea() { const p = session.pts; return p.length >= 3 ? A.geomArea({ type: 'Polygon', coordinates: [p.concat([p[0]])] }) : 0; }
  function selfIntersects(p) {
    const n = p.length; const seg = i => [p[i], p[(i + 1) % n]];
    const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const x = (a, b, c, d) => { const d1 = cr(c, d, a), d2 = cr(c, d, b), d3 = cr(a, b, c), d4 = cr(a, b, d); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 && d2 && d3 && d4; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue; const [a, b] = seg(i), [c, d] = seg(j); if (x(a, b, c, d)) return true; }
    return false;
  }
  function redraw() {
    if (!session) return;
    map.getSource(EDIT_SRC).setData(sessionGeoJSON());
    const b = bar(), a = polyArea(), draw = session.mode === 'draw';
    b.innerHTML = `<div class="eb-txt"><b>${draw ? 'رسم قطعة جديدة' : 'تعديل حدود القطعة ' + num(A.esc(session.no || '—'))}</b>
      <span>${draw ? 'اضغط على الخريطة لإضافة نقاط الحدود بالترتيب حول القطعة (3 نقاط على الأقل).' : 'اسحب النقاط لتحريكها. اضغط النقطة الصغيرة بين نقطتين لإضافة نقطة. اضغط نقطة ثم «حذف النقطة» لإزالتها.'}</span>
      <span>النقاط: ${num(session.pts.length)} · المساحة الحالية: ${num(n0(Math.round(a)))} م²${session.origArea ? ' · المسجلة: ' + num(n0(Math.round(session.origArea))) + ' م²' : ''}</span></div>
      <div class="eb-btns">
        <label class="eb-snap"><input type="checkbox" ${session.snap ? 'checked' : ''}> التقاط حدود القطع المجاورة</label>
        <button type="button" class="btn" data-a="undo" ${session.hist.length ? '' : 'disabled'}>تراجع</button>
        ${draw ? '' : `<button type="button" class="btn" data-a="delpt" ${session.selIdx != null && session.pts.length > 3 ? '' : 'disabled'}>حذف النقطة</button>`}
        <button type="button" class="btn primary" data-a="done" ${session.pts.length >= 3 ? '' : 'disabled'}>${draw ? 'إنهاء الرسم' : 'حفظ الحدود'}</button>
        <button type="button" class="btn ghost" data-a="cancel">إلغاء</button></div>`;
    b.querySelector('input').addEventListener('change', e => { session.snap = e.target.checked; });
    b.querySelectorAll('button[data-a]').forEach(x => x.addEventListener('click', () => ({ undo: undoPt, delpt: delPt, done: finish, cancel: cancelSession })[x.dataset.a]()));
  }
  function pushHist() { session.hist.push(JSON.stringify(session.pts)); if (session.hist.length > 100) session.hist.shift(); }
  function undoPt() { if (!session.hist.length) return; session.pts = JSON.parse(session.hist.pop()); session.selIdx = null; markers(); redraw(); }
  function delPt() { if (session.selIdx == null || session.pts.length <= 3) return; pushHist(); session.pts.splice(session.selIdx, 1); session.selIdx = null; markers(); redraw(); }
  /* snap to the nearest corner of a neighbouring parcel within ~14 px (keeps shared boundaries exact) */
  function snap(ll) {
    if (!session.snap) return ll;
    const pt = map.project(ll), R = 14 * Math.max(1, A.TS);
    const fs = map.queryRenderedFeatures([[pt.x - R, pt.y - R], [pt.x + R, pt.y + R]], { layers: ['parcel-fill', 'adm-fill'].filter(l => map.getLayer(l)) });
    let best = null, bd = R * R;
    for (const f of fs) {
      if (session.uid && f.properties.uid === session.uid) continue;
      const lf = A.byUid.get(f.properties.uid); if (!lf) continue;   // full-precision geometry (rendered tiles are simplified)
      const rings = lf.geometry.type === 'Polygon' ? lf.geometry.coordinates : [].concat(...lf.geometry.coordinates);
      for (const r of rings) for (const c of r) { const q = map.project(c); const d = (q.x - pt.x) ** 2 + (q.y - pt.y) ** 2; if (d < bd) { bd = d; best = c; } }
    }
    return best ? [best[0], best[1]] : ll;
  }
  function markers() {
    (session.mk || []).forEach(m => m.remove()); session.mk = [];
    const p = session.pts;
    p.forEach((c, i) => {
      const el = document.createElement('div'); el.className = 'vx' + (session.selIdx === i ? ' on' : ''); el.innerHTML = '<i></i>';
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(c).addTo(map);
      m.on('dragstart', () => { pushHist(); session.selIdx = i; });
      m.on('drag', () => { const ll = m.getLngLat(); session.pts[i] = [ll.lng, ll.lat]; map.getSource(EDIT_SRC).setData(sessionGeoJSON()); });
      m.on('dragend', () => { const ll = m.getLngLat(); session.pts[i] = snap([ll.lng, ll.lat]); markers(); redraw(); });
      el.addEventListener('click', ev => { ev.stopPropagation(); session.selIdx = session.selIdx === i ? null : i; markers(); redraw(); });
      session.mk.push(m);
    });
    if (session.mode === 'edit' || p.length >= 3) {
      const n = p.length, closed = session.mode === 'edit' || n >= 3;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = p[i], b = p[(i + 1) % n]; const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const el = document.createElement('div'); el.className = 'vm'; el.innerHTML = '<i></i>'; el.title = 'إضافة نقطة';
        const m = new maplibregl.Marker({ element: el }).setLngLat(mid).addTo(map);
        el.addEventListener('click', ev => { ev.stopPropagation(); pushHist(); session.pts.splice(i + 1, 0, mid); session.selIdx = i + 1; markers(); redraw(); });
        session.mk.push(m);
      }
    }
  }
  function onMapClick(e) {
    if (!session || session.mode !== 'draw') return;
    pushHist(); session.pts.push(snap([e.lngLat.lng, e.lngLat.lat])); session.selIdx = null; markers(); redraw();
  }
  function begin(mode, pts, extra) {
    cancelSession();
    ensureEditLayers();
    session = Object.assign({ mode, pts, hist: [], snap: true, selIdx: null, mk: [] }, extra || {});
    document.body.classList.add('editing');
    map.doubleClickZoom.disable();
    map.on('click', onMapClick);
    markers(); redraw();
  }
  function cancelSession() {
    if (!session) return;
    (session.mk || []).forEach(m => m.remove());
    session = null;
    if (map.getSource(EDIT_SRC)) map.getSource(EDIT_SRC).setData({ type: 'FeatureCollection', features: [] });
    map.off('click', onMapClick); map.doubleClickZoom.enable();
    document.body.classList.remove('editing');
    const b = $('edit-bar'); if (b) b.remove();
  }
  async function startDraw() {
    if (!canWrite() || !(await ackBrowserOnly())) return;
    A.clearSelection();
    if (map.getZoom() < 15 + A.ZO) A.toast('قرّب الخريطة على موقع القطعة الجديدة، ثم اضغط لإضافة نقاط حدودها.', 6000);
    begin('draw', []);
  }
  async function startEdit(uid) {
    const f = A.byUid.get(uid); if (!f) return;
    if (f.geometry.type !== 'Polygon') { A.toast('حدود هذه القطعة مكوّنة من أكثر من جزء، ولا يمكن تعديلها من الخريطة. تواصل مع فريق البيانات.', 7000); return; }
    if (!canWrite() || !(await ackBrowserOnly())) return;
    const ring = f.geometry.coordinates[0].slice(0, -1).map(c => [c[0], c[1]]);
    begin('edit', ring, { uid, no: f.properties.no, origArea: Number(f.properties.area) || 0, holes: f.geometry.coordinates.slice(1) });
    const b = ring.reduce((t, c) => [Math.min(t[0], c[0]), Math.min(t[1], c[1]), Math.max(t[2], c[0]), Math.max(t[3], c[1])], [180, 90, -180, -90]);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: Object.assign(A.PANEL_PAD(), { bottom: 220 }), maxZoom: 19 + A.ZO, duration: 900 });
  }
  const round7 = c => [Math.round(c[0] * 1e7) / 1e7, Math.round(c[1] * 1e7) / 1e7];
  function planAt(pt) { for (const id of A.plans) { const P = A.PLAN_BY_ID[id]; if (P && P.outline && A.inGeom(pt, P.outline.geometry)) return id; } return null; }
  function overlaps(geom, plan, exceptUid) {
    const ring = geom.coordinates[0]; const c = A.labelPoint(geom); const test = ring.slice(0, -1).concat([c]);
    const bb = ring.reduce((t, q) => [Math.min(t[0], q[0]), Math.min(t[1], q[1]), Math.max(t[2], q[0]), Math.max(t[3], q[1])], [180, 90, -180, -90]);
    const hits = new Set();
    for (const f of (A.LIVE_BY_PLAN.get(plan) || [])) {
      if (f.properties.uid === exceptUid) continue;
      if (Math.abs(f.properties.lx - c[0]) > 0.01 || Math.abs(f.properties.ly - c[1]) > 0.01) continue;
      const g = f.geometry; const r0 = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
      const fb = r0.reduce((t, q) => [Math.min(t[0], q[0]), Math.min(t[1], q[1]), Math.max(t[2], q[0]), Math.max(t[3], q[1])], [180, 90, -180, -90]);
      if (fb[0] > bb[2] || fb[2] < bb[0] || fb[1] > bb[3] || fb[3] < bb[1]) continue;
      // a point strictly inside the other parcel (shared corners/edges are fine)
      if (test.some(q => A.inGeom(q, g) && !r0.some(v => Math.abs(v[0] - q[0]) < 1e-7 && Math.abs(v[1] - q[1]) < 1e-7))) hits.add(f.properties.no || f.properties.uid);
    }
    return [...hits];
  }
  async function finish() {
    if (!session) return;
    const p = session.pts;
    if (p.length < 3) return;
    if (selfIntersects(p)) { A.toast('الحدود تتقاطع مع نفسها. حرّك النقاط أو استخدم «تراجع».', 6000); return; }
    const area = polyArea(); if (area < 1) { A.toast('مساحة الشكل صغيرة جدًا.'); return; }
    const ring = p.map(round7); ring.push(ring[0]);
    if (session.mode === 'edit') {
      const s = session, uid = s.uid, f = A.byUid.get(uid);
      const geom = { type: 'Polygon', coordinates: [ring].concat(s.holes || []) };
      const ov = overlaps(geom, f.properties.plan, uid);
      const diff = s.origArea ? Math.abs(area - s.origArea) / s.origArea * 100 : 0;
      const choice = await new Promise(res => {
        L.sheet({ title: 'حفظ الحدود الجديدة', onClose: v => res(v || null),
          body: `<p class="sheet-p">المساحة المسجلة للقطعة: <b>${num(n0(Math.round(s.origArea)))}</b> م²<br>المساحة المحسوبة من الحدود الجديدة: <b>${num(n0(Math.round(area)))}</b> م² (فرق ${num(diff.toFixed(1))}٪)</p>
            ${ov.length ? `<p class="warn small">الحدود الجديدة تتداخل مع ${ov.length === 1 ? 'القطعة' : 'القطع'} ${ov.slice(0, 6).map(x => num(A.esc(x))).join('، ')}.</p>` : ''}
            <p class="muted small">اختر المساحة التي تُعتمد للقطعة. المساحة المسجلة أدق عادةً إذا كان التعديل لتصحيح الرسم فقط.</p>`,
          actions: [{ label: 'حفظ واعتماد المساحة المحسوبة', kind: 'primary', value: 'computed' }, { label: 'حفظ مع الإبقاء على المساحة المسجلة', value: 'keep' }, { label: 'متابعة التعديل', kind: 'ghost', value: null }] });
      });
      if (!choice) return;
      const bp = A.BASE_UID.has(uid) ? A.BASE_UID.get(uid).properties : null;
      cancelSession();
      await change(uid, 'geom', (r) => {
        r.geom = geom;
        if (choice === 'computed') { const v = Math.round(area * 100) / 100; if (bp && v === bp.area) delete r.area; else r.area = v; r.area_src = 'computed'; }
        else if (r.added) r.area_src = r.area_src || 'manual';
      });
      return;
    }
    // new parcel
    const geom = { type: 'Polygon', coordinates: [ring] };
    const c = A.labelPoint(geom); const plan = planAt(c) || A.currentPlan || null;
    const ov = plan ? overlaps(geom, plan, null) : [];
    cancelSession();
    const d = await dataForm({ plan, no: '', area: Math.round(area * 100) / 100, computedArea: area, notes: '', status: 'available' }, {
      title: 'بيانات القطعة الجديدة', okLabel: 'إضافة القطعة', withStatus: true, requireNo: true,
      intro: `<p class="sheet-p">${plan ? 'الموقع داخل ' + A.planLabel(plan) + '.' : 'الموقع خارج حدود المخططات المعروضة — اختر المخطط.'}</p>`,
      warn: ov.length ? `الحدود المرسومة تتداخل مع ${ov.length === 1 ? 'القطعة' : 'القطع'} ${ov.slice(0, 6).map(x => num(A.esc(x))).join('، ')}. تأكد قبل الإضافة.` : '' });
    if (!d) { A.toast('أُلغيت إضافة القطعة. لم يُحفظ شيء.'); return; }
    if (!canWrite()) return;
    const seq = (STORE.store.seq || 0) + 1;
    let uid = d.plan + ':ADM' + String(seq).padStart(3, '0'); let k = seq;
    while (A.BASE_UID.has(uid) || STORE.get(uid)) { k++; uid = d.plan + ':ADM' + String(k).padStart(3, '0'); }
    const e = await change(uid, 'add', (r, st) => {
      st.seq = k;
      Object.assign(r, { added: true, plan: d.plan, no: d.no, area: d.area, area_src: Math.round(d.area) === Math.round(area) ? 'computed' : 'manual', geom, createdAt: isoNow() });
      if (d.notes) r.notes = d.notes;
      if (d.status && d.status !== 'unknown') { r.status = d.status; r.sh = [{ at: isoNow(), from: null, to: d.status }]; }
    });
    if (e) { A.selectUid(uid, true); A.toast('أضيفت القطعة ' + d.no + '. يمكنك الآن إضافة سعرها من البطاقة.', 5000); }
  }

  function init() {
    A = window.__app; map = A.map; L = window.AridLand;
    A.plans = A.plans || [];
    buildAdmin();
    document.querySelectorAll('#modesw button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    STORE.onChange(() => chip());
    AUTH.onChange(u => { if (!u && admin) setMode('view'); });   // session ended elsewhere (service restarted / expired) → tools locked
    setMode('view');   // always start in view mode
    if (STORE.state.lastError === 'conflict') chip();
  }
  window.AridAdmin = {
    init, onCard, mapBusy: () => !!session,
    onIdle: () => { if (admin) setMode('view'); },
    get mode() { return admin ? 'admin' : 'view'; }, setMode,
    // test hooks
    _change: change, _undo: undoEntry, _finish: finish, _session: () => session, _tableCSV: tableCSV, _auditCSV: auditCSV, _restore: restoreParcel
  };
})();
