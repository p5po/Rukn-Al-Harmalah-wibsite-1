/* AridMap — «نوع الخريطة»: الخريطة الحالية / العرض الواقعي / صور الأقمار الصناعية (v0.8-dev؛ معالجة ألوان العرض v1.1.1)
   طبقة صور نقطية مستقلة تمامًا عن بيانات القطع:
   - لا تقرأ ولا تعدّل إحداثيات القطع أو معرّفاتها أو حالات البيع.
   - تُضاف تحت الطرق والقطع والتسميات، وتُزال بالكامل عند العودة إلى الخريطة الحالية.
   - لا يحدث أي اتصال بالإنترنت إلا إذا فُعّل مصدر متصل في data/imagery_config.js
     ووافق الزائر على رسالة التأكيد. الحزمة المحلية تُقرأ من ملفات JS بجانب التطبيق. */
(function () {
  'use strict';
  const CFG = window.IMAGERY_CONFIG || { local_pack: null, online: { enabled: false } };
  const ON = CFG.online || { enabled: false };
  /* v1.25: an Esri API key saved from the admin panel (data/admin/settings.js) is used when the config file has none */
  if (!ON.api_key && window.ADMIN_SETTINGS && typeof window.ADMIN_SETTINGS.esri_api_key === 'string' && window.ADMIN_SETTINGS.esri_api_key.trim()) ON.api_key = window.ADMIN_SETTINGS.esri_api_key.trim();
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TRANSPARENT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const b64ToBuf = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(src); }; document.head.appendChild(s); });

  let map = null, toast = () => {}, mode = 'map', satKind = null, styleOpt = {}, satWithReal = false;
  let pack = null, packState = CFG.local_pack ? 'loading' : 'none', packError = '';
  let onlineConfirmed = false, onlineErrors = 0, missingChunkWarned = false, wantSat = false, fellBack = false, lastError = '';
  const chunkPromises = new Map();
  const saved = [];   // [layer, prop, originalValue] restored exactly when leaving satellite mode
  const log = window.__satLog = [];

  /* ---------- local pack (Solution A) ---------- */
  function validatePack(p) {
    const need = ['id', 'source', 'license', 'attribution', 'minzoom', 'maxzoom', 'bounds', 'chunk_shift', 'chunks', 'base'];
    for (const k of need) if (p[k] == null || p[k] === '') return 'حقل ناقص في فهرس الحزمة: ' + k;
    if (p.license_confirmed !== true) return 'الحزمة لا تحمل تأكيد الترخيص (license_confirmed)';
    if (!Array.isArray(p.bounds) || p.bounds.length !== 4) return 'حدود الحزمة غير صالحة';
    return '';
  }
  const packReady = !CFG.local_pack ? Promise.resolve() :
    loadScript(CFG.local_pack).then(() => {
      const p = window.ARID_SAT_PACK; const err = p ? validatePack(p) : 'ملف الفهرس لا يعرّف ARID_SAT_PACK';
      if (err) { packState = 'invalid'; packError = err; return; }
      pack = p; pack._chunks = new Set(p.chunks); packState = 'ready';
    }).catch(() => { packState = 'missing'; packError = 'ملف الحزمة غير موجود: ' + CFG.local_pack; });

  function loadChunk(key) {
    if (!chunkPromises.has(key)) chunkPromises.set(key, loadScript(pack.base + key + '.js').then(() => true, () => false));
    return chunkPromises.get(key);
  }
  // tile bytes from the stored pack, or null when that tile was not prepared
  async function packTile(z, x, y) {
    const s = pack.chunk_shift, key = z + '_' + (x >> s) + '_' + (y >> s);
    if (!pack._chunks.has(key)) return null;
    const ok = await loadChunk(key);
    if (!ok && !missingChunkWarned) { missingChunkWarned = true; toast('جزء من حزمة الصور المحلية مفقود. يُعرض العرض الواقعي في المناطق الناقصة.', 8000); }
    const b = window.ARID_SAT_TILES && window.ARID_SAT_TILES[z + '/' + x + '/' + y];
    return b ? b64ToBuf(b) : null;
  }
  // where a fine tile was not stored (e.g. z14 outside the 10 m area), enlarge the matching part of a coarser stored tile
  const upCache = new Map();   // v1.13: last 64 up-sampled tiles (bounded memory)
  async function overzoom(z, x, y) {
    const ck = z + '/' + x + '/' + y; if (upCache.has(ck)) return upCache.get(ck).slice(0);
    const r = await overzoomRaw(z, x, y); if (r) { upCache.set(ck, r.slice(0)); if (upCache.size > 64) upCache.delete(upCache.keys().next().value); }
    return r;
  }
  async function overzoomRaw(z, x, y) {
    for (let d = 1; d <= (pack.overzoom || 0) && z - d >= pack.minzoom; d++) {
      const pz = z - d, px = x >> d, py = y >> d, buf = await packTile(pz, px, py);
      if (!buf) continue;
      const bmp = await createImageBitmap(new Blob([buf])), size = 256 >> d;
      const c = new OffscreenCanvas(256, 256), g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, (x - (px << d)) * size, (y - (py << d)) * size, size, size, 0, 0, 256, 256); bmp.close();
      return (await c.convertToBlob({ type: 'image/webp', quality: 0.8 })).arrayBuffer();   // v1.13: WebP instead of PNG — encodes faster and is ~10x smaller in memory
    }
    return null;
  }
  maplibregl.addProtocol('aridsat', async (params) => {
    const m = params.url.match(/^aridsat:\/\/(\d+)\/(\d+)\/(\d+)$/);
    const empty = { data: b64ToBuf(TRANSPARENT) };
    if (!m || !pack) return empty;
    const z = +m[1], x = +m[2], y = +m[3];
    let buf = await packTile(z, x, y), how = '';
    if (!buf) { buf = await overzoom(z, x, y); how = buf ? ' (up)' : ' (none)'; }
    log.push(z + '/' + x + '/' + y + how);
    return buf ? { data: buf } : empty;
  });
  // warm the small low-zoom chunks so the city view appears at once
  function preloadLowZoom() { if (pack) for (const k of pack.chunks) if (+k.split('_')[0] <= 11) loadChunk(k); }

  /* ---------- availability ---------- */
  const onlineKey = () => String(ON.api_key || '').trim();
  function availability() {
    if (ON.enabled && onlineKey() && navigator.onLine !== false) return { ok: true, kind: 'online' };
    if (packState === 'ready') return { ok: true, kind: 'local' };
    if (ON.enabled && onlineKey()) return { ok: true, kind: 'online' };
    if (packState === 'missing' || packState === 'invalid') return { ok: false, kind: 'local', why: 'pack' };
    if (ON.enabled && !onlineKey()) return { ok: false, kind: 'online', why: 'nokey' };
    return { ok: false, kind: 'none', why: 'none' };
  }
  function satSubtitle() {
    const a = availability();
    const localTxt = () => 'صور حقيقية مخزّنة تعمل دون إنترنت' + (pack.resolution_m ? ' — دقة <bdi dir="ltr">' + esc(pack.resolution_m) + '</bdi> م' : '')  + (pack.test ? ' (حزمة اختبار)' : '');
    if (a.ok && a.kind === 'online' && packState === 'ready') return 'صور عالية الدقة عبر الإنترنت، ودون إنترنت: ' + localTxt();
    if (a.ok && a.kind === 'local') return localTxt();
    if (a.ok && a.kind === 'online') return 'صور حقيقية عبر الإنترنت' + (navigator.onLine === false ? ' — <b>لا يوجد اتصال الآن</b>' : '');
    if (a.why === 'pack') return 'حزمة الصور المحلية مفقودة أو غير صالحة';
    if (a.why === 'nokey') return 'تحتاج اتصالًا بالإنترنت ومفتاح خدمة لم يُضبط بعد';
    return 'غير متاحة دون اتصال — لم تُجهَّز صور محلية';
  }
  const FB = () => (ON.fallback_mode || 'real') === 'real' && window.AridRealistic ? 'real' : 'map';
  const FB_TAIL = () => FB() === 'real' ? ' نعرض لك «العرض الواقعي» بدلًا منها، وهو رسم توضيحي وليس صورة حقيقية.' : ' تبقى «الخريطة الحالية» معروضة.';
  const FB_MSG = {
    offline: () => 'لا يوجد اتصال بالإنترنت الآن، وصور الأقمار الصناعية عالية الدقة تحتاج اتصالًا.' + FB_TAIL() + ' ستعود الصور تلقائيًا عند عودة الاتصال.',
    nokey: () => 'صور الأقمار الصناعية غير مفعّلة بعد على هذا الجهاز (لم يُضبط مفتاح الخدمة).' + FB_TAIL(),
    key: () => 'رفضت خدمة الصور مفتاح الوصول، وقد يكون منتهيًا أو غير صالح.' + FB_TAIL() + ' يرجى إبلاغ الموظف المسؤول.',
    network: () => 'تعذّر تحميل صور الأقمار الصناعية من الإنترنت.' + FB_TAIL(),
    pack: () => 'تعذّر استخدام حزمة صور الأقمار الصناعية المحلية.' + FB_TAIL() + ' يرجى إبلاغ الموظف المسؤول.',
    none: () => 'صور الأقمار الصناعية غير متاحة على هذا الجهاز.' + FB_TAIL()
  };
  // show the substitute view instead of an empty screen; remember that the visitor asked for imagery
  function fallback(reason, viaToast) {
    lastError = reason; wantSat = true; fellBack = true;
    if (packState === 'ready' && satKind !== 'local' && reason !== 'pack') {   // stored real imagery is the best substitute
      enterSat('local'); wantSat = true; fellBack = true; lastError = reason;
      const msg = FB_MSG[reason]().replace(FB_TAIL(), ' نعرض لك صور الأقمار الصناعية المخزّنة على الجهاز (أقل دقة).');
      showMsg(msg); if (viaToast || pop().hidden) toast(msg, 10000); return;
    }
    if (mode === 'sat') { teardownSat(); satKind = null; mode = 'map'; }
    const target = FB();
    if (target === 'real' && mode !== 'real') { leaveCurrent(); window.AridRealistic.enter(map, styleOpt); mode = 'real'; }
    renderUI(); const msg = FB_MSG[reason](); showMsg(msg);
    if (viaToast || pop().hidden) toast(msg, 10000);
  }

  /* ---------- style changes for legibility over imagery (restored exactly afterwards) ---------- */
  const HALO = 'rgba(12,11,10,0.97)';
  const SAT_STYLE = [
    ['roads-major', 'line-opacity', 0.7], ['roads-primary', 'line-opacity', 0.6], ['roads-minor', 'line-opacity', 0.45],
    ['detail-roads', 'line-opacity', 0.45], ['detail-construction', 'line-opacity', 0.5], ['water', 'line-opacity', 0.3],
    ['parcel-line', 'line-color', '#fbf3df'], ['parcel-line', 'line-opacity', 0.95],   // v1.1.1: same cream as the realistic view (was #f4dc96)
    ['plan-line', 'line-color', '#f0d48a'],
    ['road-names', 'text-halo-color', HALO], ['place-names', 'text-halo-color', HALO], ['parcel-no', 'text-halo-color', HALO], ['parcel-no', 'text-color', '#fff8e6']
  ];
  // numeric outputs of a (possibly zoom-interpolated) paint value multiplied by f; zoom stops are kept as they are
  function scaleOut(e, f) {
    if (typeof e === 'number') return Math.round(e * f * 1000) / 1000;
    if (Array.isArray(e) && e[0] === 'interpolate') { const o = e.slice(0, 3); for (let i = 3; i < e.length; i += 2) o.push(e[i], scaleOut(e[i + 1], f)); return o; }
    return e;
  }
  function applySatStyle() {
    saved.length = 0;
    for (const [l, k, v] of SAT_STYLE) if (map.getLayer(l)) { saved.push([l, k, map.getPaintProperty(l, k)]); map.setPaintProperty(l, k, v); }
    const f = Number((CFG.display || {}).plan_fill_opacity_factor);
    if (map.getLayer('plan-fill') && isFinite(f) && f >= 0.2 && f < 1) {
      const cur = map.getPaintProperty('plan-fill', 'fill-opacity'); saved.push(['plan-fill', 'fill-opacity', cur]);
      map.setPaintProperty('plan-fill', 'fill-opacity', scaleOut(cur, f));
    }
  }
  function restoreStyle() { for (const [l, k, v] of saved.reverse()) if (map.getLayer(l)) map.setPaintProperty(l, k, v); saved.length = 0; }

  /* ---------- display-only colour treatment of the imagery (v1.1.1) ----------
     GPU paint properties of the 'sat' raster layer only: the stored image pixels, their coordinates, alignment and
     scale are not touched, and no other layer is affected. Values come from IMAGERY_CONFIG.display.<local|online>.
     A value is a number, or [[zoom, value], ...] for a smooth change with zoom. Anything missing, malformed or out of
     range falls back to the v1.1 value, so a bad config can never break the imagery. */
  const SAT_DEFAULT = { saturation: -0.15, contrast: 0.05, brightness_min: 0, brightness_max: 0.82, hue_rotate: 0 };   // = v1.1
  const SAT_RANGE = { saturation: [-1, 1], contrast: [-1, 0.9], brightness_min: [0, 1], brightness_max: [0, 1], hue_rotate: [-30, 30] };
  const SAT_PROP = { saturation: 'raster-saturation', contrast: 'raster-contrast', brightness_min: 'raster-brightness-min', brightness_max: 'raster-brightness-max', hue_rotate: 'raster-hue-rotate' };
  function satValue(k, v) {
    const ok = x => typeof x === 'number' && isFinite(x) && x >= SAT_RANGE[k][0] && x <= SAT_RANGE[k][1];
    if (ok(v)) return v;
    if (Array.isArray(v) && v.length >= 2 && v.every(p => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && ok(p[1]))
        && v.every((p, i) => i === 0 || p[0] > v[i - 1][0])) return ['interpolate', ['linear'], ['zoom'], ...v.flat()];
    return SAT_DEFAULT[k];
  }
  function satDisplay(kind) {
    const c = ((CFG.display || {})[kind]) || {}, out = {};
    for (const k in SAT_DEFAULT) out[SAT_PROP[k]] = satValue(k, c[k]);
    // a fixed min above a fixed max would invert the image: fall back to v1.1 brightness in that case
    const lo = out['raster-brightness-min'], hi = out['raster-brightness-max'];
    if (typeof lo === 'number' && typeof hi === 'number' && lo >= hi) { out['raster-brightness-min'] = SAT_DEFAULT.brightness_min; out['raster-brightness-max'] = SAT_DEFAULT.brightness_max; }
    log.push(['display', kind, JSON.stringify(out)]);
    return out;
  }
  /* v1.25: on high-density screens the same zoom magnifies the stored 10 m image more → fade to the drawn view earlier, before it looks pixelated */
  const DPR_SHIFT = Math.min(1, Math.max(0, Math.log2(window.devicePixelRatio || 1)));
  function addSat(kind) {
    const src = kind === 'local'
      ? { type: 'raster', tiles: ['aridsat://{z}/{x}/{y}'], tileSize: pack.tile_size || 256, minzoom: pack.minzoom, maxzoom: pack.maxzoom, bounds: pack.bounds }
      : { type: 'raster', tiles: [String(ON.tiles).replace('{api_key}', encodeURIComponent(onlineKey()))], tileSize: 256, maxzoom: ON.maxzoom || 19 };
    // a coarse stored image (e.g. Sentinel-2, 10 m) fades out when zooming in, revealing the realistic view underneath
    const fade = kind === 'local' && pack.fade_from_zoom != null && window.AridRealistic;
    if (fade) { window.AridRealistic.enter(map, styleOpt); satWithReal = true; }
    map.addSource('sat', src);
    map.addLayer({ id: 'sat', type: 'raster', source: 'sat',
      paint: { ...satDisplay(kind), 'raster-fade-duration': 150,
               'raster-opacity': fade ? ['interpolate', ['linear'], ['zoom'], pack.fade_from_zoom - DPR_SHIFT, 1, pack.fade_to_zoom - DPR_SHIFT, 0] : 1 } },
      map.getLayer('water') ? 'water' : undefined);   // directly above the background, below every road/plan/parcel layer
  }
  function removeSat() { if (map.getLayer('sat')) map.removeLayer('sat'); if (map.getSource('sat')) map.removeSource('sat'); }
  // order matters: undo the imagery legibility tweaks first, then the realistic layers underneath
  function teardownSat() { restoreStyle(); removeSat(); if (satWithReal) { window.AridRealistic.exit(map); satWithReal = false; } }

  /* ---------- UI ---------- */
  const pop = () => $('mt-pop');
  function showMsg(t) { $('mt-msg').textContent = t; $('mt-msg').hidden = !t; }
  function openPop(open) {
    pop().hidden = !open; $('mt-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { $('mt-sat-sub').innerHTML = satSubtitle(); $('mt-confirm').hidden = true; showMsg(''); renderUI(); }
  }
  function renderUI() {
    document.querySelectorAll('.mt-opt').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const a = availability(); document.querySelector('.mt-opt[data-mode="sat"]').classList.toggle('unavail', !a.ok);
    $('mt-cur').textContent = { map: 'الخريطة الحالية', real: 'العرض الواقعي', sat: 'صور الأقمار الصناعية' }[mode];
    $('mt-btn').classList.toggle('sat', mode !== 'map');
    document.body.classList.toggle('mode-sat', mode === 'sat');
    document.body.classList.toggle('mode-real', mode === 'real');
    $('sat-note').hidden = mode === 'map';
    $('sat-note').textContent = mode === 'real' ? ' العرض الواقعي رسم توضيحي مولَّد من بيانات الخريطة، وليس صورة جوية أو فضائية حقيقية.'
      : satWithReal ? ' صور أقمار صناعية حقيقية بدقة ' + pack.resolution_m + ' م (' + (pack.captured || '') + ')؛ عند التقريب على المخطط يظهر العرض الواقعي (رسم توضيحي) لأن دقة الصور لا تكفي لإظهار القطع. تطابق الحدود مع الصور لا يعني دقة مساحية.'
      : ' الصور للتوضيح فقط، وتطابق الحدود معها لا يعني دقة مساحية.';
    const attr = $('sat-attr');
    if (mode === 'sat') {
      const t = satKind === 'local' ? pack.attribution + (pack.test ? ' — TEST PATTERN, not real imagery' : '') : (ON.attribution || '');
      attr.textContent = ' · Imagery: ' + t; attr.hidden = false;
    } else { attr.textContent = ''; attr.hidden = true; }
  }
  function leaveCurrent() {
    if (mode === 'sat') { teardownSat(); satKind = null; }
    if (mode === 'real' && window.AridRealistic) window.AridRealistic.exit(map);
    mode = 'map';
  }
  function enterSat(kind) {
    if (kind === 'local') preloadLowZoom();
    leaveCurrent(); teardownSat(); addSat(kind); applySatStyle(); satKind = kind; mode = 'sat'; onlineErrors = 0; renderUI(); openPop(false);
  }
  function setMode(m) {
    if (!map) return false;
    if (m !== 'sat') { wantSat = false; fellBack = false; }
    if (m === mode && m !== 'sat') { renderUI(); return true; }
    if (m === 'map') { leaveCurrent(); renderUI(); return true; }
    if (m === 'real') { leaveCurrent(); if (!window.AridRealistic) return false; window.AridRealistic.enter(map, styleOpt); mode = 'real'; renderUI(); return true; }
    if (mode === 'sat') { openPop(false); return true; }
    const a = availability();
    if (!a.ok) { fallback(a.why === 'pack' ? 'pack' : a.why === 'nokey' ? 'nokey' : 'none'); return false; }
    if (a.kind === 'local') { enterSat('local'); return true; }
    if (navigator.onLine === false) { fallback('offline'); return false; }
    if (ON.confirm_before_connect && !onlineConfirmed) {
      $('mt-confirm-txt').innerHTML = 'هذا النمط يتصل بالإنترنت لجلب الصور من <bdi dir="ltr">' + esc(ON.provider || 'مزود خارجي') + '</bdi>. الصور غير مخزنة على هذا الجهاز ولن تعمل دون اتصال. هل تريد المتابعة؟';
      $('mt-confirm').hidden = false; showMsg(''); return false;
    }
    wantSat = true; fellBack = false; enterSat('online'); return true;
  }

  function init(opts) {
    map = opts.map; toast = opts.toast || toast; styleOpt = { ZO: opts.ZO || 0, TS: opts.TS || 1 };
    $('mt-btn').addEventListener('click', () => openPop(pop().hidden));
    $('mt-x').addEventListener('click', () => openPop(false));
    document.querySelectorAll('.mt-opt').forEach(b => b.addEventListener('click', () => { if (b.dataset.mode === 'sat') setMode('sat'); else { setMode(b.dataset.mode); openPop(false); } }));
    $('mt-yes').addEventListener('click', () => { onlineConfirmed = true; $('mt-confirm').hidden = true; setMode('sat'); });
    $('mt-no').addEventListener('click', () => { $('mt-confirm').hidden = true; });
    document.addEventListener('pointerdown', e => { if (!pop().hidden && !e.target.closest('#maptype')) openPop(false); }, true);
    window.addEventListener('keydown', e => { if (e.key === 'Escape') openPop(false); });
    map.on('error', e => {
      if (!(e && e.sourceId === 'sat') || mode !== 'sat' || satKind !== 'online') return;
      const st = e.error && (e.error.status || (e.error.response && e.error.response.status));
      if (st === 401 || st === 403 || st === 498 || st === 499) { fallback('key', true); return; }
      if (++onlineErrors === 3) fallback(navigator.onLine === false ? 'offline' : 'network', true);
    });
    // connection lost while showing online imagery -> substitute view; connection back -> imagery again
    window.addEventListener('offline', () => { if (mode === 'sat' && satKind === 'online') fallback('offline', true); });
    window.addEventListener('online', () => {
      if (wantSat && fellBack && (lastError === 'offline' || lastError === 'network') && availability().kind === 'online') {
        fellBack = false; enterSat('online'); toast('عاد الاتصال بالإنترنت، وعادت صور الأقمار الصناعية.', 6000);
      }
    });
    packReady.then(renderUI);
    renderUI();
  }
  // kiosk idle reset: back to the default map, popover closed, online consent asked again next time
  function reset() { if (map) setMode('map'); onlineConfirmed = false; wantSat = false; fellBack = false; if (pop()) openPop(false); }

  function diagHTML() {
    const a = availability();
    const p = pack ? `<br>الحزمة: <bdi dir="ltr">${esc(pack.id)}</bdi> — المصدر: ${esc(pack.source)} — الترخيص: ${esc(pack.license)} — التكبير <bdi dir="ltr">${pack.minzoom}–${pack.maxzoom}</bdi>${pack.test ? ' — <b>حزمة اختبار</b>' : ''}` : '';
    return `<h3>صور الأقمار الصناعية</h3><p>النمط الحالي: ${mode === 'sat' ? 'صور الأقمار الصناعية (' + esc(satKind) + ')' : mode === 'real' ? 'العرض الواقعي (رسم توضيحي)' : 'الخريطة الحالية'}<br>الحزمة المحلية: <bdi dir="ltr">${esc(CFG.local_pack || '—')}</bdi> (${esc(packState)}${packError ? ' — ' + esc(packError) : ''})${p}<br>المصدر المتصل: ${ON.enabled ? 'مفعّل' + (onlineKey() ? '' : ' دون مفتاح') : 'معطّل'} — الإتاحة: ${a.ok ? esc(a.kind) : 'غير متاح'} — الاتصال الآن: ${navigator.onLine === false ? 'غير متصل' : 'متصل'}${lastError ? ' — آخر مشكلة: ' + esc(lastError) : ''}</p>`;
  }

  window.AridImagery = { init, setMode, reset, diagHTML, get mode() { return mode; }, get kind() { return satKind; }, get packState() { return packState; }, get fellBack() { return fellBack; }, get lastError() { return lastError; }, ready: packReady };
})();
