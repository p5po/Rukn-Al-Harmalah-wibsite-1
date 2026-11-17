/* AridMap v1.8 TEST — landmarks, main roads, bridges and distances.
   Separate module: reads only window.V180 (data/v180_overlay.js) and the map object exposed by app.js.
   It adds its own sources/layers and panel sections; parcels, plans, sales and their layers are not changed. */
(function () {
  'use strict';
  const D = window.V180; if (!D) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => '<bdi dir="ltr" class="num">' + esc(v) + '</bdi>';
  /* same screen scaling as app.js: thresholds shift by ZO, widths and text sizes scale by TS */
  const TS = Math.min(2.4, Math.max(0.85, Math.min(innerWidth, innerHeight) / 1080)), ZO = Math.log2(TS);
  const Z = z => z + ZO;
  const zi = (...st) => { const o = ['interpolate', ['linear'], ['zoom']]; for (let i = 0; i < st.length; i += 2) o.push(Z(st[i]), st[i + 1] * TS); return o; };
  const zo = (...st) => { const o = ['interpolate', ['linear'], ['zoom']]; for (let i = 0; i < st.length; i += 2) o.push(Z(st[i]), st[i + 1]); return o; };   // not scaled (opacity)
  /* width by zoom, foot bridges thinner: zoom must stay the top-level input */
  const zm = (z1, f1, r1, z2, f2, r2) => ['interpolate', ['linear'], ['zoom'], Z(z1), ['match', ['get', 'kind'], 'foot', f1 * TS, r1 * TS], Z(z2), ['match', ['get', 'kind'], 'foot', f2 * TS, r2 * TS]];
  const CAT = {
    education: { ar: 'معلم تعليمي', col: '#7fb0c9' },
    residential: { ar: 'مشروع سكني', col: '#b7a1d6' },
    development: { ar: 'مشروع تطوير', col: '#5cc0ae' },
    road: { ar: 'طريق رئيسي', col: '#e0b85a' },
    airbase: { ar: 'معلم جغرافي عام', col: '#a9b2a0' },
    dest: { ar: 'وجهة', col: '#e6c983' },
    start: { ar: 'نقطة البداية', col: '#f6ecd4' }
  };
  /* icons drawn locally (no image files, no network) — 24-unit SVG paths */
  const GLYPH = {
    education: 'M12 4 1.5 9 12 14l8.5-4v6h1.5V9zM6 12.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.5L12 15.5z',
    residential: 'M12 3.5 2.5 11h2.5v9h5.2v-5.5h3.6V20H19v-9h2.5z',
    development: 'M3 20.5h18V22H3zM5 19V9.5l5-3V19zm6 0V4l8 4.5V19zm2-11v2h2V8zm0 4v2h2v-2zm0 4v2h2v-2zM7 11v2h1.6v-2zm0 4v2h1.6v-2z',
    road: 'M7.5 3h2l-1 18h-3zm7 0h2l2 18h-3zM11.2 4h1.6v3h-1.6zm0 5h1.6v3.5h-1.6zm0 5.5h1.6V18h-1.6z',
    airbase: 'M21 15.5v-2l-7.5-4.6V4.2a1.5 1.5 0 0 0-3 0v4.7L3 13.5v2l7.5-2.3v4.9L8.6 19.6V21l3.4-1 3.4 1v-1.4l-1.9-1.5v-4.9z',
    dest: 'M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 4.8 6.5 12.5 6.5 12.5s6.5-7.7 6.5-12.5A6.5 6.5 0 0 0 12 2.5zm0 9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
    start: 'M6 2.5h1.6v19H6zM8.4 3.5H19l-2.6 4 2.6 4H8.4z'
  };
  function icon(map, id, cat) {
    const px = Math.round(34 * TS) * 2, c = document.createElement('canvas'); c.width = c.height = px; const g = c.getContext('2d');
    g.beginPath(); g.arc(px / 2, px / 2, px / 2 - 3, 0, Math.PI * 2); g.fillStyle = '#26241f'; g.fill();
    g.lineWidth = Math.max(3, px * 0.07); g.strokeStyle = CAT[cat].col; g.stroke();
    g.save(); const s = px * 0.62 / 24; g.translate(px * 0.19, px * 0.19); g.scale(s, s); g.fillStyle = CAT[cat].col; g.fill(new Path2D(GLYPH[cat])); g.restore();
    map.addImage(id, g.getImageData(0, 0, px, px), { pixelRatio: 2 });
  }
  function boundsOf(coords) { let b = [Infinity, Infinity, -Infinity, -Infinity]; coords.forEach(c => { b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])]; }); return [[b[0], b[1]], [b[2], b[3]]]; }
  const flat = g => g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? [].concat(...g.coordinates.map(p => p[0])) : g.type === 'MultiLineString' ? [].concat(...g.coordinates) : [];
  const PAD = () => ({ top: 110, bottom: 90, left: 120, right: (window.innerWidth > 1100 ? 440 : 360) + 60 });
  const LM = Object.fromEntries(D.landmarks.map(l => [l.id, l]));
  const RT = D.routes;
  const tmin = r => { const a = Math.round(Math.min(r.freeflow_min, r.osrm_min)), b = Math.round(Math.max(r.freeflow_min, r.osrm_min)); return a === b ? '' + a : a + '–' + b; };

  function init(map) {
    Object.keys(CAT).forEach(k => icon(map, 'v18-' + k, k));
    const roadFC = { type: 'FeatureCollection', features: [] };
    D.landmarks.filter(l => l.lines).forEach(l => l.lines.forEach(f => roadFC.features.push({ type: 'Feature', properties: Object.assign({ lm: l.id, n: l.label }, f.properties), geometry: f.geometry })));
    const polyFC = { type: 'FeatureCollection', features: D.landmarks.filter(l => l.polygon).map(l => ({ type: 'Feature', properties: { lm: l.id, cat: l.cat }, geometry: l.polygon })) };
    const ptFC = { type: 'FeatureCollection', features: D.landmarks.map(l => ({ type: 'Feature', properties: { lm: l.id, cat: l.cat, n: l.label, zmin: Z(l.zmin), icon: 'v18-' + l.cat, pr: l.cat === 'road' ? 2 : 1 }, geometry: { type: 'Point', coordinates: l.pt } })) };
    map.addSource('v18-roads', { type: 'geojson', data: roadFC });
    map.addSource('v18-poly', { type: 'geojson', data: polyFC });
    map.addSource('v18-pts', { type: 'geojson', data: ptFC });
    map.addSource('v18-bridges', { type: 'geojson', data: D.bridges });
    map.addSource('v18-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('v18-ends', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const below = 'plan-fill', labels = 'parcel-no';   // everything of v1.8 stays under the plans/parcels; its labels yield to parcel numbers
    map.addLayer({ id: 'v18-road-glow', type: 'line', source: 'v18-roads', minzoom: Z(10),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#e0b85a', 'line-opacity': zo(10, 0.18, 13, 0.14, 16, 0.08), 'line-width': zi(10, 5, 13, 12, 17, 30) } }, below);
    map.addLayer({ id: 'v18-road', type: 'line', source: 'v18-roads', minzoom: Z(10), filter: ['all', ['==', ['get', 'st'], 'open'], ['!=', ['get', 'rk'], 'ramp']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#e0b85a', 'line-opacity': zo(10, 0.95, 16, 0.7), 'line-width': zi(10, 1.6, 13, 2.6, 17, 5) } }, below);
    map.addLayer({ id: 'v18-road-cons', type: 'line', source: 'v18-roads', minzoom: Z(10), filter: ['all', ['==', ['get', 'st'], 'construction'], ['!=', ['get', 'rk'], 'ramp']],
      paint: { 'line-color': '#e0b85a', 'line-dasharray': [2, 1.6], 'line-opacity': zo(10, 0.9, 16, 0.65), 'line-width': zi(10, 1.4, 13, 2.2, 17, 4) } }, below);
    /* v1.25: interchange ramps and loops (OSM links) — thinner, appear from zoom 13 so the junction shape reads clearly */
    map.addLayer({ id: 'v18-ramp', type: 'line', source: 'v18-roads', minzoom: Z(12.5), filter: ['all', ['==', ['get', 'rk'], 'ramp'], ['==', ['get', 'st'], 'open']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#e0b85a', 'line-opacity': zo(12.5, 0.55, 15, 0.8), 'line-width': zi(12.5, 0.9, 15, 1.6, 17, 2.8) } }, below);
    map.addLayer({ id: 'v18-ramp-cons', type: 'line', source: 'v18-roads', minzoom: Z(12.5), filter: ['all', ['==', ['get', 'rk'], 'ramp'], ['==', ['get', 'st'], 'construction']],
      paint: { 'line-color': '#e0b85a', 'line-dasharray': [2, 1.4], 'line-opacity': zo(12.5, 0.55, 15, 0.8), 'line-width': zi(12.5, 0.9, 15, 1.6, 17, 2.8) } }, below);
    map.addLayer({ id: 'v18-lm-fill', type: 'fill', source: 'v18-poly', minzoom: Z(11.5),
      paint: { 'fill-color': ['match', ['get', 'cat'], 'education', '#7fb0c9', 'development', '#5cc0ae', '#b7a1d6'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], Z(11.5), ['match', ['get', 'cat'], 'development', 0.28, 0.16], Z(15), ['match', ['get', 'cat'], 'development', 0.2, 0.1]] } }, below);
    map.addLayer({ id: 'v18-lm-line', type: 'line', source: 'v18-poly', minzoom: Z(11.5),
      paint: { 'line-color': ['match', ['get', 'cat'], 'education', '#7fb0c9', 'development', '#5cc0ae', '#b7a1d6'], 'line-dasharray': [3, 1.5], 'line-width': zi(11.5, 1, 16, 2) } }, below);
    map.addLayer({ id: 'v18-route-casing', type: 'line', source: 'v18-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#141310', 'line-width': zi(9, 6, 13, 9, 17, 14), 'line-opacity': 0.9 } }, below);
    map.addLayer({ id: 'v18-route', type: 'line', source: 'v18-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#f2d48c', 'line-width': zi(9, 3, 13, 5, 17, 8) } }, below);
    /* bridges: drawn above the road they belong to and the road/wadi they cross — a dark casing then the deck */
    map.addLayer({ id: 'v18-bridge-casing', type: 'line', source: 'v18-bridges', minzoom: Z(13), layout: { 'line-cap': 'butt' },
      paint: { 'line-color': '#0f0e0c', 'line-width': zm(13, 3, 7, 18, 7, 26) } }, below);
    map.addLayer({ id: 'v18-bridge', type: 'line', source: 'v18-bridges', minzoom: Z(13), layout: { 'line-cap': 'butt' },
      paint: { 'line-color': ['match', ['get', 'st'], 'construction', '#8f8573', '#d8c9a6'], 'line-width': zm(13, 1.4, 4, 18, 3, 18) } }, below);
    map.addLayer({ id: 'v18-road-label', type: 'symbol', source: 'v18-roads', minzoom: Z(11.6), maxzoom: Z(15.8),
      filter: ['all', ['==', ['get', 'br'], 0], ['!=', ['get', 'rk'], 'ramp']],
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 420 * TS, 'text-field': ['get', 'n'], 'text-font': ['Plex Arabic SemiBold'], 'text-size': zi(11.6, 13, 15, 15), 'text-max-angle': 30, 'text-padding': 8 },
      paint: { 'text-color': '#f0d79b', 'text-halo-color': 'rgba(24,23,21,0.96)', 'text-halo-width': 2 } }, labels);
    map.addLayer({ id: 'v18-lm-sym', type: 'symbol', source: 'v18-pts', filter: ['>=', ['zoom'], ['get', 'zmin']], maxzoom: Z(16.2),
      layout: { 'icon-image': ['get', 'icon'], 'icon-size': 1, 'icon-allow-overlap': false, 'symbol-sort-key': ['get', 'pr'],
                'text-field': ['get', 'n'], 'text-font': ['Plex Arabic SemiBold'], 'text-size': zi(10.5, 13, 15, 16), 'text-offset': [0, 1.45], 'text-anchor': 'top',
                'text-optional': true, 'text-max-width': 9, 'text-padding': 4 },
      paint: { 'text-color': '#f6ecd4', 'text-halo-color': 'rgba(24,23,21,0.96)', 'text-halo-width': 2 } }, labels);
    map.addLayer({ id: 'v18-ends', type: 'symbol', source: 'v18-ends',
      layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'text-field': ['get', 'n'], 'text-font': ['Plex Arabic SemiBold'], 'text-size': zi(9, 14, 15, 16),
                'text-offset': [0, 1.45], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 10 },
      paint: { 'text-color': '#f2d48c', 'text-halo-color': 'rgba(24,23,21,0.96)', 'text-halo-width': 2 } }, labels);

    /* taps: a parcel always wins (the parcel card of app.js opens); otherwise a landmark / road / bridge card */
    const HIT = ['v18-lm-sym', 'v18-bridge', 'v18-lm-fill', 'v18-road', 'v18-road-cons', 'v18-ramp', 'v18-ramp-cons'];
    map.on('click', e => {
      if (window.AridAdmin && window.AridAdmin.mapBusy()) return;   // v1.14: drawing / boundary editing owns the taps
      if (map.queryRenderedFeatures(e.point, { layers: ['parcel-fill', 'adm-fill'].filter(l => map.getLayer(l)) }).length) return;
      const pad = 10 * TS, box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
      for (const L of HIT) {
        const f = map.queryRenderedFeatures(box, { layers: [L] })[0]; if (!f) continue;
        if (L === 'v18-bridge') return openBridge(f.properties);
        return openLm(f.properties.lm, false);
      }
    });
    HIT.forEach(L => { map.on('mouseenter', L, () => map.getCanvas().style.cursor = 'pointer'); map.on('mouseleave', L, () => map.getCanvas().style.cursor = ''); });
    buildPanel(map);
  }

  /* ---------- panel ---------- */
  let MAP = null, cur = null, route = null;
  function buildPanel(map) {
    MAP = map;
    const anchor = document.querySelector('#panel .search');
    const html = `
<section class="v18-card" id="v18-card" hidden aria-live="polite">
  <div class="card-head"><span class="v18-chip" id="v18-chip"></span><button class="close" id="v18-close" aria-label="إغلاق بطاقة المعلم">إغلاق</button></div>
  <h2 class="v18-title" id="v18-title"></h2>
  <dl class="facts" id="v18-facts"></dl>
  <p class="v18-note" id="v18-note"></p>
  <p class="fine" id="v18-src"></p>
</section>
<section class="v18-places" id="v18-places" aria-label="معالم">
  <h2 class="v18-h">معالم في الحي وحوله</h2>
  <div class="v18-list" id="v18-list"></div>
</section>
<section class="v18-dist" id="v18-dist" aria-label="المسافات">
  <h2 class="v18-h">المسافة بالسيارة من حي عريض</h2>
  <div id="v18-rows"></div>
  <p class="fine">من: ${esc(D.start.desc)}. الزمن تقديري دون ازدحام، وليس وقت رحلة فعليًا.</p>
</section>`;
    anchor.insertAdjacentHTML('afterend', html);
    const order = ['college', 'asalah', 'ajlan', 'ring2', 'imam', 'nafud', 'airbase'];
    $('v18-list').innerHTML = order.filter(k => LM[k]).map(k => { const l = LM[k];
      return `<button data-lm="${k}"><span class="v18-ic" style="--c:${CAT[l.cat].col}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${GLYPH[l.cat]}"/></svg></span><span class="v18-t"><b>${esc(l.title)}</b><small>${esc(l.chip || CAT[l.cat].ar)}${l.in_arid ? '' : ' — في محيط الحي'}</small></span></button>`; }).join('');
    $('v18-list').addEventListener('click', e => { const b = e.target.closest('button[data-lm]'); if (b) openLm(b.dataset.lm, true); });
    $('v18-rows').innerHTML = ['masmak', 't5'].map(k => { const r = RT[k];
      return `<div class="v18-row"><div class="v18-dest"><b>${esc(r.label)}</b><small>${esc(r.ref)}</small></div>
        <div class="v18-km">${num(r.drive_km.toFixed(1))}<span> كم بالسيارة</span></div>
        <div class="v18-sub">تقديري: ${num(tmin(r))} دقيقة — المسافة المستقيمة: ${num(r.straight_km.toFixed(1))} كم</div>
        <button class="v18-show" data-rt="${k}" aria-pressed="false">عرض المسار على الخريطة</button></div>`; }).join('');
    $('v18-rows').addEventListener('click', e => { const b = e.target.closest('button[data-rt]'); if (b) toggleRoute(b.dataset.rt); });
    $('v18-close').addEventListener('click', closeLm);
    /* a parcel card from app.js closes the landmark card, so the two never compete for the panel */
    new MutationObserver(() => { if (!$('card').hidden) closeLm(); }).observe($('card'), { attributes: true, attributeFilter: ['hidden'] });
    /* kiosk idle reset (app.js returns to Riyadh after 3 min): also clear what this module shows */
    let t; const bump = () => { clearTimeout(t); t = setTimeout(() => { closeLm(); showRoute(null); }, 180000); };
    ['pointerdown', 'wheel', 'keydown'].forEach(ev => window.addEventListener(ev, bump, { passive: true })); bump();
    $('btn-home').addEventListener('click', () => { closeLm(); showRoute(null); });
  }
  /* v1.18: the reference platform is not named on screen (display only — data unchanged) */
  const noRef = t => String(t || '')
    .replace(/(^|؛\s*)سهيل: [^؛]*/g, '').replace(/^؛\s*/, '')
    .replace(/\s*\(سهيل\)/g, '').replace(/\s*\(حدود المخطط في سهيل\)/g, '').replace(/ من سهيل/g, '').replace(/حد المخطط في سهيل/g, 'حد المخطط المعتمد')
    .replace(/، داخل حدود الحي في سهيل/g, '، داخل حدود الحي').replace(/ ويطابق محور «الإمام مسلم» في سهيل \(عرض 60 م\)/g, '')
    .split(/(?<=\.)\s+/).filter(x => !/سهيل/.test(x)).join(' ').trim();
  function showCard(chip, title, facts, note, src) {
    facts = facts.map(([k, v]) => [k, noRef(v)]); note = noRef(note); src = noRef(src);
    if (!$('card').hidden) $('btn-clear').click();
    $('v18-chip').textContent = chip; $('v18-title').textContent = title;
    $('v18-facts').innerHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v).replace(/(\d[\d,.]*)/g, '<bdi dir="ltr" class="num">$1</bdi>')}</dd>`).join('');
    const bid = t => esc(t).replace(/(\d{4}-\d{2}-\d{2}|\d+\/[\u0621-\u064a])/g, '<bdi dir="ltr">$1</bdi>');   // dates and numbers like 2/أ keep their order in Arabic text
    $('v18-note').innerHTML = bid(note || ''); $('v18-note').hidden = !note;
    $('v18-src').innerHTML = ''; $('v18-src').hidden = true; $('v18-card').hidden = false;
    requestAnimationFrame(() => $('v18-card').scrollIntoView({ block: 'nearest' }));
  }
  function openLm(id, fly) {
    const l = LM[id]; if (!l) return; cur = id;
    const facts = (l.facts_public || l.facts).slice(); if (!l.in_arid) facts.splice(1, 0, ['الموقع', 'خارج حدود الحي — في محيطه']);
    showCard(l.chip || CAT[l.cat].ar, l.title, facts, l.note_public != null ? l.note_public : '', '');   // v1.27 r2: exhibition — no sources or technical notes on screen
    document.querySelectorAll('#v18-list button').forEach(b => b.classList.toggle('on', b.dataset.lm === id));
    if (fly && MAP) {
      const pts = l.lines ? [].concat(...l.lines.map(f => f.geometry.coordinates)) : l.polygon ? flat(l.polygon) : null;
      if (pts) MAP.fitBounds(boundsOf(pts), { padding: PAD(), duration: 1400, maxZoom: Z(15) });
      else MAP.flyTo({ center: l.pt, zoom: Z(12.6), padding: PAD(), duration: 1400 });
    }
  }
  function openBridge(p) {
    cur = 'bridge:' + p.id;
    showCard('جسر', p.name, [['يعبر', (p.over || 'غير محدد').replace(/^فوق /, '')], ['الطول', p.len + ' م تقريبًا']],
      '', '');
  }
  function closeLm() { cur = null; $('v18-card').hidden = true; document.querySelectorAll('#v18-list button.on').forEach(b => b.classList.remove('on')); }
  function showRoute(k) {
    route = k || null; if (!MAP) return;
    const r = k && RT[k];
    MAP.getSource('v18-route').setData({ type: 'FeatureCollection', features: r ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.geometry } }] : [] });
    MAP.getSource('v18-ends').setData({ type: 'FeatureCollection', features: r ? [
      { type: 'Feature', properties: { icon: 'v18-start', n: D.start.label }, geometry: { type: 'Point', coordinates: D.start.pt } },
      { type: 'Feature', properties: { icon: 'v18-dest', n: r.ref }, geometry: { type: 'Point', coordinates: r.poi } }] : [] });
    document.querySelectorAll('.v18-show').forEach(b => { const on = b.dataset.rt === route; b.setAttribute('aria-pressed', on); b.textContent = on ? 'إخفاء المسار' : 'عرض المسار على الخريطة'; });
    if (r) MAP.fitBounds(boundsOf(r.geometry.concat([r.poi])), { padding: PAD(), duration: 1600 });
  }
  function toggleRoute(k) { showRoute(route === k ? null : k); }

  function wait() {
    const a = window.__app; if (!a || !a.map) return setTimeout(wait, 100);
    const m = a.map; const go = () => { try { init(m); } catch (e) { console.error('v1.8 overlay', e); } };
    if (m.isStyleLoaded() && m.getLayer('parcel-no')) go(); else m.once('load', go);
  }
  wait();
  window.__v18 = { open: id => openLm(id, true), route: k => showRoute(k), get state() { return { card: cur, route }; }, data: D };
})();
