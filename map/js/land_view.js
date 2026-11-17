/* AridMap v1.14 — land statistics, filters and shared touch widgets (view mode and admin mode).
   Reads parcels through window.__app (js/app.js). Filtering only changes how parcels are drawn; it never changes data. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let A = null, map = null;
  const ST_ORDER = ['available', 'reserved', 'sold', 'unknown', 'service'];
  const ST_SHORT = { available: 'متاحة', reserved: 'محجوزة', sold: 'مباعة', unknown: 'غير محددة', service: 'خدمات' };
  const ST_COLOR = { available: '#7fa37a', reserved: '#d49a3a', sold: '#9b5f55', unknown: '#8a8373', service: '#7d8a99' };
  const F = { st: [], amin: null, amax: null, pmin: null, pmax: null, pkind: 'total' };
  const active = () => F.st.length || F.amin != null || F.amax != null || F.pmin != null || F.pmax != null;
  const num = v => '<bdi dir="ltr" class="num">' + v + '</bdi>';
  const n0 = v => Number(v).toLocaleString('en-US');

  /* ---------------- shared widgets: modal sheet, confirm, numeric keypad ---------------- */
  let sheetDepth = 0;
  function sheet(opts) {
    const back = document.createElement('div'); back.className = 'sheet-back';
    back.innerHTML = `<div class="sheet ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${A ? A.esc(opts.title) : opts.title}">
      <div class="sheet-head"><h2>${opts.title}</h2><button class="sheet-x" type="button">إغلاق</button></div>
      <div class="sheet-body"></div><div class="sheet-actions"></div></div>`;
    const body = back.querySelector('.sheet-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    const close = (v) => { if (!back.isConnected) return; back.remove(); sheetDepth--; if (!sheetDepth) document.body.classList.remove('modal-open'); if (opts.onClose) opts.onClose(v); };
    back.querySelector('.sheet-x').addEventListener('click', () => close(null));
    const acts = back.querySelector('.sheet-actions');
    (opts.actions || []).forEach(a => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (a.kind || ''); b.innerHTML = a.label;
      b.addEventListener('click', () => { const r = a.onClick ? a.onClick(close, b) : undefined; if (r !== false && a.close !== false) close(a.value); });
      acts.appendChild(b);
    });
    if (!acts.children.length) acts.remove();
    document.body.appendChild(back); sheetDepth++; document.body.classList.add('modal-open');
    return { el: back, body, close };
  }
  function confirmBox(title, html, okLabel, kind) {
    return new Promise(res => {
      sheet({ title, body: '<p class="sheet-p">' + html + '</p>', onClose: v => res(v === true),
        actions: [{ label: okLabel || 'تأكيد', kind: kind || 'primary', value: true }, { label: 'إلغاء', kind: 'ghost', value: false }] });
    });
  }
  /* numeric keypad for touch screens (no system keyboard needed). opts: {title, value, decimals, parcelNo, allowEmpty} */
  function numpad(opts) {
    return new Promise(res => {
      let v = opts.value != null ? String(opts.value) : '';
      const wrap = document.createElement('div'); wrap.className = 'np';
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', opts.parcelNo ? '/' : (opts.decimals ? '.' : ''), '0', 'del'];
      wrap.innerHTML = `<output class="np-out" dir="ltr"></output>${opts.hint ? '<p class="np-hint">' + opts.hint + '</p>' : ''}
        <div class="np-keys">${keys.map(k => k === '' ? '<span></span>' : `<button type="button" data-k="${k}">${k === 'del' ? '⌫' : k}</button>`).join('')}</div>
        ${opts.parcelNo ? '<div class="np-extra"><button type="button" data-k="أ">أ</button><button type="button" data-k="ب">ب</button></div>' : ''}`;
      const out = wrap.querySelector('.np-out'); let fresh = false; const draw = () => { out.textContent = v; out.classList.toggle('fresh', fresh); };
      fresh = v !== '';   // the first digit typed replaces a pre-filled value (like a selected text field)
      const press = k => {
        if (fresh && k !== 'del' && k !== 'clr') { v = ''; }
        fresh = false;
        if (k === 'del') v = v.slice(0, -1);
        else if (k === 'clr') v = '';
        else if (k === '.') { if (!v.includes('.')) v = (v || '0') + '.'; }
        else if (v.length < 14) v += k;
        draw();
      };
      wrap.querySelectorAll('button[data-k]').forEach(b => b.addEventListener('click', () => press(b.dataset.k)));
      draw();
      const onKey = e => {
        if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del');
        else if (e.key === '.' && opts.decimals) press('.'); else if (e.key === '/' && opts.parcelNo) press('/');
        else if (e.key === 'Enter') { e.preventDefault(); done(); } else return;
        e.stopPropagation();
      };
      window.addEventListener('keydown', onKey, true);
      let result = null;
      const done = () => { const t = v.trim(); if (!t && !opts.allowEmpty) return; if (!opts.parcelNo && t && !(Number(t) >= 0)) return; result = t === '' ? '' : (opts.parcelNo ? t : Number(t)); sh.close(true); };
      const sh = sheet({ title: opts.title, body: wrap, onClose: () => { window.removeEventListener('keydown', onKey, true); res(result); },
        actions: [{ label: 'اعتماد', kind: 'primary', close: false, onClick: () => { done(); return false; } },
          ...(opts.allowEmpty ? [{ label: 'مسح', kind: 'ghost', close: false, onClick: () => { press('clr'); return false; } }] : []),
          { label: 'إلغاء', kind: 'ghost', value: null }] });
    });
  }

  /* ---------------- statistics + filters panel ---------------- */
  function scopeFeatures() {
    const pid = A.currentPlan;
    if (pid) return A.LIVE_BY_PLAN.get(pid) || [];
    const out = []; for (const arr of A.LIVE_BY_PLAN.values()) for (const f of arr) out.push(f); return out;
  }
  function matches(f) {
    if (F.st.length && !F.st.includes(A.statusOf(f))) return false;
    const a = Number(f.properties.area) || 0;
    if (F.amin != null && a < F.amin) return false;
    if (F.amax != null && a > F.amax) return false;
    if (F.pmin != null || F.pmax != null) {
      const p = A.priceInfo(f); const v = p ? (F.pkind === 'sqm' ? p.perSqm : p.total) : null;
      if (v == null) return false;
      if (F.pmin != null && v < F.pmin) return false;
      if (F.pmax != null && v > F.pmax) return false;
    }
    return true;
  }
  function build() {
    const sec = document.createElement('section'); sec.className = 'land'; sec.id = 'land'; sec.setAttribute('aria-label', 'إحصاءات الأراضي والتصفية');
    sec.innerHTML = `
      <div class="land-head"><h2>الأراضي حسب الحالة</h2><span class="land-scope" id="land-scope"></span></div>
      <div class="land-tiles" id="land-tiles"></div>
      <div class="land-total" id="land-total"></div>
      <button type="button" class="land-more" id="land-more" aria-expanded="false">تصفية حسب المساحة والسعر</button>
      <div class="land-adv" id="land-adv" hidden>
        <div class="land-row"><span class="land-lbl">المساحة (م²)</span>
          <button type="button" class="nf" data-f="amin"></button><span class="land-to">إلى</span><button type="button" class="nf" data-f="amax"></button></div>
        <div class="seg" id="land-pkind" role="group" aria-label="نوع السعر">
          <button type="button" data-k="total" aria-pressed="true">السعر الإجمالي</button><button type="button" data-k="sqm" aria-pressed="false">سعر المتر</button></div>
        <div class="land-row"><span class="land-lbl">السعر</span>
          <button type="button" class="nf" data-f="pmin"></button><span class="land-to">إلى</span><button type="button" class="nf" data-f="pmax"></button></div>
      </div>
      <div class="land-res" id="land-res" hidden>
        <div class="land-res-row"><span id="land-res-n"></span><button type="button" class="link" id="land-list-btn">عرض القائمة</button><button type="button" class="link" id="land-clear">مسح التصفية</button></div>
        <div class="land-list" id="land-list" hidden></div>
      </div>`;
    const anchor = document.querySelector('#panel .search');
    anchor.insertAdjacentElement('afterend', sec);
    $('land-more').addEventListener('click', () => { const o = $('land-adv').hidden; $('land-adv').hidden = !o; $('land-more').setAttribute('aria-expanded', String(o)); });
    sec.querySelectorAll('.nf').forEach(b => b.addEventListener('click', async () => {
      const k = b.dataset.f; const t = { amin: 'أقل مساحة (م²)', amax: 'أكبر مساحة (م²)', pmin: 'أقل سعر', pmax: 'أعلى سعر' }[k];
      const v = await numpad({ title: t, value: F[k], decimals: true, allowEmpty: true, hint: k[0] === 'p' ? (F.pkind === 'sqm' ? 'سعر المتر المربع' : 'السعر الإجمالي للقطعة') : '' });
      if (v === null) return; F[k] = v === '' ? null : v; apply();
    }));
    $('land-pkind').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { F.pkind = b.dataset.k; apply(); }));
    $('land-clear').addEventListener('click', () => clear());
    $('land-list-btn').addEventListener('click', () => { const l = $('land-list'); l.hidden = !l.hidden; $('land-list-btn').textContent = l.hidden ? 'عرض القائمة' : 'إخفاء القائمة'; if (!l.hidden) renderList(); });
  }
  let lastScope = undefined;
  function refresh() {
    if (!A) return;
    const fs = scopeFeatures(); const cnt = { available: 0, reserved: 0, sold: 0, unknown: 0, service: 0 };
    let m = 0;
    for (const f of fs) { const s = A.statusOf(f); cnt[s] = (cnt[s] || 0) + 1; if (active() && matches(f)) m++; }
    lastScope = A.currentPlan;
    $('land-scope').innerHTML = A.currentPlan ? 'في ' + A.planLabel(A.currentPlan) : 'في كل المخططات';
    $('land-tiles').innerHTML = ST_ORDER.map(s => `<button type="button" class="tile ${F.st.includes(s) ? 'on' : ''}" data-s="${s}" aria-pressed="${F.st.includes(s)}" style="--c:${ST_COLOR[s]}">
      <span class="tile-l"><i class="sw" aria-hidden="true"></i>${ST_SHORT[s]}</span><b class="tile-n">${num(n0(cnt[s] || 0))}</b></button>`).join('');
    $('land-tiles').querySelectorAll('.tile').forEach(b => b.addEventListener('click', () => { const s = b.dataset.s; F.st = F.st.includes(s) ? F.st.filter(x => x !== s) : F.st.concat(s); apply(); }));
    $('land-total').innerHTML = 'الإجمالي: ' + num(n0(fs.length)) + ' قطعة' + (active() ? '' : ' — اضغط على حالة لإبرازها على الخريطة');
    const lab = { amin: F.amin, amax: F.amax, pmin: F.pmin, pmax: F.pmax };
    document.querySelectorAll('#land .nf').forEach(b => { const v = lab[b.dataset.f]; b.innerHTML = v == null ? '<span class="muted">—</span>' : num(n0(v)); b.classList.toggle('set', v != null); });
    $('land-pkind').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === F.pkind)));
    $('land-res').hidden = !active();
    $('land-res-n').innerHTML = 'تطابق التصفية: ' + num(n0(m)) + ' قطعة';
    if (!$('land-list').hidden) renderList();
  }
  function renderList() {
    const l = $('land-list'); l.innerHTML = '';
    const hits = scopeFeatures().filter(matches);
    hits.sort((a, b) => a.properties.plan.localeCompare(b.properties.plan) || (parseInt(a.properties.no) || 0) - (parseInt(b.properties.no) || 0));
    hits.slice(0, 150).forEach(f => {
      const b = document.createElement('button'); b.type = 'button'; const p = A.priceInfo(f); const s = A.statusOf(f);
      b.innerHTML = `<span><i class="dot" style="--c:${s === 'service' ? (A.SVC_COLOR[f.properties.svc] || ST_COLOR.service) : ST_COLOR[s]}"></i>${s === 'service' ? A.esc(A.svcLabel(f.properties)) : ST_SHORT[s]} · ${num(n0(Math.round(f.properties.area)))} م²${p ? ' · ' + num(A.fmtMoney(p.total)) + ' ' + (A.CURRENCY[p.currency] || '') : ''}${A.currentPlan ? '' : ' · ' + A.planLabel(f.properties.plan)}</span><b>${num(A.esc(f.properties.no || '—'))}</b>`;
      b.addEventListener('click', () => A.selectUid(f.properties.uid, true)); l.appendChild(b);
    });
    if (hits.length > 150) l.insertAdjacentHTML('beforeend', `<p class="muted">تُعرض أول 150 قطعة من ${n0(hits.length)}. ضيّق التصفية أو افتح مخططًا.</p>`);
    if (!hits.length) l.innerHTML = '<p class="muted">لا توجد قطع مطابقة.</p>';
  }

  /* ---------------- map: matching parcels keep their colour, the rest fade ---------------- */
  const ORIG = {};
  const PAINT = [['parcel-fill', 'fill-color'], ['parcel-fill', 'fill-opacity'], ['adm-fill', 'fill-color'], ['adm-fill', 'fill-opacity'], ['parcel-no', 'text-opacity'], ['adm-no', 'text-opacity']];
  function matchExpr() {
    const c = ['all'];
    if (F.st.length) c.push(['in', ['coalesce', ['feature-state', 'st'], 'unknown'], ['literal', F.st]]);
    if (F.amin != null) c.push(['>=', ['to-number', ['get', 'area']], F.amin]);
    if (F.amax != null) c.push(['<=', ['to-number', ['get', 'area']], F.amax]);
    const pv = ['to-number', ['coalesce', ['feature-state', F.pkind === 'sqm' ? 'pm' : 'pt'], -1]];
    if (F.pmin != null || F.pmax != null) c.push(['>=', pv, 0]);
    if (F.pmin != null) c.push(['>=', pv, F.pmin]);
    if (F.pmax != null) c.push(['<=', pv, F.pmax]);
    return c;
  }
  function paintMap() {
    const sel = ['boolean', ['feature-state', 'sel'], false];
    for (const [l, k] of PAINT) {
      if (!map.getLayer(l)) continue;
      if (!(l + '|' + k in ORIG)) ORIG[l + '|' + k] = map.getPaintProperty(l, k);
      const o = ORIG[l + '|' + k];
      if (!active()) { map.setPaintProperty(l, k, o); continue; }
      const M = matchExpr();
      let v;
      if (k === 'fill-color') v = ['case', sel, o, M, o, '#46433c'];
      else if (k === 'fill-opacity') v = ['case', sel, o, M, ['max', o, 0.45], 0.05];
      else v = ['case', M, 1, 0.28];   // text-opacity (no original value → 1)
      if (k === 'text-opacity' && o != null && typeof o !== 'number') v = ['case', M, o, 0.28];
      map.setPaintProperty(l, k, v);
    }
  }
  function apply() { paintMap(); refresh(); }
  function clear() { F.st = []; F.amin = F.amax = F.pmin = F.pmax = null; F.pkind = 'total'; $('land-list').hidden = true; $('land-list-btn').textContent = 'عرض القائمة'; apply(); }

  function init() {
    A = window.__app; map = A.map;
    build(); refresh();
    map.on('moveend', () => { if (A.currentPlan !== lastScope) refresh(); });
    document.querySelectorAll('#trail button, #btn-home').forEach(b => b.addEventListener('click', () => setTimeout(refresh, 50)));
    $('search-label').addEventListener('click', () => setTimeout(refresh, 50));
    if (window.AridStore) window.AridStore.onChange(() => refresh());
  }
  window.AridLand = { init, refresh, onIdle: () => { if (A) clear(); }, numpad, sheet, confirm: confirmBox, matches, get filter() { return F; }, apply, ST_SHORT, ST_COLOR };
})();
