/* AridMap v1.31 — Street lengths (أطوال الشوارع). v1.33: street widths with source and segments (data/v133_street_widths.js).
   Data: data/v131_street_lengths.js (one record per street ID, built and audited offline; see docs/STREET_LENGTHS_REPORT_v131.html).
   - Tap a street (plan / parcel level) → street card: name or number, width, full length, length inside the plans (+ per plan).
   - «الشارع» search mode: by street number (keypad) or by name (text box).
   - Length labels on the map: off by default, switched from the legend chip or «نوع الخريطة».
   Display only: reads no parcel / price / sales data and changes nothing. The figures are fixed in the data file, so they are
   the same whatever plan is open. */
(function () {
  'use strict';
  const D = window.STREET_LENGTHS; if (!D || !D.streets) return;
  const $ = id => document.getElementById(id);
  const S = D.streets, C = D.corridors || {};
  /* v1.34 street widths (data/v134_street_widths.js): width and source per Suhail ID, segments where the width changes */
  const WD = window.STREET_WIDTHS || null, WS = WD ? WD.s : {};
  const SEG = {}; (WD ? WD.segs : []).forEach(g => g.ids.forEach(i => { SEG[i] = g; }));
  const SEGGEO = {}; (WD && WD.seg_geo ? WD.seg_geo.features : []).forEach(f => { (SEGGEO[f.properties.sid] = SEGGEO[f.properties.sid] || []).push(f); });
  const W_TXT = { V: 'مطابق للمرجع', W: 'مطابق للمرجع', S: 'مطابق للمرجع', P: 'حسب حدود القطع', X: 'عرض متغير', Q: 'حسب حدود القطع', M: 'غير مؤكد' };
  const W_NOTE = { V: 'العرض كما في المرجع المعتمد، ومطابق للمسافة بين حدود القطع على جانبي الشارع',
    W: 'العرض كما في المرجع المعتمد. القطع على جانبي الشارع أبعد قليلًا بسبب شريط أرض غير مقسّم بجانبه، ولا تعارض في ذلك',
    S: 'العرض كما في المرجع المعتمد. لا توجد قطع على جانبي الشارع للمقارنة (أرض مفتوحة أو تقاطعات)',
    P: 'العرض هو المسافة بين حدود القطع على امتداد الشارع كله، لأن الرقم المسجل في طبقة الشوارع لا يتسع بين القطع',
    X: 'يتغير عرض الشارع على امتداده. عرض كل مقطع ومصدره:',
    M: 'لا يتوفر عرض معتمد لهذا الشارع، فلا يُعرض رقم' };
  const wNum = w => String(Math.round(w * 100) / 100);
  const KEY = 'aridmap.streetLabels';
  const TS = Math.min(2.4, Math.max(0.85, Math.min(innerWidth, innerHeight) / 1080)), ZO = Math.log2(TS);
  const Z = z => z + ZO;
  let map = null, A = null, labelsOn = false, selId = null, streetMode = false, flyKeep = false;
  try { labelsOn = localStorage.getItem(KEY) === '1'; } catch (e) { /* storage unavailable: labels off */ }

  const num = v => Math.round(v).toLocaleString('en-US');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const bdi = s => '<bdi dir="ltr" class="num">' + s + '</bdi>';
  const metres = v => bdi(num(v)) + ' م' + (v >= 1000 ? ' <small class="muted">(' + bdi((v / 1000).toFixed(2)) + ' كم)</small>' : '');
  const widthTxt = w => w == null ? '—' : bdi(Number.isInteger(w) ? String(w) : w.toFixed(1)) + ' م';
  // width of a street ID as shown to visitors: the Suhail value, or «غير متوفر» when Suhail has only a default value
  const wInfo = id => { const r = WS[id]; if (!r) return { w: null, v: 'M' }; return { w: r[0], v: r[1], ws: r[2], x: r[3] || {} }; };
  const segVals = id => { const r = wInfo(id); return r.v === 'X' ? [...new Set(r.x.seg.map(q => q[3]).filter(v => v != null))].sort((a, b) => a - b) : []; };
  const widthHtml = id => { const r = wInfo(id);
    if (r.v === 'X') { const v = segVals(id); return v.length === 1 ? bdi(wNum(v[0])) + ' م <small class="muted">(في جزء منه)</small>' : 'من ' + bdi(wNum(v[0])) + ' إلى ' + bdi(wNum(v[v.length - 1])) + ' م'; }
    if (r.v === 'Q') return 'من ' + bdi(wNum(r.x.a)) + ' إلى ' + bdi(wNum(r.x.b)) + ' م';
    return r.w == null ? '<span class="st-w-na">غير متوفر</span>' : bdi(wNum(r.w)) + ' م'; };
  const title = (id, s) => s.n ? esc(s.n) : 'شارع بدون اسم';
  const ST_TXT = { V: 'مطابق لمصدر ثانٍ', G: 'محسوب هندسيًا', R: 'قيد المراجعة' };
  const NOTE_TXT = {
    DUP: 'في بيانات الشارع مقاطع مكررة فوق بعضها؛ حُسب المسار مرة واحدة فقط.',
    NAME_CONFLICT: 'الاسم في المصدر الثاني (OSM) مختلف: ',
    OSM_LEN_DIFF: 'طول المسار في المصدر الثاني (OSM) يختلف عن المسار المحسوب لنفس الامتداد: ',
    OSM_PARTIAL: 'المصدر الثاني (OSM) يرسم جزءًا فقط من الشارع: ',
    NO_OSM: 'الشارع غير مرسوم في المصدر الثاني (OSM)؛ الطول محسوب من إحداثيات المسار المعتمد.',
    EDGE: 'الشارع يحاذي الحد الخارجي للمخطط ولا يدخل فيه.',
    DISJOINT: 'مسار الشارع مكوّن من أجزاء منفصلة تحمل نفس المعرّف؛ الطول هو مجموعها.',
    BRIDGE: 'يمر الشارع فوق جسر.', TUNNEL: 'يمر الشارع في نفق.',
    NAME_DIFF_PARTIAL: 'اسم مختلف في المصدر الثاني (OSM) على جزء من المسار.',
    DUAL: 'الطريق مرسوم بخطين (اتجاهين)؛ حُسب الطول على امتداد الطريق مرة واحدة.',
    DUPSTRAND: 'جزء من مسار الشارع مرسوم مرتين متلاصقتين؛ حُسب مرة واحدة.',
    PARSTRAND: 'جزء من الشارع مرسوم بخطين متوازيين بينهما أكثر من 6 م؛ يُرجى التأكد هل هما مسار واحد أم مساران.',
    OSM_ENDS: 'المسار مطابق في المصدر الثاني (OSM)، والفرق فقط أن خط OSM يمتد إلى داخل التقاطع.',
    OSM_ALIGN: 'مسار الشارع في المصدر الثاني (OSM) يبتعد عن المسار المعتمد أكثر من 6 م: ',
    SHARED: 'جزء من مسار هذا الشارع مرسوم أيضًا تحت معرّف شارع آخر: ',
    SHARED_INFO: 'جزء من مساره مرسوم أيضًا تحت معرّف آخر؛ طوله هنا كما يرسمه سهيل، والمقطع المشترك يُحسب مرة واحدة في المجاميع.',
    OSM_DIFF_INFO: 'يختلف المصدر الثاني (OSM) في الاسم أو المسار؛ المعتمد بيانات سهيل.',
    GAP_INFO: 'ينتهي الشارع في سهيل قبل امتداد يظهر في OSM فقط؛ الامتداد غير محسوب ويحتاج مصدرًا إضافيًا.',
    COPIES: 'أجزاء من المسار مرسومة مرتين (نسختان متطابقتان أو بفارق أقل من 2 م)؛ حُسبت مرة واحدة: ',
    ONE_ROAD: 'خطان متجاوران للشارع بينهما أقل من عرضه، فهما داخل حرم طريق واحد؛ حُسبا مرة واحدة.',
    TWO_ROADS: 'خطان متجاوران بينهما مسافة تساوي عرض الشارع على الأقل، فهما طريقان؛ حُسبا كما رسمهما سهيل.',
    NET_DUP: 'جزء من مساره مرسوم أيضًا تحت معرّف شارع آخر؛ طوله هنا كما في سهيل، والجزء المشترك يُحسب مرة واحدة في الإجمالي والطريق المتصل: ',
    GAP_OSM: 'ينتهي الشارع قبل الشارع التالي، والمصدر الثاني (OSM) يرسم الطريق مستمرًا.',
    OSM_LONGER: 'المسار في المصدر الثاني (OSM) بنفس الاتجاه لكنه أطول لنفس الامتداد بمقدار ',
    TWO_PATHS_FIELD: 'في سهيل خطان منفصلان لهذا الشارع على بعد عرضه بالضبط (15 م)، وحُسبا كما رُسما. الأرض غير مبنية في الصور الجوية، فيحتاج تأكيدًا ميدانيًا.',
    OPEN_END: 'أحد طرفي الشارع لا يلتقي بشارع آخر (ينتهي قبله دون قطعة تعترضه).'
  };
  const MEASURE_TXT = { DUAL: 'الطريق باتجاهين: الطول مقيس على امتداد الطريق مرة واحدة، لا مجموع الاتجاهين',
    ONE_ROAD: 'الطول على امتداد الطريق مرة واحدة: جزء منه مرسوم بخطين داخل عرض الشارع نفسه',
    COPIES: 'الطول الكامل لمسار الشارع؛ الأجزاء المرسومة مرتين حُسبت مرة واحدة' };

  /* ---------- layers ---------- */
  // street width in metres → pixels (≈ 0.0287·2^(z−12) px per metre at Arid's latitude), never thinner than minPx; 'zoom' must stay top-level
  const wpx = (minPx, addPx, f) => { const o = ['interpolate', ['exponential', 2], ['zoom']];
    [12, 14, 16, 18, 20].forEach(z => o.push(Z(z), ['+', (addPx || 0) * TS, ['max', minPx * TS, ['*', ['get', 'w'], (f || 1) * Math.pow(2, z - 12) / 34.8 * TS]]]));
    return o; };
  function addLayers() {
    if (map.getSource('stl')) return;
    // v1.34: draw the selected street as wide as its adopted width (parcel-boundary or segment widths), not the raw layer value
    D.geo.features.forEach(f => { const r = WS[f.properties.sid]; if (!r) return;
      if (r[1] === 'P' && r[0] != null) f.properties.w = r[0];
      else if (r[1] === 'Q') f.properties.w = r[3].a;
      else if (r[1] === 'X') { const v = r[3].seg.map(q => q[3]).filter(x => x != null); if (v.length) f.properties.w = Math.min(...v); } });
    map.addSource('stl', { type: 'geojson', data: D.geo });
    map.addSource('stl-lab', { type: 'geojson', data: D.labels });
    const under = map.getLayer('plan-fill') ? 'plan-fill' : undefined;
    // connected road: the other streets of the confirmed continuation (dashed gold) and continuations that are not confirmed
    // (dotted grey). Neither changes the selected street's own length.
    map.addLayer({ id: 'stl-cont', type: 'line', source: 'stl', filter: ['in', ['get', 'sid'], ['literal', []]],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#e6c983', 'line-opacity': 0.75, 'line-dasharray': [3, 2], 'line-width': wpx(2.5, 0, 0.3) } }, under);
    map.addLayer({ id: 'stl-unc', type: 'line', source: 'stl', filter: ['in', ['get', 'sid'], ['literal', []]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#b7b0a2', 'line-opacity': 0.8, 'line-dasharray': [0.6, 1.6], 'line-width': wpx(2.5, 0, 0.25) } }, under);
    map.addLayer({ id: 'stl-sel-casing', type: 'line', source: 'stl', filter: ['==', ['get', 'sid'], -1],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1a1813', 'line-opacity': 0.85, 'line-width': wpx(5, 4) } }, under);
    map.addLayer({ id: 'stl-sel', type: 'line', source: 'stl', filter: ['==', ['get', 'sid'], -1],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#e6c983', 'line-opacity': 0.95, 'line-width': wpx(4) } }, under);
    // invisible tap target, as wide as the street (at least 14 px)
    map.addLayer({ id: 'stl-hit', type: 'line', source: 'stl', minzoom: Z(13),
      layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': wpx(14) } });
    const before = map.getLayer('parcel-area') ? 'parcel-area' : undefined;   // below parcel areas / numbers, so those keep priority
    map.addLayer({ id: 'stl-label', type: 'symbol', source: 'stl-lab',
      minzoom: Z(14.2),
      filter: ['any', ['>=', ['get', 'w'], 30], ['>=', ['zoom'], Z(15.6)]],
      layout: { visibility: labelsOn ? 'visible' : 'none', 'symbol-placement': 'line', 'symbol-spacing': 600 * TS, 'text-field': ['get', 't'],
        'text-font': ['Plex Arabic SemiBold'], 'text-size': ['interpolate', ['linear'], ['zoom'], Z(14.2), 12 * TS, Z(18), 16 * TS],
        'text-max-angle': 30, 'text-padding': 6, 'text-keep-upright': true, 'text-pitch-alignment': 'viewport' },
      paint: { 'text-color': '#f3dfae', 'text-halo-color': 'rgba(24,23,21,0.95)', 'text-halo-width': 2 * TS } }, before);
    // v1.33: width labels on the selected street — one per segment, and on the other parts of a street whose width changes
    map.addSource('stl-wtag', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'stl-wseg', type: 'line', source: 'stl-wtag', filter: ['==', ['get', 'cur'], 0],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#e6c983', 'line-opacity': 0.8, 'line-dasharray': [2, 1.5], 'line-width': wpx(3, 0, 0.35) } });
    map.addLayer({ id: 'stl-sel-w', type: 'symbol', source: 'stl-wtag', filter: ['!=', ['get', 'cur'], 0],
      layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 't'], 'text-offset': [0, -1.4], 'text-font': ['Plex Arabic SemiBold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], Z(13), 13 * TS, Z(18), 17 * TS], 'text-allow-overlap': true, 'text-ignore-placement': true,
        'text-max-angle': 40, 'text-keep-upright': true, 'text-pitch-alignment': 'viewport' },
      paint: { 'text-color': '#1a1813', 'text-halo-color': ['case', ['==', ['get', 'cur'], 1], '#e6c983', '#c9b07a'], 'text-halo-width': 3 * TS } });
    if (selId != null) highlight(selId);
  }
  // part of a line between two length fractions (labels of the other parts of a street sit away from shared crossings)
  function sliceLine(c, f0, f1) {
    const d = [0]; for (let i = 1; i < c.length; i++) d.push(d[i - 1] + Math.hypot((c[i][0] - c[i - 1][0]) * 0.91, c[i][1] - c[i - 1][1]));
    const L = d[d.length - 1]; if (!L) return c;
    const at = t => { const x = t * L; let i = 1; while (i < d.length - 1 && d[i] < x) i++; const r = (x - d[i - 1]) / ((d[i] - d[i - 1]) || 1);
      return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * r, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * r]; };
    const out = [at(f0)]; for (let i = 1; i < c.length - 1; i++) if (d[i] > f0 * L && d[i] < f1 * L) out.push(c[i]); out.push(at(f1)); return out;
  }
  const offCenter = g => g.type === 'LineString' ? { type: 'LineString', coordinates: sliceLine(g.coordinates, 0.12, 0.42) }
    : { type: 'MultiLineString', coordinates: g.coordinates.map(c => sliceLine(c, 0.12, 0.42)) };
  function tagFeatures(id, cur) {
    const r = wInfo(id), out = [];
    if (r.v === 'X' || r.v === 'P') (SEGGEO[Number(id)] || []).forEach(f => out.push({ type: 'Feature', properties: { cur, t: f.properties.w == null ? 'غير متوفر' : wNum(f.properties.w) + ' م' }, geometry: f.geometry }));
    else D.geo.features.filter(f => f.properties.sid === Number(id)).forEach(f => out.push({ type: 'Feature', properties: { cur,
      t: r.v === 'Q' ? 'العرض ' + wNum(r.x.a) + '–' + wNum(r.x.b) + ' م' : r.w == null ? 'العرض غير متوفر' : 'العرض ' + wNum(r.w) + ' م' }, geometry: f.geometry }));
    return out;
  }
  function setWidthTag(id) {
    // labels of the other parts go on a sub-line off the shared crossing; the dashed line keeps the full geometry
    const src = map && map.getSource('stl-wtag'); if (!src) return;
    let fs = [];
    if (id != null) { fs = tagFeatures(id, 1); const g = SEG[id]; if (g && g.var) g.ids.filter(x => x !== String(id)).forEach(x => { tagFeatures(x, 0).forEach(f => { fs.push(f);
      fs.push({ type: 'Feature', properties: { cur: 2, t: f.properties.t }, geometry: offCenter(f.geometry) }); }); }); }
    src.setData({ type: 'FeatureCollection', features: fs });
  }
  function highlight(id) {
    const f = ['==', ['get', 'sid'], id == null ? -1 : Number(id)];
    ['stl-sel', 'stl-sel-casing'].forEach(L => map.getLayer(L) && map.setFilter(L, f));
    const s = id != null ? S[id] : null, cr = s && s.cr ? C[s.cr] : null;
    const k = cr ? cr.ids.filter(x => x !== String(id)).map(Number) : [];
    const u = s && s.u ? s.u.map(x => Number(x[0])) : [];
    if (map.getLayer('stl-cont')) map.setFilter('stl-cont', ['in', ['get', 'sid'], ['literal', k]]);
    if (map.getLayer('stl-unc')) map.setFilter('stl-unc', ['in', ['get', 'sid'], ['literal', u]]);
  }
  function applyLabels() {
    if (map && map.getLayer('stl-label')) map.setLayoutProperty('stl-label', 'visibility', labelsOn ? 'visible' : 'none');
    document.querySelectorAll('[data-stl-toggle]').forEach(b => { b.setAttribute('aria-pressed', String(labelsOn)); b.classList.toggle('off', !labelsOn); });
    const st = $('stl-state'); if (st) st.textContent = labelsOn ? 'ظاهرة' : 'مخفية';
  }
  function setLabels(v) { labelsOn = !!v; try { localStorage.setItem(KEY, labelsOn ? '1' : '0'); } catch (e) { /* ignore */ } applyLabels(); }

  /* ---------- card ---------- */
  function bounds(id) {
    const fs = D.geo.features.filter(f => f.properties.sid === Number(id)); if (!fs.length) return null;
    let a = [180, 90, -180, -90];
    fs.forEach(f => { const cs = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      cs.forEach(c => c.forEach(p => { a = [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])]; })); });
    return [[a[0], a[1]], [a[2], a[3]]];
  }
  function planLbl(p) { return A && A.planLabel ? A.planLabel(p) : 'مخطط ' + p; }
  function show(id, fly) {
    const s = S[id]; if (!s) return false;
    if (A && A.selected) A.clearSelection();
    selId = id; highlight(id);
    const admin = document.body.classList.contains('admin-mode');
    $('st-name').innerHTML = title(id, s);
    $('st-id').textContent = id;
    { const r = wInfo(id), admin0 = document.body.classList.contains('admin-mode');
      const srcTxt = { S: 'المرجع المعتمد', P: 'حدود القطع', U: 'لا قطع منتظمة على الجانبين' };
      const ph = r.x && r.x.ph;
      let h = '<span class="st-w-val">' + widthHtml(id) + '</span> <span class="st-chip st-w-' + r.v + '">' + W_TXT[r.v] + '</span>'
        + '<small class="st-kind">' + (ph && r.v === 'P' ? 'لا يوجد عرض مسجل لهذا الشارع، فالعرض هو المسافة بين حدود القطع على امتداده' : ph && r.v === 'X' ? 'لا يوجد عرض مسجل لهذا الشارع؛ العرض من حدود القطع لكل مقطع:' : ph && r.v === 'Q' ? 'لا يوجد عرض مسجل لهذا الشارع، والمسافة بين حدود القطع على جانبيه غير منتظمة؛ هذا هو مداها المعتاد على امتداده' : ph && r.v === 'M' ? ({ OPEN: 'لا يوجد عرض مسجل، ولا توجد قطع على جانبي الشارع لقياس المسافة بينها، فلا يُعرض رقم', FEW: 'لا يوجد عرض مسجل، والشارع قصير جدًا فلا تكفي القياسات بين القطع لتحديد عرضه، فلا يُعرض رقم', ONESIDE: 'لا يوجد عرض مسجل، والمسافة بين القطع على جانبيه تتغير كثيرًا لوجود ساحة أو أرض مفتوحة بجانبه، فلا يُعرض رقم' }[r.x.why] || 'لا يوجد عرض مسجل، والمسافة بين القطع على جانبيه غير منتظمة فلا تعطي عرضًا ثابتًا، فلا يُعرض رقم') : W_NOTE[r.v]) + '</small>';
      if (r.v === 'X') {
        const parts = new Set(r.x.seg.map(q => q[0]));
        if (parts.size > 1) {   // a street drawn in several pieces: one line per width and source, with its total length
          const agg = new Map(); r.x.seg.forEach(q => { const k = q[3] + '|' + q[4]; agg.set(k, (agg.get(k) || 0) + (q[2] - q[1])); });
          h += '<ol class="st-wsegs">' + [...agg.entries()].sort((a, b) => b[1] - a[1]).map(([k, L]) => { const [w, src] = k.split('|');
            return '<li><b>' + (w === 'null' ? 'غير متوفر' : bdi(wNum(Number(w))) + ' م') + '</b> <small>' + bdi(num(L)) + ' م من طول الشارع — ' + srcTxt[src] + '</small></li>'; }).join('') + '</ol>';
        } else
        h += '<ol class="st-wsegs">' + r.x.seg.map(q => '<li><b>' + (q[3] == null ? 'غير متوفر' : bdi(wNum(q[3])) + ' م') + '</b> <small>' + (parts.size > 1 ? 'الجزء ' + bdi(q[0] + 1) + '، ' : '')
          + 'من ' + bdi(num(q[1])) + ' إلى ' + bdi(num(q[2])) + ' م (' + bdi(num(q[2] - q[1])) + ' م) — ' + srcTxt[q[4]] + '</small></li>').join('') + '</ol>';
      }
      if (!ph && (r.v === 'P' || (r.v === 'X' && r.x.seg.some(q => q[4] === 'P')))) h += '<small class="st-kind st-w-chk">العرض المسجل في طبقة الشوارع: ' + bdi(wNum(r.ws)) + ' م</small>';
      if (admin0 && r.v === 'W' && r.x.g != null) h += '<small class="st-kind st-w-chk">المسافة بين حدود القطع: ' + bdi(wNum(r.x.g)) + ' م</small>';
      if (admin0 && (r.v === 'M' || ph)) h += '<small class="st-kind st-w-chk">القيمة المسجلة في طبقة الشوارع: ' + bdi(wNum(r.ws)) + ' م (قيمة افتراضية تتكرر في آلاف الشوارع)</small>';
      $('st-width').innerHTML = h;
      const g = SEG[id];
      $('st-seg').hidden = $('st-seg-dt').hidden = !(g && g.var);
      if (g && g.var) $('st-seg').innerHTML = '<small class="st-kind">للشارع بهذا الاسم أجزاء بعروض مختلفة، وتظهر كلها على الخريطة:</small><div class="st-members">'
        + g.ids.map(x => { const t = S[x] ? '<small>(' + bdi(num(S[x].in || S[x].L)) + ' م طولًا)</small>' : '';
          return x === String(id) ? '<span class="st-link cur">' + widthHtml(x) + ' ' + t + '</span>'
            : '<button type="button" class="st-link" data-sid="' + x + '">' + widthHtml(x) + ' ' + t + '</button>'; }).join('') + '</div>';
      document.querySelectorAll('#st-seg .st-link[data-sid]').forEach(b => b.addEventListener('click', () => show(b.dataset.sid, true)));
      setWidthTag(id); }
    $('st-len').innerHTML = metres(s.L);
    const mk = ['DUAL', 'ONE_ROAD', 'COPIES'].find(k => (s.x || []).includes(k));
    $('st-len-kind').textContent = mk ? MEASURE_TXT[mk] : 'الطول الكامل لمسار الشارع من بدايته إلى نهايته، بالانحناءات';
    const edge = (s.x || []).includes('EDGE');
    const full = !edge && s.in >= s.L - 1;
    $('st-in').innerHTML = edge ? 'على الحد الخارجي للمخطط' : full ? 'الشارع كله داخل حدود المخططات' : metres(s.in);
    const per = s.p ? Object.entries(s.p) : [];
    $('st-per').hidden = $('st-per-dt').hidden = !per.length;
    $('st-per-dt').textContent = per.length > 1 ? 'حسب المخطط' : 'المخطط';
    $('st-per').innerHTML = per.length === 1 && full ? '<span>' + planLbl(per[0][0]) + '</span>'
      : per.map(([p, m]) => '<span>' + planLbl(p) + ': ' + bdi(num(m)) + ' م</span>').join('');
    $('st-alias').hidden = $('st-alias-dt').hidden = !s.a; $('st-alias').textContent = s.a || '';
    const ch = s.c;
    $('st-chain').hidden = $('st-chain-dt').hidden = !ch;
    if (ch) $('st-chain').innerHTML = 'الشارع بهذا الاسم مقسّم إلى ' + (ch.ids.length === 2 ? 'جزأين متصلين' : bdi(ch.ids.length) + ' أجزاء متصلة') + '، مجموعها ' + metres(ch.L);
    // connected road length: a separate, aggregate figure over the confirmed continuation; the street's own length is unchanged
    const cr = s.cr ? C[s.cr] : null;
    $('st-road').hidden = $('st-road-dt').hidden = !cr;
    if (cr) {
      $('st-road').innerHTML = '<span class="st-road-len">' + metres(cr.L) + '</span>'
        + (cr.in < cr.L - 1 ? '<small class="st-kind">داخل المخططات: ' + bdi(num(cr.in)) + ' م</small>' : '')
        + '<small class="st-kind st-agg">رقم تجميعي ' + (cr.ids.length === 2 ? 'لشارعين متصلين' : 'لـ ' + bdi(cr.ids.length) + ' شوارع متصلة') + '، وليس طول شارع واحد. لا يُحسب أي جزء مشترك مرتين.</small>'
        + '<div class="st-members">' + cr.ids.map((x, n) => (n ? '<span class="st-arrow" aria-hidden="true">←</span>' : '')
          + (x === String(id) ? '<span class="st-link cur">' + title(x, S[x]) + ' <small>(' + bdi(num(S[x].L)) + ' م)</small></span>'
             : '<button type="button" class="st-link" data-sid="' + x + '">' + title(x, S[x]) + ' <small>(' + bdi(num(S[x].L)) + ' م)</small></button>')).join('') + '</div>';
    }
    const u = (s.u || []).filter(x => S[x[0]]);
    $('st-cont').hidden = $('st-cont-dt').hidden = !u.length;
    $('st-cont').innerHTML = u.map(([x, why]) => '<button type="button" class="st-link unc" data-sid="' + x + '">' + title(x, S[x]) + ' <small>(' + esc(why) + ')</small></button>').join('')
      + (u.length ? '<small class="st-kind">استمرار غير مؤكد: يحتاج مراجعة، وغير داخل في طول الطريق المتصل. يظهر بنقاط رمادية على الخريطة.</small>' : '');
    document.querySelectorAll('#st-road .st-link[data-sid], #st-cont .st-link').forEach(b => b.addEventListener('click', () => show(b.dataset.sid, true)));
    const chip = $('st-status'); chip.textContent = ST_TXT[s.st]; chip.className = 'st-chip st-' + s.st;
    // details: reasons are shown in admin mode only (like parcel review details)
    const det = [];
    if (admin) (s.x || []).forEach(k => {
      let t = NOTE_TXT[k]; if (!t) return;
      if (k === 'NAME_CONFLICT') t += '—';
      if (k === 'OSM_LEN_DIFF' && s.o && s.o.d != null) t += bdi((s.o.d > 0 ? '+' : '') + s.o.d.toFixed(1) + '%') + '.';
      if (k === 'OSM_PARTIAL' && s.o) t += bdi(Math.round(s.o.cov * 100) + '%') + ' من الطول.';
      if (k === 'COPIES' && s.cp) t += bdi(num(s.cp)) + ' م.';
      if (k === 'NET_DUP' && s.sh) t += s.sh.map(([o, m]) => (S[o] ? title(o, S[o]) : o) + ' (' + bdi(num(m)) + ' م)').join('، ') + '.';
      det.push(t);
    });
    if (admin) (s.r || []).forEach(k => {
      let t = NOTE_TXT[k]; if (!t) return;
      if (k === 'NAME_CONFLICT' && s.o && s.o.n) t += '«' + esc(s.o.n) + '».';
      if (k === 'OSM_ALIGN' && s.o && s.o.mo != null) t += bdi(s.o.mo.toFixed(1)) + ' م.';
      if (k === 'OSM_LONGER' && s.o && s.o.x != null) t += bdi(num(s.o.x)) + ' م.';
      if (k === 'SHARED' && s.sh) t += s.sh.map(([o, m]) => (S[o] ? title(o, S[o]) : o) + ' (' + bdi(num(m)) + ' م)').join('، ') + '.';
      det.push(t);
    });
    if (admin && s.raw) det.push('مجموع الخطوط المرسومة قبل التصحيح: ' + bdi(num(s.raw)) + ' م.');
    if (s.st === 'R') det.push('الطول المعروض محسوب من مسار الشارع، ويُرجى عدم اعتماده نهائيًا قبل المراجعة.');
    $('st-det').hidden = !det.length; $('st-det').innerHTML = det.join(' ');
    $('st-card').hidden = false; $('st-card').classList.toggle('review', s.st === 'R');
    $('panel').classList.add('compact'); $('results').innerHTML = '';
    requestAnimationFrame(() => $('st-card').scrollIntoView({ block: 'nearest' }));
    // v1.34: a long road can need a zoom that counts as the district level; the card must stay open after that fly
    if (fly) { const b = bounds(id); if (b) { flyKeep = true; map.once('moveend', () => { setTimeout(() => { flyKeep = false; }, 0); }); map.fitBounds(b, { padding: A.PANEL_PAD(), maxZoom: Z(17.5), duration: 1200 }); } }
    return true;
  }
  function hide() {
    if (selId == null) return; selId = null; highlight(null); setWidthTag(null); $('st-card').hidden = true;
    if (!(A && A.selected)) $('panel').classList.remove('compact');
  }

  /* ---------- search ---------- */
  const AR = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '').replace(/^(شارع|طريق)\s+/, '').replace(/\s+/g, ' ').trim();
  const INDEX = Object.keys(S).map(id => ({ id, n: AR(S[id].n), a: AR(S[id].a), d: (S[id].n.match(/\d+/g) || []) }));
  function find(q) {
    q = String(q || '').trim(); if (!q) return [];
    const digits = /^\d+$/.test(q), qa = AR(q);
    const exact = [], starts = [], has = [];
    for (const r of INDEX) {
      if (digits) {
        if (r.id === q || r.d.includes(q)) exact.push(r);
        else if (r.d.some(x => x.startsWith(q))) starts.push(r);
      } else if (r.n === qa || r.a === qa) exact.push(r);
      else if (r.n.startsWith(qa) || (r.a && r.a.startsWith(qa))) starts.push(r);
      else if (r.n.includes(qa) || (r.a && r.a.includes(qa))) has.push(r);
    }
    const byLen = (x, y) => S[y.id].L - S[x.id].L;
    INDEX.forEach(r => { r._exact = false; }); exact.forEach(r => { r._exact = true; });
    return exact.sort(byLen).concat(starts.sort(byLen), has.sort(byLen));
  }
  function runStreetSearch() {
    const box = $('results'); box.innerHTML = '';
    const typed = ($('st-q').value || '').trim();
    const q = typed || ($('q').textContent || '').trim();
    if (!q) { box.innerHTML = '<p>اكتب اسم الشارع أو رقمه.</p>'; return; }
    const hits = find(q);
    if (!hits.length) { box.innerHTML = '<p>لا يوجد شارع داخل المخططات بهذا الاسم أو الرقم: <bdi>' + esc(q) + '</bdi>.</p>'; return; }
    if (hits.length === 1 || (hits.length > 1 && hits[0]._exact && !hits[1]._exact)) { show(hits[0].id, true); return; }
    box.insertAdjacentHTML('beforeend', '<p>' + bdi(hits.length) + ' شارعًا. اختر واحدًا:</p>');
    hits.slice(0, 40).forEach(h => { const s = S[h.id]; const b = document.createElement('button');
      b.innerHTML = '<span>العرض ' + widthHtml(h.id) + ' · الطول ' + bdi(num(s.L)) + ' م</span><b>' + title(h.id, s) + '</b>';
      b.addEventListener('click', () => show(h.id, true)); box.appendChild(b); });
    if (hits.length > 40) box.insertAdjacentHTML('beforeend', '<p>تُعرض أول 40 نتيجة. اكتب الاسم أو الرقم كاملًا لتضييق البحث.</p>');
  }
  function setStreetMode(on) {
    streetMode = !!on;
    document.body.classList.toggle('stl-mode', streetMode);
    $('st-q-row').hidden = !streetMode;
    if (streetMode) {
      document.querySelectorAll('#smode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === 'street')));
      const k = document.querySelector('#keypad button[data-k="/أ"]'); if (k) k.disabled = true;
      $('results').innerHTML = ''; labelText();
    }
  }
  function labelText() { if (streetMode && $('search-label').dataset.stl !== '1') { $('search-label').innerHTML = 'ابحث عن شارع برقمه من لوحة الأرقام، أو باسمه في المربع'; $('search-label').dataset.stl = '1'; } }

  /* ---------- UI ---------- */
  function buildUI() {
    const sm = $('smode');
    if (sm && !sm.querySelector('[data-m="street"]')) {
      const b = document.createElement('button'); b.dataset.m = 'street'; b.setAttribute('aria-pressed', 'false'); b.textContent = 'الشارع';
      sm.appendChild(b);
      b.addEventListener('click', e => { e.stopImmediatePropagation(); setStreetMode(true); });
      sm.querySelectorAll('button:not([data-m="street"])').forEach(x => x.addEventListener('click', () => { if (streetMode) { setStreetMode(false); $('search-label').dataset.stl = ''; } }));
    }
    // text box for names (on-screen keyboard on touch screens), shown in street mode only
    const qrow = document.querySelector('.search .qrow');
    if (qrow && !$('st-q-row')) {
      qrow.insertAdjacentHTML('afterend', '<div class="st-q-row" id="st-q-row" hidden><input id="st-q" class="st-q" type="search" inputmode="search" autocomplete="off" placeholder="اسم الشارع، مثل: الحائر أو 9563 عريض" aria-label="اسم الشارع"></div>');
      $('st-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runStreetSearch(); } });
    }
    $('keypad').addEventListener('click', () => { if (streetMode && $('st-q')) $('st-q').value = ''; });
    // search button: in street mode the app's parcel search does not run
    $('btn-search').addEventListener('click', e => { if (!streetMode) return; e.stopImmediatePropagation(); runStreetSearch(); }, true);
    // the app rewrites the search label on every move: put ours back in street mode
    new MutationObserver(() => { if (streetMode && $('search-label').dataset.stl === '1' && !/شارع/.test($('search-label').textContent)) { $('search-label').dataset.stl = ''; labelText(); } }).observe($('search-label'), { childList: true, subtree: true });
    // if the app switches the mode itself (parcel / plan pressed), leave street mode
    document.querySelectorAll('#smode button:not([data-m="street"])').forEach(b => new MutationObserver(() => {
      if (streetMode && b.getAttribute('aria-pressed') === 'true') { setStreetMode(false); $('search-label').dataset.stl = ''; } }).observe(b, { attributes: true, attributeFilter: ['aria-pressed'] }));
    // card
    if (!$('st-card')) {
      $('card').insertAdjacentHTML('afterend', `
  <section class="card st-card" id="st-card" hidden aria-label="بيانات الشارع">
    <div class="card-head"><span class="card-label">شارع</span><button class="close" id="st-close" aria-label="إغلاق بيانات الشارع">إغلاق</button></div>
    <div class="st-name" id="st-name"></div>
    <dl class="facts">
      <dt>عرض الشارع</dt><dd id="st-width" class="st-width"></dd>
      <dt id="st-seg-dt" hidden>مقاطع الشارع</dt><dd id="st-seg" class="st-road" hidden></dd>
      <dt>طول الشارع</dt><dd><span id="st-len"></span><small class="st-kind" id="st-len-kind"></small></dd>
      <dt>داخل المخططات</dt><dd><span id="st-in"></span><small class="st-kind">الجزء الواقع داخل حدود المخططات فقط</small></dd>
      <dt id="st-per-dt">حسب المخطط</dt><dd id="st-per" class="st-per"></dd>
      <dt id="st-alias-dt" hidden>يُعرف أيضًا باسم</dt><dd id="st-alias" hidden></dd>
      <dt id="st-chain-dt" hidden>نفس الاسم</dt><dd id="st-chain" hidden></dd>
      <dt id="st-road-dt" hidden>طول الطريق المتصل</dt><dd id="st-road" class="st-road" hidden></dd>
      <dt id="st-cont-dt" hidden>استمرار غير مؤكد</dt><dd id="st-cont" class="st-cont" hidden></dd>
      <dt>القياس</dt><dd><span class="st-chip" id="st-status"></span></dd>
      <dt>المعرّف</dt><dd><bdi dir="ltr" class="num uid" id="st-id"></bdi></dd>
    </dl>
    <p class="st-det" id="st-det" hidden></p>
  </section>`);
      $('st-close').addEventListener('click', hide);
    }
    // hide the street card whenever a parcel card opens
    new MutationObserver(() => { if (!$('card').hidden) hide(); }).observe($('card'), { attributes: true, attributeFilter: ['hidden'] });
    // legend chip + «نوع الخريطة» row
    const lg = $('legend');
    if (lg && !$('lg-stl')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'lg-stl'; b.className = 'lg-planned lg-stl'; b.setAttribute('data-stl-toggle', '');
      b.innerHTML = '<i class="sw s-stl" aria-hidden="true"></i>أطوال الشوارع';
      lg.insertBefore(b, lg.querySelector('.lg-unit') || null); b.addEventListener('click', () => setLabels(!labelsOn));
    }
    const pop = $('mt-pop');
    if (pop && !$('stl-row')) {
      const row = document.createElement('button'); row.type = 'button'; row.id = 'stl-row'; row.className = 'pl-row stl-row'; row.setAttribute('data-stl-toggle', '');
      row.innerHTML = '<span class="pl-sw" aria-hidden="true"></span><span class="pl-txt"><b>أطوال الشوارع</b><small>طول كل شارع على الخريطة — <span id="stl-state"></span></small></span>';
      pop.insertBefore(row, $('mt-msg') || null); row.addEventListener('click', () => setLabels(!labelsOn));
    }
    applyLabels();
  }

  function onClick(e) {
    if (window.AridAdmin && window.AridAdmin.mapBusy && window.AridAdmin.mapBusy()) return;
    if (!(A.level === 'plan' || A.level === 'parcel')) return;
    const pr = [[e.point.x - 2, e.point.y - 2], [e.point.x + 2, e.point.y + 2]];
    const parcelLayers = ['parcel-fill', 'adm-fill'].filter(L => map.getLayer(L));
    if (parcelLayers.length && map.queryRenderedFeatures(e.point, { layers: parcelLayers }).length) { return; }   // parcels keep the tap
    const hits = map.queryRenderedFeatures(pr, { layers: ['stl-hit'] });
    if (!hits.length) return;
    // narrowest street wins at a junction (a wide road's tap area covers the side streets' mouths)
    hits.sort((a, b) => (a.properties.w || 0) - (b.properties.w || 0));
    show(String(hits[0].properties.sid), false);
  }

  function wait() {
    A = window.__app; if (!A || !A.map) return setTimeout(wait, 120);
    map = A.map;
    const go = () => { try { addLayers(); buildUI(); } catch (err) { console.error('street lengths', err); } };
    const tryGo = () => { if (map.isStyleLoaded() && map.getLayer('plan-fill')) go(); else setTimeout(tryGo, 150); };   // the map may never go idle (moving markers), so poll
    tryGo();
    map.on('styledata', () => { if (!map.getSource('stl') && map.isStyleLoaded()) { try { addLayers(); applyLabels(); } catch (err) { /* retried on next styledata */ } } });
    map.on('click', onClick);
    map.on('moveend', () => { if ((A.level === 'riyadh' || A.level === 'arid') && !flyKeep) { hide(); if ($('st-q')) $('st-q').value = ''; } labelText(); });
  }
  window.AridStreets = { show, hide, find, setLabels, width: wInfo, get labels() { return labelsOn; }, get selected() { return selId; }, data: D, setStreetMode, search: q => { setStreetMode(true); $('st-q').value = q; runStreetSearch(); return $('results').querySelectorAll('button').length; } };
  wait();
})();
