/* Arid interactive map — offline prototype (multi-plan since v0.9-dev)
   All data are loaded from local files. No network requests are made. */
(function () {
  'use strict';
  const sp = new URLSearchParams(window.location.search);
  if (!sp.has('force_desktop') && ((window.innerWidth <= 768) || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))) {
    return; // Safety guard: never initialize the heavy map engine on mobile
  }
  const $ = id => document.getElementById(id);
  /* Plans are listed in data/registry.js. Only plans that passed their own verification gate (display=true) are loaded. */
  const REG = window.PLAN_REGISTRY || { plans: [] };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shown = REG.plans.filter(p => p.display && p.file);
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(src); document.head.appendChild(s); });
  /* v1.19: the plan files download in parallel (async=false keeps their execution order) — was one after another */
  const loadOrdered = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = false; s.onload = res; s.onerror = () => rej(src); document.head.appendChild(s); });
  Promise.all(shown.map(x => loadOrdered(x.file)))
    .then(start)
    .catch(src => { document.body.insertAdjacentHTML('beforeend', '<div class="toast" role="alert">تعذّر تحميل ملف بيانات المخطط: ' + String(src).replace(/[<>&]/g, '') + '</div>'); });

  function start() {
  const META = window.APP_META, BM = window.BASEMAP;
  const PLANS = shown.map(p => window.PLAN_DATA[p.id]).filter(Boolean);
  const PLAN_BY_ID = Object.fromEntries(PLANS.map(p => [p.meta.id, p]));
  const PAR = { type: 'FeatureCollection', features: [].concat(...PLANS.map(p => p.parcels.features)) };
  const OUT = { type: 'FeatureCollection', features: PLANS.map(p => p.outline) };
  const ALL_BBOX = PLANS.length ? [Math.min(...PLANS.map(p => p.bbox[0])), Math.min(...PLANS.map(p => p.bbox[1])), Math.max(...PLANS.map(p => p.bbox[2])), Math.max(...PLANS.map(p => p.bbox[3]))] : [46.74, 24.42, 46.80, 24.46];
  let currentPlan = PLANS.length === 1 ? PLANS[0].meta.id : null;
  const planLabel = id => 'مخطط <bdi dir="ltr">' + esc(id) + '</bdi>';
  // district name shown in the trail for a plan whose registry entry names its own district (v1.5 r2: 2817 → حي الحائر); all other plans keep «حي عريض»
  const DISTRICT_OF = Object.fromEntries(shown.filter(p => p.district_label).map(p => [p.id, p.district_label]));
  const IDLE_MS = 180000;                                        // auto-return to Riyadh after 3 min without touch
  const RIYADH_BOUNDS = [[46.50, 24.40], [47.00, 24.93]];
  const ARID_LABEL = (BM.places.features.find(f => f.properties.n === 'عريض') || {}).geometry; // OSM place node
  const STATUS = {
    available: { ar: 'متاحة', color: '#DFBE7B' },
    reserved: { ar: 'محجوزة', color: '#d49a3a' },
    sold: { ar: 'مباعة', color: '#9b5f55' },
    unknown: { ar: 'غير محددة', color: null },
    service: { ar: 'خدمات', color: '#7d8a99' }   // v1.13: service land (parks, facilities, parking); v1.15: label shortened, colour per service family (SVC)
  };
  /* ---------- v1.15: service land — display only (data unchanged) ----------
     Each service parcel shows its recorded use directly (landuse_detail, else landuse), with spelling tidied for display.
     Colour comes from the service family (a calm, cool palette kept apart from the warm sale colours). */
  const SVC_FAMILY = { 'الخدمات الترفيهية': 'recreation', 'الخدمات الدينية': 'religious', 'الخدمات التعليمية': 'education', 'الخدمات البلدية': 'municipal',
    'مرافق المواصلات': 'transport', 'مرافق الكهرباء': 'utility', 'أراضي فضاء': 'vacant' };
  const SVC_COLOR = { recreation: '#5b8e92', religious: '#8d86ad', education: '#6f8fbf', municipal: '#7d8a99', transport: '#5f676f', utility: '#a08aa0', vacant: '#8c8577' };
  const SVC_FIX = [[/بلديه/g, 'بلدية'], [/مدرسه/g, 'مدرسة'], [/ابتدائيه/g, 'ابتدائية'], [/متنزة/g, 'متنزه'], [/ممر للمشاة|ممر مشاه/g, 'ممر مشاة']];
  const svcLabel = p => { let t = String(p.landuse_detail || p.landuse || '').trim(); SVC_FIX.forEach(([a, b]) => { t = t.replace(a, b); }); return t || 'خدمات'; };
  /* v1.14: land management — admin changes live in a separate store (js/land_store.js); plan files and the sales CSV are never written */
  const STORE = window.AridStore || null;
  const CURRENCY = { SAR: 'ريال', USD: 'دولار', AED: 'درهم', EUR: 'يورو' };
  const fmtMoney = v => (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : 2 });
  const fmtDate = iso => { try { return new Date(iso).toLocaleString('ar-u-nu-latn-ca-gregory', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } };

  /* ---------- offline glyphs (embedded PBF) ---------- */
  const b64ToBuf = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  maplibregl.addProtocol('emb', (params) => {
    const m = decodeURIComponent(params.url).match(/^emb:\/\/(.+)\/(\d+-\d+)\.pbf$/);
    let data = new ArrayBuffer(0);
    if (m) {
      const font = m[1].split(',')[0].trim(); const b = window.GLYPHS_B64[font + '/' + m[2]]; if (b) data = b64ToBuf(b);
      (window.__glyphLog = window.__glyphLog || []).push(font + '/' + m[2] + (b ? '' : ' (empty)'));
    }
    return Promise.resolve({ data });
  });
  try {
    const url = URL.createObjectURL(new Blob([window.RTL_PLUGIN_SRC], { type: 'text/javascript' }));
    maplibregl.setRTLTextPlugin(url, false).catch(() => {});
  } catch (e) { /* Arabic road names may render unshaped; parcel numbers unaffected */ }

  /* ---------- sales status (separate user-editable CSV, keyed by parcel_uid) ---------- */
  const sales = new Map();   // parcel_uid -> {status, price, notes}
  const salesReport = { accepted: 0, rejected: [], schema: '' };
  let salesLoaded = false, salesSource = '';
  function normStatus(s) {
    s = (s || '').trim().toLowerCase();
    if (/^(متاحة|متاح|available|للبيع)$/.test(s)) return 'available';
    if (/^(محجوزة|محجوز|reserved)$/.test(s)) return 'reserved';
    if (/^(مباعة|مباع|sold)$/.test(s)) return 'sold';
    if (/^(غير محددة|غير محدد|unknown|)$/.test(s)) return 'unknown';
    if (/^(غير مخصصة للبيع|غير مخصص للبيع|خدمات|service|not_for_sale)$/.test(s)) return 'service';
    return null;   // not a recognised value -> row rejected
  }
  function parseCSV(t) {
    t = t.replace(/^﻿/, '');
    /* v1.19: fast path — a file without quotes is split by lines and separators (same result, ~50× faster than the loop below) */
    if (t.indexOf('"') < 0) return t.split(/\r\n|\r|\n/).map(l => l.split(/[,;\t]/)).filter(r => r.some(x => x.trim() !== ''));
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',' || c === ';' || c === '\t') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  const GOOGLE_SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQd4-PmHM5yhvJf3LAt5GzVLezEYB-WDHKft_VB_CCzVxd4ASap_WPEsk6zNcC04go7VaelDFcqAwYp/pub?output=csv';

  async function loadSales() {
    let text = null;
    try {
      const res = await fetch(GOOGLE_SHEETS_CSV_URL + (GOOGLE_SHEETS_CSV_URL.includes('?') ? '&' : '?') + '_t=' + Date.now(), { cache: 'no-cache' });
      if (res.ok) {
        const fetched = await res.text();
        if (fetched && fetched.includes(',')) {
          text = fetched;
          salesSource = 'Google Sheets Live';
          console.log('[Haramala Map] Live sales loaded from Google Sheets');
        }
      }
    } catch (e) {
      console.warn('[Haramala Map] Failed to fetch live Google Sheets CSV, trying local fallback...', e);
    }

    if (!text && typeof window.SALES_CSV === 'string') {
      text = window.SALES_CSV;
      salesSource = 'data/sales_status.js';
    } else if (!text) {
      try {
        const localRes = await fetch('data/sales_status.csv?t=' + Date.now());
        if (localRes.ok) {
          text = await localRes.text();
          salesSource = 'data/sales_status.csv';
        }
      } catch (e) {}
    }

    if (!text) return false;
    const rows = parseCSV(text);
    if (!rows.length) return false;
    const h = rows.shift().map(s => s.trim().toLowerCase());
    validateSales(rows, h);
    return true;
  }

  function validateSales(rows, h) {
    const ci = (...keys) => {
      for (const k of keys) {
        const idx = h.indexOf(k.toLowerCase());
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const hasUid = ci('parcel_uid') >= 0;
    salesReport.schema = hasUid ? 'v2 (parcel_uid)' : 'v1 (flexible plan/plot)';
    const seen = new Map();
    const rej = (line, reason, raw) => salesReport.rejected.push({ line, reason, raw: raw.join(',').slice(0, 80) });

    const colPlan = ci('plan_no', 'plan', 'مخطط', 'رقم المخطط');
    const colPlot = ci('plot_no', 'parcel_no', 'plot', 'قطعة', 'رقم القطعة');
    const colStatus = ci('status', 'الحالة', 'حالة');
    const colPrice = ci('price', 'price_sar', 'السعر', 'سعر');
    const colArea = ci('area', 'المساحة', 'مساحة');
    const colStreets = ci('streets', 'street', 'الشارع', 'شوارع');
    const colDimensions = ci('dimensions', 'الأبعاد', 'أبعاد');
    const colTitle = ci('title', 'العنوان', 'اسم العرض');
    const colNotes = ci('notes', 'ملاحظات');

    rows.forEach((r, i) => {
      const line = i + 2;
      const getVal = idx => (idx >= 0 && r[idx] !== undefined) ? r[idx].trim() : '';

      const rawStatus = getVal(colStatus) || 'متاح';
      const st = normStatus(rawStatus) || 'available';

      const rawPlan = getVal(colPlan);
      const rawPlot = getVal(colPlot);
      const rawPrice = getVal(colPrice);
      const rawArea = getVal(colArea);
      const rawStreets = getVal(colStreets);
      const rawDim = getVal(colDimensions);
      const rawTitle = getVal(colTitle);
      const rawNotes = getVal(colNotes);

      let f = null;
      if (hasUid && getVal(ci('parcel_uid'))) {
        const uid = getVal(ci('parcel_uid'));
        f = byUid.get(uid);
        if (!f) return rej(line, 'معرّف غير موجود في أي مخطط معروض: ' + uid, r);
        const no = rawPlot;
        if (no && normNo(no) !== normNo(f.properties.no)) return rej(line, 'رقم القطعة لا يطابق المعرّف (' + no + ' ≠ ' + f.properties.no + ')', r);
      } else {
        if (!rawPlot && !rawPlan) return; // skip empty row
        const cleanPlot = normNo(rawPlot);
        const cleanPlanMatch = rawPlan ? rawPlan.match(/\d+[\w-]*/i) : null;
        const cleanPlan = cleanPlanMatch ? cleanPlanMatch[0] : (rawPlan ? rawPlan.trim() : '');

        if (cleanPlan && cleanPlot) {
          const key = cleanPlan + '|' + cleanPlot;
          const hits = byNo.get(key) || (typeof byAlias !== 'undefined' && byAlias.get(key));
          if (hits && hits.length) f = hits[0];
        }

        if (!f && cleanPlot) {
          for (const [k, hits] of byNo) {
            if (k.endsWith('|' + cleanPlot)) {
              if (!cleanPlan || k.startsWith(cleanPlan)) {
                f = hits[0];
                break;
              }
            }
          }
        }

        if (!f) return rej(line, 'لم يتم العثور على قطعة مطابقة: ' + (rawPlan ? 'مخطط ' + rawPlan + ' ' : '') + 'قطعة ' + rawPlot, r);
      }

      const uid = f.properties.uid;
      const rec = {
        status: st,
        price: rawPrice,
        area: rawArea,
        streets: rawStreets,
        dimensions: rawDim,
        title: rawTitle,
        notes: rawNotes,
        plan: f.properties.plan || rawPlan,
        plot: f.properties.no || rawPlot,
        line,
        fromSheet: true
      };

      seen.set(uid, rec);
    });

    for (const [uid, rec] of seen) {
      if (rec) {
        sales.set(uid, rec);
        salesReport.accepted++;
      } else {
        sales.delete(uid);
      }
    }
  }

  /* ---------- parcel index ---------- */
  function normNo(s) {
    s = String(s).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
    s = s.replace(/\s+/g, '').replace(/[اإآ]/g, 'أ');
    const m = s.match(/^(\d+)\/?(أ|ب)?$/); if (!m) return s;
    return m[2] ? m[1] + '/' + m[2] : m[1];
  }
  const byNo = new Map(); const byUid = new Map();   // byNo key: "<plan>|<number>"  (v1.14: both are the LIVE index = base data + admin store)
  for (const f of PAR.features) {
    byUid.set(f.properties.uid, f);
    for (const n of f.properties.nos) { const k = f.properties.plan + '|' + normNo(n); if (!byNo.has(k)) byNo.set(k, []); byNo.get(k).push(f); }
  }
  for (const f of PAR.features) { const p = f.properties; if (p.use === 'service') p.svc = SVC_FAMILY[p.landuse] || 'municipal'; }   // display key only (in memory)
  const BASE_UID = new Map(byUid);   // base parcels as loaded from the plan files — never modified
  const recOf = uid => (STORE ? STORE.get(uid) : null);
  /* status: admin store first (if set there), else the sales CSV */
  function statusOf(f) { const r = recOf(f.properties.uid); if (r && r.status !== undefined) return r.status || 'unknown'; const s = sales.get(f.properties.uid); return s ? s.status : 'unknown'; }
  function statusSource(f) { const r = recOf(f.properties.uid); if (r && r.status !== undefined) return 'admin'; return sales.get(f.properties.uid) ? 'csv' : 'none'; }
  /* price: admin store first (null there = price removed), else price_sar of the sales CSV (total, SAR) */
  function priceInfo(f) {
    const uid = f.properties.uid, r = recOf(uid); let p = null;
    if (r && r.price !== undefined) p = r.price ? Object.assign({ src: 'admin' }, r.price) : null;
    else { const s = sales.get(uid); const a = s && s.price ? Number(String(s.price).replace(/[^\d.]/g, '')) : 0; if (a > 0) p = { amount: a, currency: 'SAR', unit: 'total', src: 'csv' }; }
    if (!p || !(p.amount > 0)) return null;
    const area = Number(f.properties.area) || 0;
    const total = p.unit === 'sqm' ? p.amount * area : p.amount;
    const perSqm = p.unit === 'sqm' ? p.amount : (area > 0 ? p.amount / area : null);
    return Object.assign({}, p, { total, perSqm });
  }
  function notesOf(f) { const r = recOf(f.properties.uid); if (r && r.notes !== undefined) return r.notes || ''; const s = sales.get(f.properties.uid); return s && s.notes && !/سهيل/.test(s.notes) ? s.notes : ''; }   // v1.18: import remarks naming the source are not shown

  /* ---------- v1.14: live parcels = base parcels + admin store ----------
     A base parcel whose number, area, plan or boundary was edited (or that was deleted) is hidden in the base layers and,
     unless deleted, drawn from the separate source "parcels-adm". Parcels added by the admin live only in that source. */
  const ADM_FC = { type: 'FeatureCollection', features: [] };
  let HIDDEN = [];
  const LIVE_BY_PLAN = new Map();
  const structural = r => !!(r && (r.added || r.deleted || r.geom || r.no !== undefined || r.area !== undefined || r.plan !== undefined));
  function ringArea(r) { let a = 0; const R = 6378137, rad = Math.PI / 180; for (let i = 0; i < r.length - 1; i++) { const [x1, y1] = r[i], [x2, y2] = r[i + 1]; a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad)); } return Math.abs(a * R * R / 2); }
  function geomArea(g) { if (!g) return 0; const ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; return ps.reduce((t, p) => t + ringArea(p[0]) - p.slice(1).reduce((h, x) => h + ringArea(x), 0), 0); }
  function labelPoint(g) {
    const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
    const ox = ring[0][0], oy = ring[0][1];   // v1.26: relative to the first vertex (precision)
    let a = 0, cx = 0, cy = 0; for (let i = 0; i < ring.length - 1; i++) { const x1 = ring[i][0] - ox, y1 = ring[i][1] - oy, x2 = ring[i + 1][0] - ox, y2 = ring[i + 1][1] - oy, c = x1 * y2 - x2 * y1; a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c; }
    let pt = a ? [ox + cx / (3 * a), oy + cy / (3 * a)] : ring[0];
    if (!inGeomP(pt, g)) { const n = ring.length - 1; pt = [ring.slice(0, n).reduce((t, q) => t + q[0], 0) / n, ring.slice(0, n).reduce((t, q) => t + q[1], 0) / n]; }
    return [Math.round(pt[0] * 1e6) / 1e6, Math.round(pt[1] * 1e6) / 1e6];
  }
  /* v1.25: Google Maps link for the parcel itself — a point that lies INSIDE this parcel's own boundary (not the plan or district).
     The area centroid is used when it falls inside; otherwise the middle of the widest inside span on the centroid's latitude
     (or on a few nearby latitudes) is used, so L-shaped or curved parcels still get a point on their own land. */
  function insidePoint(g) {
    if (!g) return null;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (!polys.length) return null;
    let best = polys[0], ba = -1;   // largest part
    polys.forEach(pp => { const r = pp[0]; let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; if (Math.abs(a) > ba) { ba = Math.abs(a); best = pp; } });
    /* v1.26: the centroid is computed relative to the first vertex — with raw lon/lat (≈46 × 24) the products cancel out and the
       point drifted to the parcel edge on small parcels (10 parcels opened on the neighbouring plot in Google Maps) */
    const ring = best[0], ox = ring[0][0], oy = ring[0][1]; let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) { const x1 = ring[i][0] - ox, y1 = ring[i][1] - oy, x2 = ring[i + 1][0] - ox, y2 = ring[i + 1][1] - oy, c = x1 * y2 - x2 * y1; a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c; }
    const pg = { type: 'Polygon', coordinates: best };
    if (a) { const pt = [ox + cx / (3 * a), oy + cy / (3 * a)]; if (inGeomP(pt, pg)) return pt; }
    let y0 = Infinity, y1 = -Infinity; ring.forEach(q => { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
    let out = null, wid = -1;
    for (let k = 1; k < 16; k++) {
      const y = y0 + (y1 - y0) * k / 16, xs = [];
      best.forEach(r => { for (let i = 0; i < r.length - 1; i++) { const [xa, ya] = r[i], [xb, yb] = r[i + 1]; if ((ya > y) !== (yb > y)) xs.push(xa + (y - ya) * (xb - xa) / (yb - ya)); } });
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > wid) { wid = xs[i + 1] - xs[i]; out = [(xs[i] + xs[i + 1]) / 2, y]; }
    }
    return out;
  }
  const GMAP_ICON = '<svg class="gmap-ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="#ea4335" d="M12 1.8a7.2 7.2 0 0 0-7.2 7.2c0 5.4 7.2 13.2 7.2 13.2s7.2-7.8 7.2-13.2A7.2 7.2 0 0 0 12 1.8z"/><path fill="#4285f4" d="M12 1.8a7.2 7.2 0 0 0-5.1 2.1l5.1 5.1z"/><path fill="#34a853" d="M6.9 3.9A7.2 7.2 0 0 0 4.8 9c0 1.3.4 2.7 1 4.1L12 9z"/><path fill="#fbbc04" d="M5.8 13.1c1.9 4.3 6.2 9.1 6.2 9.1V9z"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>';
  function gmapRow(f) {
    const dd = $('c-gmap'); if (!dd) return;
    const pt = insidePoint(f.geometry);
    $('c-gmap-dt').hidden = dd.hidden = !pt; if (!pt) { dd.innerHTML = ''; return; }
    const lat = pt[1].toFixed(6), lon = pt[0].toFixed(6);
    const url = 'https://www.google.com/maps/search/?api=1&query=' + lat + '%2C' + lon;
    let qr = '';
    try { if (window.qrcode) { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); } } catch (e) { qr = ''; }
    dd.innerHTML = '<a class="gmap-link" href="' + url + '" target="_blank" rel="noopener noreferrer">' + GMAP_ICON + '<span>الموقع على خرائط قوقل (Google Maps)</span></a>'
      + '<span class="gmap-ll"><bdi dir="ltr" class="num">' + lat + ', ' + lon + '</bdi></span>'
      + (qr ? '<span class="gmap-qr" title="امسح الرمز بالجوال لفتح الموقع">' + qr + '<small>امسح بالجوال</small></span>' : '');
  }
  function inRingP(pt, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; }
  function inGeomP(pt, g) { const ps = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; return ps.some(p => inRingP(pt, p[0]) && !p.slice(1).some(h => inRingP(pt, h))); }
  function liveFeature(uid, r) {
    const b = BASE_UID.get(uid);
    if (!b && !r.added) return null;
    const bp = b ? b.properties : { uid, plan: r.plan, no: '', nos: [], sec: [], area: 0, flags: [], lx: 0, ly: 0 };
    const p = Object.assign({}, bp, { adm: 1 });
    p.flags = (bp.flags || []).slice(); p.sec = (bp.sec || []).slice(); p.nos = (bp.nos || []).slice();
    if (r.added) p.flags.push('admin_added');
    if (r.plan !== undefined) p.plan = r.plan;
    if (r.no !== undefined && (!b || r.no !== bp.no)) {
      p.no = r.no; p.nos = r.no ? [r.no] : []; delete p.dup_n; delete p.dup_k;
      p.flags = p.flags.filter(x => x !== 'duplicate_number' && x !== 'multiple_numbers' && x !== 'no_number'); if (!r.no) p.flags.push('no_number');
    }
    if (r.area !== undefined) p.area = r.area;
    const g = r.geom || (b && b.geometry);
    if (!g) return null;
    if (r.geom) { const c = labelPoint(g); p.lx = c[0]; p.ly = c[1]; }
    return { type: 'Feature', properties: p, geometry: g };
  }
  function rebuildLive() {
    HIDDEN = []; ADM_FC.features = []; byUid.clear(); byNo.clear(); LIVE_BY_PLAN.clear();
    for (const [u, f] of BASE_UID) byUid.set(u, f);
    const ps = STORE ? STORE.store.parcels : {};
    for (const uid of Object.keys(ps)) {
      const r = ps[uid]; if (!structural(r)) continue;
      if (BASE_UID.has(uid)) HIDDEN.push(uid);
      if (r.deleted) { byUid.delete(uid); continue; }
      const lf = liveFeature(uid, r);
      if (lf) { ADM_FC.features.push(lf); byUid.set(uid, lf); } else byUid.delete(uid);
    }
    for (const f of byUid.values()) {
      const pl = f.properties.plan; if (!LIVE_BY_PLAN.has(pl)) LIVE_BY_PLAN.set(pl, []); LIVE_BY_PLAN.get(pl).push(f);
      for (const n of f.properties.nos) { const k = pl + '|' + normNo(n); if (!byNo.has(k)) byNo.set(k, []); byNo.get(k).push(f); }
    }
    if (mapReady) {
      map.getSource('parcels-adm').setData(ADM_FC);
      applyHidden();
      for (const f of ADM_FC.features) applyState(f.properties.uid);
      if (selected) { const nf = byUid.get(selected.properties.uid); if (nf) select(nf, false, true); else clearSelection(false); }
    }
  }
  const srcOf = f => (f.properties.adm ? 'parcels-adm' : 'parcels');
  function applyState(uid) {
    const f = byUid.get(uid); if (!f || !mapReady) return;
    const pr = priceInfo(f);
    map.setFeatureState({ source: srcOf(f), id: uid }, { st: statusOf(f), pt: pr ? pr.total : -1, pm: pr && pr.perSqm != null ? pr.perSqm : -1 });
  }
  /* base layers (source parcels / review) skip hidden parcels; layers added later (realistic view) are handled on styledata */
  const BASE_FILTER = {}; const filtered = new WeakSet();
  function hiddenFilter(id) {
    const bf = BASE_FILTER[id]; if (!HIDDEN.length) return bf;
    const nh = ['!', ['in', ['get', 'uid'], ['literal', HIDDEN]]];
    return bf ? ['all', bf, nh] : nh;
  }
  function applyHidden(onlyNew) {
    const ids = map.getLayersOrder ? map.getLayersOrder() : map.style._order;   // not getStyle(): it would serialise all parcel data
    for (const id of ids) {
      const L = map.getLayer(id); if (!L) continue;
      if ((L.source !== 'parcels' && L.source !== 'review' && L.source !== 'sides') || L.id === 'parcel-sel' || L.id === 'side-sel') continue;
      const obj = L;
      if (onlyNew && filtered.has(obj)) continue;
      if (!(L.id in BASE_FILTER) || !filtered.has(obj)) BASE_FILTER[L.id] = L.filter || null;
      map.setFilter(L.id, hiddenFilter(L.id)); filtered.add(map.getLayer(L.id));
    }
  }
  let mapReady = false;
  let SIDE_BUILD = null;   // v1.21: result of AridSides.build (labels, parcels whose recorded vertices were not found)

  /* ---------- verification state (v0.9.8-TEST) — separate file data/parcel_review.js, never mixed with plan data or sales ----------
     A parcel listed there is "قيد المراجعة": it is still drawn, searchable and keeps its sales record, but it is hatched and its card says why. */
  const REVIEW = (window.PARCEL_REVIEW && window.PARCEL_REVIEW.parcels) || {};
  const reviewOf = uid => REVIEW[uid] || null;
  const REVIEW_TXT = {
    NO_MATCH: 'لم تتطابق حدود هذه القطعة بثقة كافية مع المصدر المرجعي، لذلك حدودها وموقعها الدقيق قيد التحقق.',
    STRADDLES_REF: 'هذه القطعة تقع في المصدر المرجعي على جزأين من قطعتين مختلفتين، والفرق قيد التحقق.',
    SPLIT_IN_REF: 'هذه القطعة تظهر في المصدر المرجعي مقسومة إلى أكثر من قطعة؛ قد تكون قُسّمت بعد تاريخ المخطط.',
    MERGED_IN_REF: 'هذه القطعة تظهر في المصدر المرجعي مدموجة مع قطعة مجاورة؛ قد تكون دُمجت بعد تاريخ المخطط.',
    BOUNDARY_DIFF: 'حدود هذه القطعة أو مساحتها في المخطط تختلف عن المصدر المرجعي بأكثر من 5٪، والاختلاف قيد التحقق.',
    LOCAL_OFFSET: 'هذه القطعة تظهر في المصدر المرجعي منزاحة بضعة أمتار عن موقعها هنا، والفرق قيد التحقق.',
    NUM_MISSING_OURS: 'لا يوجد رقم مكتوب لهذه القطعة في ملف المخطط، ولها رقم في المصدر المرجعي.',
    NUM_PARTIAL_OURS: 'الرقم المكتوب في ملف المخطط جزء من الرقم الكامل في المصدر المرجعي.',
    NUM_OFF_BY_ONE: 'رقم هذه القطعة في المصدر المرجعي يختلف بواحد عن رقمها هنا، والرقم قيد التحقق.',
    NUM_DIFFERENT: 'رقم هذه القطعة يختلف في المصدر المرجعي، والرقم قيد التحقق.',
    CORRIDOR_RING: 'يمر بهذه القطعة المسار التقريبي للطريق الدائري الثاني، وليس مسارًا رسميًا.',
    CORRIDOR_STREAM: 'يمر بهذه القطعة المسار التقريبي لشعيب مريسلة، وليس حرمًا رسميًا.',
    PLAN_VERSION: 'يبدو أن نسخة المخطط المتوفرة تختلف عن المخطط المعتمد الحالي في هذا الصف من القطع.',
    OUTSIDE_PLAN_BOUNDARY: 'هذه القطعة مسجلة ضمن هذا المخطط، لكنها تقع خارج حدوده المرسومة؛ والتعارض قيد التحقق.',
    ROAD_THROUGH_PARCEL: 'يمر بهذه القطعة طريق قائم (حسب طبقة الشوارع) رغم أنها مرسومة قطعةً في المخطط؛ التعارض قيد التحقق.',
    PDF_SPLIT: 'هذه القطعة جزء من قطعة أكبر في ملف المخطط الأصلي (قد تكون فُرزت بعد تاريخ المخطط). والفرق قيد التحقق.',
    PDF_MERGE: 'هذه القطعة تقابل أكثر من قطعة في ملف المخطط الأصلي (قد تكون دُمجت بعد تاريخ المخطط). والفرق قيد التحقق.',
    PDF_SHAPE_DIFF: 'مساحة هذه القطعة تختلف عن ملف المخطط الأصلي بأكثر من 3٪، والاختلاف قيد التحقق.',
    PDF_NUM_SUFFIX: 'رقم هذه القطعة رقم فرعي من رقمها في ملف المخطط الأصلي أو العكس (مثل 267 و267/1)، والفرق قيد التحقق.',
    PDF_NUM_DIFF: 'رقم هذه القطعة يختلف عن رقمها في ملف المخطط الأصلي، والرقم قيد التحقق.',
    PDF_NUM_ONLY_IN_PDF: 'لهذه القطعة رقم مكتوب في ملف المخطط الأصلي، ولا رقم لها في المصدر المرجعي؛ الرقم قيد التحقق.',
    NOT_IN_PDF: 'هذه القطعة موجودة في المصدر المرجعي ولا تظهر في ملف المخطط الأصلي، والفرق قيد التحقق.' };
  const REVIEW_FC = { type: 'FeatureCollection', features: PAR.features.filter(f => REVIEW[f.properties.uid]) };
  const REL = window.LOCATION_RELEASE || null;
  const byAlias = new Map();   // "<plan>|<ref number>" -> features (only NUM_MISSING_OURS / NUM_PARTIAL_OURS)
  for (const f of PAR.features) { const rv = REVIEW[f.properties.uid];
    if (rv && rv.ref_no && rv.codes.some(c => c === 'NUM_MISSING_OURS' || c === 'NUM_PARTIAL_OURS')) { const k = f.properties.plan + '|' + normNo(rv.ref_no); if (!byAlias.has(k)) byAlias.set(k, []); byAlias.get(k).push(f); } }

  /* ---------- map ---------- */
  const PANEL_PAD = () => {
    if (window.innerWidth <= 768) {
      return { top: 75, bottom: Math.round(Math.min(window.innerHeight * 0.45, 340)), left: 20, right: 20 };
    }
    return { top: 110, bottom: 90, left: 120, right: (window.innerWidth > 1100 ? 440 : 360) + 60 };
  };
  /* ---------- scale map typography & zoom thresholds with the screen (1920 px wide = reference) ---------- */
  const TS = Math.min(2.4, Math.max(0.85, Math.min(innerWidth, innerHeight) / 1080));   // text/line scale factor (matches CSS 1.6vmin)
  const ZO = Math.log2(TS);                                      // same geography appears ZO zoom levels deeper on a bigger canvas
  function scaleOut(v) {
    if (typeof v === 'number') return v * TS;
    if (Array.isArray(v) && v[0] === 'match') return v.map((x, i) => (i >= 3 && (i % 2 === 1 || i === v.length - 1)) ? scaleOut(x) : x);
    return v;
  }
  function adaptExpr(e, scale) {
    if (Array.isArray(e) && e[0] === 'interpolate' && Array.isArray(e[2]) && e[2][0] === 'zoom') {
      const o = e.slice(0, 3); for (let i = 3; i < e.length; i += 2) { o.push(e[i] + ZO, scale ? scaleOut(e[i + 1]) : e[i + 1]); } return o;
    }
    return scale ? scaleOut(e) : e;
  }
  function adapt(style) {
    const SCALE = ['text-size', 'line-width', 'text-halo-width'];
    for (const L of style.layers) {
      if (L.minzoom != null) L.minzoom += ZO; if (L.maxzoom != null) L.maxzoom += ZO;
      for (const grp of ['paint', 'layout']) for (const k in (L[grp] || {})) L[grp][k] = adaptExpr(L[grp][k], SCALE.includes(k));
    }
    return style;
  }
  /* v1.14: the admin source gets the same parcel layers as the base source (fill / line / selection / number) */
  function withAdmLayers(style) {
    const out = [];
    for (const L of style.layers) {
      out.push(L);
      if (L.source === 'parcels') {
        const c = JSON.parse(JSON.stringify(L)); c.id = L.id.replace('parcel-', 'adm-'); c.source = 'parcels-adm';
        if (L.id === 'parcel-line') c.paint['line-color'] = '#d9b878';
        out.push(c);
      }
    }
    style.layers = out; return style;
  }
  const EMPTY_FC = { type: 'FeatureCollection', features: [] };
  const SIDES = window.AridSides || null;
  const SIDE_LAYERS = SIDES ? SIDES.layers() : { buckets: [], sel: { id: 'side-sel', type: 'background', layout: { visibility: 'none' } } };
  const map = new maplibregl.Map({
    container: 'map', attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
    maxBounds: [[46.10, 24.15], [47.40, 25.20]], minZoom: 8.5, maxZoom: 19.5,
    bounds: RIYADH_BOUNDS, fitBoundsOptions: { padding: PANEL_PAD() },
    style: adapt(withAdmLayers({
      version: 8, glyphs: 'emb://{fontstack}/{range}.pbf',
      sources: {
        roads: { type: 'geojson', data: BM.riyadh_roads },
        detail: { type: 'geojson', data: BM.arid_detail },
        places: { type: 'geojson', data: BM.places },
        roadlabels: { type: 'geojson', data: BM.road_labels },
        outline: { type: 'geojson', data: OUT },
        parcels: { type: 'geojson', data: EMPTY_FC, promoteId: 'uid' },   // v1.19: filled right after the map loads (see map.on('load'))
        'parcels-adm': { type: 'geojson', data: ADM_FC, promoteId: 'uid' },   // v1.14: parcels added/edited from the admin panel
        review: { type: 'geojson', data: EMPTY_FC },
        landmarks: { type: 'geojson', data: window.SUHAIL_FEATURES || { type: 'FeatureCollection', features: [] } },   // v1.3: non-sale features from Suhail
        sides: { type: 'geojson', data: EMPTY_FC }   // v1.21: side lengths (js/sides.js), filled after the map loads
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#1f1e1c' } },
        { id: 'water', type: 'line', source: 'detail', filter: ['==', ['get', 'k'], 'water'], minzoom: 11,
          paint: { 'line-color': '#2e3a3a', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 2.5] } },
        { id: 'detail-roads', type: 'line', source: 'detail', filter: ['all', ['==', ['get', 'k'], 'road'], ['!=', ['get', 'h'], 'construction']], minzoom: 11.5,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['match', ['get', 'c'], 4, '#4a453c', 5, '#3b3832', '#34312c'],
                   'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, ['match', ['get', 'c'], 4, 1.2, 0.6], 18, ['match', ['get', 'c'], 4, 16, 9]] } },
        { id: 'detail-construction', type: 'line', source: 'detail', filter: ['==', ['get', 'h'], 'construction'], minzoom: 12,
          paint: { 'line-color': '#4a453c', 'line-dasharray': [2, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 18, 4] } },
        { id: 'roads-minor', type: 'line', source: 'roads', filter: ['>=', ['get', 'c'], 3],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#4d483f', 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.4, 13, 1.6, 18, 18] } },
        { id: 'roads-primary', type: 'line', source: 'roads', filter: ['==', ['get', 'c'], 2],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#6f6553', 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.8, 13, 2.6, 18, 26] } },
        { id: 'roads-major', type: 'line', source: 'roads', filter: ['==', ['get', 'c'], 1],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#8f7c55', 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 1.4, 13, 4, 18, 36] } },
        { id: 'plan-fill', type: 'fill', source: 'outline', maxzoom: 15.5,
          paint: { 'fill-color': '#c9a24e', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 14, 0.18, 15.5, 0] } },
        { id: 'plan-line', type: 'line', source: 'outline',
          paint: { 'line-color': '#e2c47a', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 16, 2.5], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, 1, 17, 0.35] } },
        /* v1.3: parks, mosques and parking shown in Suhail but not drawn as numbered parcels in the plan PDFs.
           Display only — not parcels: not selectable, not searchable, no sales status. */
        { id: 'landmark-fill', type: 'fill', source: 'landmarks', minzoom: 13,
          paint: { 'fill-color': ['match', ['get', 'kind'], 'park', '#5b8e92', 'mosque', '#8d86ad', '#5f676f'],   // v1.15: same palette as service parcels
                   'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.25, 16, 0.4] } },
        { id: 'landmark-line', type: 'line', source: 'landmarks', minzoom: 13,
          paint: { 'line-color': ['match', ['get', 'kind'], 'park', '#9cc4c6', 'mosque', '#c3bddb', '#9aa2aa'], 'line-dasharray': [3, 2],
                   'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 18, 1.4] } },
        { id: 'parcel-fill', type: 'fill', source: 'parcels', minzoom: 13,
          paint: {
            'fill-color': ['case', ['boolean', ['feature-state', 'sel'], false], '#e2c47a',
              ['match', ['coalesce', ['feature-state', 'st'], 'unknown'], 'available', '#DFBE7B', 'reserved', '#d49a3a', 'sold', '#9b5f55', 'service', ['match', ['get', 'svc'], 'recreation', '#5b8e92', 'religious', '#8d86ad', 'education', '#6f8fbf', 'transport', '#5f676f', 'utility', '#a08aa0', 'vacant', '#8c8577', '#7d8a99'], '#c9a24e']],
            'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.75,
              ['match', ['coalesce', ['feature-state', 'st'], 'unknown'], 'unknown', 0.05, 0.65]] } },
        { id: 'parcel-line', type: 'line', source: 'parcels', minzoom: 13,
          paint: { 'line-color': '#b89656', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.35, 16, 0.9],
                   'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.3, 16, 0.8, 19, 1.6] } },
        /* v1.15: service land — a soft outline in a lighter tint of its family colour (shown only while the parcel's status is «خدمات») */
        { id: 'parcel-svcline', type: 'line', source: 'parcels', minzoom: 14,
          paint: { 'line-color': ['match', ['get', 'svc'], 'recreation', '#9cc4c6', 'religious', '#c3bddb', 'education', '#a9c0e2', 'transport', '#9aa2aa', 'utility', '#d2bfd2', 'vacant', '#c2bcae', '#b6c0cc'], 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 17, 1.4, 19, 2.2],
                   'line-opacity': ['case', ['==', ['coalesce', ['feature-state', 'st'], 'unknown'], 'service'], 0.8, 0] } },
        { id: 'review-hatch', type: 'fill', source: 'review', minzoom: 13, paint: { 'fill-pattern': 'rv-hatch', 'fill-opacity': 0.9 } },
        { id: 'review-line', type: 'line', source: 'review', minzoom: 13,
          paint: { 'line-color': '#e0a24a', 'line-dasharray': [2, 1.5], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 16, 1.2, 19, 2.2] } },
        { id: 'parcel-sel', type: 'line', source: 'parcels', filter: ['==', ['get', 'uid'], ''],
          paint: { 'line-color': '#fff6dc', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 4] } },
        { id: 'road-names', type: 'symbol', source: 'roadlabels', minzoom: 12.5,
          // v1.3 r2: names of the added Suhail streets (mostly numbered, e.g. "عريض 5441") only from zoom 17, so they do not crowd the plan view
          filter: ['any', ['<=', ['get', 'c'], 2], ['all', ['>=', ['zoom'], 15], ['!=', ['get', 'src'], 'suhail']], ['>=', ['zoom'], 17]],
          layout: { 'text-field': ['get', 'n'], 'text-font': ['Plex Arabic Medium'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 15, 17, 19], 'text-padding': 30, 'text-max-width': 9, 'text-line-height': 1.35 },
          paint: { 'text-color': '#d6ccb8', 'text-halo-color': 'rgba(24,23,21,0.95)', 'text-halo-width': 2, 'text-halo-blur': 0.4 } },
        { id: 'place-names', type: 'symbol', source: 'places', maxzoom: 12.5,
          filter: ['all', ['!=', ['get', 'p'], 'city'], ['!=', ['get', 'n'], 'عريض']],
          layout: { 'text-field': ['get', 'n'], 'text-font': ['Plex Arabic Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 13, 12, 17], 'text-max-width': 7, 'text-line-height': 1.3, 'text-padding': 6 },
          paint: { 'text-color': '#b9b09e', 'text-halo-color': 'rgba(24,23,21,0.95)', 'text-halo-width': 1.8, 'text-halo-blur': 0.4 } },
        { id: 'landmark-name', type: 'symbol', source: 'landmarks', minzoom: 15,
          filter: ['any', ['!=', ['get', 'kind'], 'parking'], ['>=', ['zoom'], 16.5]],
          layout: { 'text-field': ['get', 'n'], 'text-font': ['Plex Arabic Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 13, 18, 17], 'text-padding': 4 },
          paint: { 'text-color': '#d8d0bc', 'text-halo-color': 'rgba(24,23,21,0.92)', 'text-halo-width': 1.6 } },
        /* v1.21: side lengths (Suhail, metres) along each side, just inside the parcel; listed below the areas and numbers, so where labels
           would collide the parcel number and area are kept and the side length waits for a closer zoom */
        ...SIDE_LAYERS.buckets,
        /* v1.21: area under the parcel number, from zoom 17.6 (dropped automatically where it would not fit) */
        { id: 'parcel-area', type: 'symbol', source: 'parcels', minzoom: 17.6,
          layout: { 'text-field': ['concat', '\u200e', ['to-string', ['get', 'area']], ' م\u200e²'], 'text-font': ['Plex Arabic Regular'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 17.6, 10.5, 19, 13], 'text-offset': [0, 1.9], 'text-padding': 0 },
          paint: { 'text-color': '#bfb196', 'text-halo-color': 'rgba(24,23,21,0.92)', 'text-halo-width': 1.4 } },
        { id: 'parcel-no', type: 'symbol', source: 'parcels', minzoom: 16.3,
          layout: { 'text-field': ['concat', '\u200e', ['get', 'no']], 'text-font': ['Plex Arabic SemiBold'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 16.3, 12, 17.5, 15, 19, 21], 'text-padding': 1, 'text-max-width': 20, 'text-letter-spacing': 0.02 },
          paint: { 'text-color': '#f6ecd4', 'text-halo-color': 'rgba(24,23,21,0.92)', 'text-halo-width': 1.6 } },
        SIDE_LAYERS.sel   // v1.21: all side lengths of the selected parcel, whatever the zoom
      ]
    }))
  });

  map.on('styleimagemissing', e => {
    if (e.id === 'len-frame') {   // v1.24: thin frame around Suhail lengths that do not agree with the drawn outline
      const w = 20, h = 16, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
      g.fillStyle = 'rgba(24,23,21,0.6)'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(217,202,165,0.9)'; g.fillRect(0, 0, w, 1); g.fillRect(0, h - 1, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(w - 1, 0, 1, h);
      map.addImage('len-frame', g.getImageData(0, 0, w, h), { stretchX: [[2, 18]], stretchY: [[2, 14]], content: [2, 2, 18, 14] });
      return;
    }
    if (e.id !== 'rv-hatch') return;
    const n = 16, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
    g.strokeStyle = 'rgba(224,162,74,0.85)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-4, n + 4); g.lineTo(n + 4, -4); g.moveTo(n - 4, n + 4); g.lineTo(n + 4, n - 4); g.moveTo(-4, 4); g.lineTo(4, -4); g.stroke();
    map.addImage('rv-hatch', g.getImageData(0, 0, n, n));
  });

  /* ---------- markers (district + plan entry points) ---------- */
  function marker(lnglat, title, sub, onTap, pulse) {
    const el = document.createElement('button'); el.className = 'mk';
    el.innerHTML = `<span class="mk-tag">${title}</span><span class="mk-dot${pulse ? ' pulse' : ''}"></span>` + (sub ? `<span class="mk-sub">${sub}</span>` : '');
    el.addEventListener('click', e => { e.stopPropagation(); onTap(); });
    return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(lnglat).addTo(map);
  }
  const aridLL = ARID_LABEL ? ARID_LABEL.coordinates : [(ALL_BBOX[0] + ALL_BBOX[2]) / 2, (ALL_BBOX[1] + ALL_BBOX[3]) / 2];
  const mkArid = marker(aridLL, 'حي عريض', null, () => go('arid'), true);
  const mkPlans = PLANS.map(p => marker(p.center, planLabel(p.meta.id), 'اضغط لعرض القطع', () => go('plan', p.meta.id), false));
  /* v1.3: with many plans the plan markers covered each other (a covered marker could not be tapped).
     Display only — plan data are unchanged. Each marker may sit at its plan centre or at another point inside its own
     plan outline. Placement is computed when the map stops moving: a few placement orders are tried and the one with the
     least label overlap is kept. If labels would still overlap, compact labels are used (smaller, without the hint line).
     With a single plan nothing changes. */
  const inRing = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
  const inGeom = (pt, g) => { const ps = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; return ps.some(p => inRing(pt, p[0]) && !p.slice(1).some(h => inRing(pt, h))); };
  const MK_CAND = PLANS.map(p => {
    const b = p.bbox, n = 20, c = [];
    for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) { const q = [b[0] + (b[2] - b[0]) * i / n, b[1] + (b[3] - b[1]) * j / n]; if (inGeom(q, p.outline && p.outline.geometry)) c.push(q); }
    const d = q => (q[0] - p.center[0]) ** 2 + (q[1] - p.center[1]) ** 2;
    return [p.center].concat(c.sort((a, b) => d(a) - d(b)));
  });
  const MK_ORDERS = (() => {   // several placement orders are tried; the arrangement with the least label overlap is kept
    const idx = MK_CAND.map((c, i) => i);
    return [idx.slice().sort((a, b) => MK_CAND[a].length - MK_CAND[b].length || a - b), idx, idx.slice().reverse()];
  })();
  function declutter() {
    if (PLANS.length < 2) return;
    const els = mkPlans.map(m => m.getElement()); if (els[0].style.display === 'none') return;
    const ov = (r, o) => Math.max(0, Math.min(r[2], o[2]) - Math.max(r[0], o[0])) * Math.max(0, Math.min(r[3], o[3]) - Math.max(r[1], o[1]));
    const arrange = order => {
      const placed = [], at = []; let total = 0;
      order.forEach(i => {
        const w = els[i].offsetWidth, h = els[i].offsetHeight, rect = q => { const s = map.project(q); return [s.x - w / 2, s.y - h, s.x + w / 2, s.y]; };
        let best = null, bo = Infinity;
        for (const q of MK_CAND[i]) { const r = rect(q), a = placed.reduce((t, o) => t + ov(r, o), 0); if (a < bo) { bo = a; best = [q, r]; if (a === 0) break; } }
        at[i] = best[0]; placed.push(best[1]); total += bo;
      });
      return { at, total };
    };
    const place = mode => {   // v1.6: '' → 'compact' → 'tiny' (21 plans: the smallest size is tried only if labels still overlap)
      els.forEach(e => { e.classList.toggle('compact', mode !== ''); e.classList.toggle('tiny', mode === 'tiny'); });
      let best = null;
      for (const o of MK_ORDERS) { const r = arrange(o); if (!best || r.total < best.total) best = r; if (r.total === 0) break; }
      best.at.forEach((q, i) => mkPlans[i].setLngLat(q));
      return best.total === 0;
    };
    if (!place('')) if (!place('compact')) place('tiny');
  }

  /* ---------- levels ---------- */
  let level = 'riyadh', selected = null;
  function aridBounds() {
    const b = ALL_BBOX; const x = [b[0], b[2], aridLL[0]], y = [b[1], b[3], aridLL[1]];
    return [[Math.min(...x) - 0.02, Math.min(...y) - 0.015], [Math.max(...x) + 0.02, Math.max(...y) + 0.015]];
  }
  function go(lv, planId) {
    const pad = PANEL_PAD(); const dur = 1600;
    if (lv !== 'parcel') clearSelection(true);
    if (lv === 'plan') { if (planId) currentPlan = planId; if (!currentPlan) lv = 'arid'; }
    if ((lv === 'riyadh' || lv === 'arid') && PLANS.length > 1) currentPlan = null;   // search all plans again
    if (lv === 'riyadh') map.fitBounds(RIYADH_BOUNDS, { padding: pad, duration: dur });
    if (lv === 'arid') map.fitBounds(aridBounds(), { padding: pad, duration: dur });
    if (lv === 'plan') { const b = PLAN_BY_ID[currentPlan].bbox; map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad, duration: dur }); }
    pinned = lv === 'parcel' ? null : lv;
    setLevel(lv);
  }
  // zoom thresholds are tuned for a 1920-px-wide map and shifted for other widths
  const ZW = Math.log2(innerWidth / 1920);
  function levelFromZoom() { if (selected) return 'parcel'; const z = map.getZoom() - ZW; return z < 11.4 ? 'riyadh' : z < 13.4 ? 'arid' : 'plan'; }
  let pinned = null;   // level chosen by a navigation button; kept until the visitor zooms/pans by hand
  function markerVis() {
    const z = map.getZoom() - ZW;
    mkArid.getElement().style.display = (z < 11.4 || (PLANS.length === 1 && z < 12.4)) ? '' : 'none';   // several plans: the district marker would cover a plan marker
    mkPlans.forEach(m => m.getElement().style.display = (z >= 10.2 && z < 14.2) ? '' : 'none');
  }
  function setLevel(lv) {
    level = lv; const order = ['riyadh', 'arid', 'plan', 'parcel']; const k = order.indexOf(lv);
    document.querySelectorAll('#trail button').forEach(b => {
      const i = order.indexOf(b.dataset.level); b.classList.toggle('current', i === k); b.classList.toggle('reach', i < k);
    });
    $('trail-parcel').hidden = !selected;
    const dp = currentPlan || (selected && selected.properties.plan);
    document.querySelector('#trail button[data-level="arid"]').textContent = (dp && DISTRICT_OF[dp]) || 'حي عريض';
    const tp = document.querySelector('#trail button[data-level="plan"]');
    tp.innerHTML = currentPlan ? planLabel(currentPlan) : 'المخططات';
    if (searchMode === 'plan') $('search-label').innerHTML = 'ابحث برقم المخطط <small class="muted">(مثال: 2745 يعرض 2745 و2745-A و2745-B)</small>'; else
    $('search-label').innerHTML = 'ابحث برقم القطعة' + (currentPlan ? ' في ' + planLabel(currentPlan) : (PLANS.length > 1 ? ' في كل المخططات' : ''))
      + (currentPlan && PLANS.length > 1 ? ' <button type="button" class="scope" id="btn-scope">كل المخططات</button>' : '');
    if (selected) $('trail-parcel').innerHTML = (!selected.properties.no && statusOf(selected) === 'service') ? esc(svcLabel(selected.properties))   // v1.15
      : 'قطعة <bdi dir="ltr" class="num">' + esc(selected.properties.no || '—') + '</bdi>';
    const hints = {
      riyadh: 'اضغط على <b>حي عريض</b> للانتقال إلى الحي.',
      arid: PLANS.length === 1 ? 'المنطقة المظللة هي <b>' + planLabel(PLANS[0].meta.id) + '</b>. اضغط عليها لعرض القطع.' : 'المناطق المظللة هي المخططات المتاحة. اضغط على أحدها لعرض القطع.',
      plan: 'اضغط على أي قطعة لعرض تفاصيلها، أو ابحث برقمها. قرّب الخريطة لتظهر أرقام القطع.',
      parcel: 'القطعة المحددة مظللة بالذهبي على الخريطة.'
    };
    $('hint').innerHTML = hints[lv];
    $('legend').hidden = !(lv === 'plan' || lv === 'parcel');
    markerVis(); declutter();
  }
  map.on('moveend', e => {
    if (e && (e.originalEvent || e.user)) pinned = null;
    setLevel(selected ? 'parcel' : (pinned || levelFromZoom()));
  });
  map.on('zoom', markerVis);
  document.querySelectorAll('#trail button[data-level]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.level === 'parcel') { if (selected) select(selected, true); } else go(b.dataset.level, b.dataset.level === 'plan' ? currentPlan : null);
  }));
  $('btn-home').addEventListener('click', () => go('riyadh'));
  $('z-in').addEventListener('click', () => map.zoomIn({ duration: 400 }, { user: true }));
  $('z-out').addEventListener('click', () => map.zoomOut({ duration: 400 }, { user: true }));

  /* ---------- selection ---------- */
  function fmtArea(a) { return '<bdi dir="ltr" class="num">' + Math.round(a).toLocaleString('en-US') + '</bdi> م² تقريبًا'; }
  function select(f, fly, keepView) {
    if (selected) map.setFeatureState({ source: srcOf(selected), id: selected.properties.uid }, { sel: false });
    if (selected && srcOf(selected) !== srcOf(f)) map.setFeatureState({ source: srcOf(selected) === 'parcels' ? 'parcels-adm' : 'parcels', id: selected.properties.uid }, { sel: false });
    selected = f; map.setFeatureState({ source: srcOf(f), id: f.properties.uid }, { sel: true });
    if (srcOf(f) === 'parcels-adm') map.setFeatureState({ source: 'parcels', id: f.properties.uid }, { sel: false });
    map.setFilter('parcel-sel', ['==', ['get', 'uid'], srcOf(f) === 'parcels' ? f.properties.uid : '']);
    map.setFilter('adm-sel', ['==', ['get', 'uid'], srcOf(f) === 'parcels-adm' ? f.properties.uid : '']);
    if (SIDES) map.setFilter('side-sel', ['==', ['get', 'uid'], srcOf(f) === 'parcels' ? f.properties.uid : '']);   // v1.21: an edited boundary has no verified lengths
    const p = f.properties; currentPlan = p.plan;
    const sData = sales.get(p.uid);
    { const sl = SIDES && srcOf(f) === 'parcels' ? SIDES.listFor(p.uid) : []; $('c-sides-dt').hidden = $('c-sides').hidden = !sl.length;
      $('c-sides').innerHTML = sl.map(v => '<bdi dir="ltr" class="num">' + v + '</bdi>').join(' · ') + (sl.length ? ' م' : '');
      /* v1.22: lengths computed from the boundary, listed apart from the Suhail values */
      const gl = SIDES && SIDES.listForGeom && srcOf(f) === 'parcels' ? SIDES.listForGeom(p.uid) : []; $('c-gsides-dt').hidden = $('c-gsides').hidden = !gl.length;
      $('c-gsides').innerHTML = gl.map(v => '<bdi dir="ltr" class="num">' + (/سم/.test(v) ? v : v + ' م') + '</bdi>').join(' · '); }   // v1.23: each value carries its unit (m or ≈ cm)
    $('c-no').textContent = p.no || (sData && sData.plot) || 'بدون رقم';
    if ($('c-no-inline')) $('c-no-inline').textContent = p.no || (sData && sData.plot) || '—';
    $('c-uid').textContent = p.uid;
    $('c-area').innerHTML = (sData && sData.area) ? ('<bdi dir="ltr" class="num">' + esc(sData.area) + '</bdi>') : fmtArea(p.area);
    if ($('c-streets-dt') && $('c-streets')) {
      const stVal = sData && sData.streets;
      $('c-streets-dt').hidden = !stVal;
      $('c-streets').hidden = !stVal;
      if (stVal) $('c-streets').textContent = stVal;
    }
    const st = statusOf(f); const s = STATUS[st]; const el = $('c-status');
    const svc = st === 'service';   // v1.15: service land card = number, plan, area and its use — nothing else
    $('card').classList.toggle('svc', svc);
    $('c-use').hidden = !svc;
    $('c-no').hidden = svc && !p.no; document.querySelector('#card .card-label').textContent = svc && !p.no ? '' : 'قطعة رقم';
    if (svc) { $('c-use').textContent = svcLabel(p); $('c-use').style.setProperty('--c', SVC_COLOR[p.svc] || STATUS.service.color); }
    $('c-status-dt').hidden = svc; $('c-status-dd').hidden = svc; $('c-upd-dt').hidden = svc; $('c-upd').hidden = svc; $('c-fine').hidden = svc;
    el.textContent = s.ar; el.style.setProperty('--c', s.color || 'transparent');
    const show = (id, v) => { $(id).hidden = !v; $(id + '-dt').hidden = !v; if (v) $(id).textContent = v; };
    const pr = priceInfo(f), cur = pr ? (CURRENCY[pr.currency] || pr.currency) : '';
    if (sData && sData.price) {
      $('c-price').innerHTML = '<bdi dir="ltr" class="num">' + esc(sData.price) + '</bdi>';
      $('c-price').hidden = svc; $('c-price-dt').hidden = $('c-price').hidden;
    } else {
      $('c-price').innerHTML = pr ? '<bdi dir="ltr" class="num">' + fmtMoney(pr.total) + '</bdi> ' + esc(cur) + (pr.unit === 'sqm' ? ' <small class="muted">(محسوب من سعر المتر)</small>' : '') : '<span class="muted">غير محدد</span>';
      $('c-price').hidden = svc && !pr; $('c-price-dt').hidden = $('c-price').hidden;
    }
    $('c-ppm').innerHTML = pr && pr.perSqm != null ? '<bdi dir="ltr" class="num">' + fmtMoney(pr.perSqm) + '</bdi> ' + esc(cur) + ' / م²' + (pr.unit === 'total' ? ' <small class="muted">(محسوب من السعر الإجمالي)</small>' : '') : '';
    $('c-ppm').hidden = !(pr && pr.perSqm != null); $('c-ppm-dt').hidden = $('c-ppm').hidden;
    // v1.15: on service land only notes typed in the admin panel are shown (the source-file remarks are not)
    show('c-notes', svc ? (((recOf(p.uid) || {}).notes) || '') : (notesOf(f) || (sData && sData.notes) || ''));
    const ar = recOf(p.uid);
    $('c-upd').textContent = ar && ar.updatedAt ? fmtDate(ar.updatedAt) : '';
    if (!(ar && ar.updatedAt)) { $('c-upd').hidden = true; $('c-upd-dt').hidden = true; }   // v1.16: the date row appears only after an admin change
    show('c-sec', p.sec && p.sec.length ? p.sec.join('، ') : '');
    $('c-plan').innerHTML = '<bdi dir="ltr" class="num">' + esc(p.plan || (sData && sData.plan) || '') + '</bdi>';
    gmapRow(f);
    const waBox = $('c-whatsapp-box');
    if (waBox) {
      const pNo = p.no || (sData && sData.plot) || '';
      const pPlan = p.plan || (sData && sData.plan) || '';
      const waMsg = encodeURIComponent('السلام عليكم ورحمة الله، أود الاستفسار عن القطعة رقم ' + pNo + ' في مخطط ' + pPlan + ' بحي عريض المعروضة في خريطة ركن الحراملة.');
      waBox.innerHTML = '<a href="https://wa.me/966504302102?text=' + waMsg + '" target="_blank" rel="noopener noreferrer" class="map-wa-cta-btn">'
        + '<svg class="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.101.005.232-.038.362.275.144.347.491 1.198.534 1.285.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.861.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.043.072.043.419-.101.824z"/></svg>'
        + '<span>خريطة الحراملة • استفسار واتساب</span></a>'
        + '<button type="button" class="map-share-link-btn" id="btn-share-plot" title="نسخ رابط القطعة في خريطة الحراملة">'
        + '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>'
        + '<span>مشاركة رابط القطعة في خريطة الحراملة</span></button>';
      const shareBtn = $('btn-share-plot');
      if (shareBtn) {
        shareBtn.addEventListener('click', () => {
          const u = new URL(window.location.href);
          if (pPlan) u.searchParams.set('plan', pPlan);
          if (pNo) u.searchParams.set('plot', pNo);
          const fullUrl = u.toString();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(fullUrl).then(() => toast('تم نسخ رابط القطعة في خريطة الحراملة بنجاح', 3500));
          } else {
            prompt('انسخ رابط القطعة:', fullUrl);
          }
        });
      }
    }
    const w = [];
    if (p.flags.includes('duplicate_number') && p.dup_n) w.push('الرقم ' + p.no + ' مكتوب على ' + (p.dup_n === 2 ? 'قطعتين' : p.dup_n + ' قطع') + ' في ملف المخطط، وهذه القطعة رقم ' + p.dup_k + ' منها. حالة البيع مرتبطة بالمعرّف فقط، لا بالرقم.');
    else if (p.flags.includes('duplicate_number')) w.push('أحد أرقام هذه القطعة مكتوب على قطعة أخرى أيضًا. حالة البيع مرتبطة بالمعرّف فقط.');
    if (p.flags.includes('multiple_numbers')) w.push('هذه القطعة تحمل أكثر من رقم في المخطط: ' + p.nos.join('، ') + '.');
    if (!salesLoaded) w.push('ملف حالة البيع غير محمّل، لذلك تظهر الحالة "غير محددة".');
    if (p.flags.includes('admin_added')) w.push('قطعة مضافة من لوحة الإدارة، وليست من ملف المخطط.');
    else if (p.adm) w.push('بيانات هذه القطعة أو حدودها معدّلة من لوحة الإدارة. الأصل محفوظ ويمكن استعادته.');
    if (svc) w.length = 0;   // v1.15: service land card shows its use only, no remarks
    $('c-warn').hidden = !w.length; $('c-warn').textContent = w.join(' ');
    const rv = reviewOf(p.uid);
    if (rv) {
      const staff = document.body.classList.contains('admin-mode');   // v1.27 r2: the verification details (reference sources) are shown in admin mode only
      const t = staff ? rv.codes.map(c => REVIEW_TXT[c]).filter(Boolean) : [];
      if (staff && rv.plan_version) t.push(REVIEW_TXT.PLAN_VERSION);
      if (staff && rv.ref_no) t.push('الرقم في المصدر المرجعي: ' + rv.ref_no + '.');
      t.push('يُرجى التحقق من موقع القطعة وحدودها قبل أي حجز أو بيع. حالة البيع المعروضة لم تتغير.');
      $('c-review-txt').textContent = t.join(' ');
    }
    $('c-review').hidden = !rv;
    $('card').hidden = false;
    $('card').classList.remove('collapsed');
    const dTxt = document.querySelector('.sheet-down-txt');
    if (dTxt) dTxt.textContent = 'نزول للخريطة';
    $('panel').classList.add('compact'); $('results').innerHTML = '';
    if (window.AridAdmin) window.AridAdmin.onCard(f);
    if (keepView) return;
    if (window.innerWidth > 768) {
      requestAnimationFrame(() => $('card').scrollIntoView({ block: 'nearest' }));
    }
    if (fly) {
      const c = [p.lx, p.ly];
      map.flyTo({ center: c, zoom: Math.max(map.getZoom(), 17.6 + ZO), padding: PANEL_PAD(), duration: 1400 });
    }
    setLevel('parcel');
  }
  function clearSelection(silent) {
    if (selected) map.setFeatureState({ source: srcOf(selected), id: selected.properties.uid }, { sel: false });
    selected = null; map.setFilter('parcel-sel', ['==', ['get', 'uid'], '']); map.setFilter('adm-sel', ['==', ['get', 'uid'], '']); if (SIDES) map.setFilter('side-sel', ['==', ['get', 'uid'], '']);
    if ($('card')) {
      $('card').hidden = true;
      $('card').classList.remove('collapsed');
      const dTxt0 = document.querySelector('.sheet-down-txt');
      if (dTxt0) dTxt0.textContent = 'نزول للخريطة';
    }
    $('panel').classList.remove('compact');
    if ($('c-streets-dt')) $('c-streets-dt').hidden = true;
    if ($('c-streets')) $('c-streets').hidden = true;
    if ($('c-whatsapp-box')) $('c-whatsapp-box').innerHTML = '';
    if (window.AridAdmin) window.AridAdmin.onCard(null);
    if (!silent) setLevel(pinned || levelFromZoom());
  }
  $('btn-clear').addEventListener('click', () => clearSelection(false));
  const downBtn = $('btn-sheet-down');
  if (downBtn) {
    downBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = $('card');
      const isCollapsed = card.classList.toggle('collapsed');
      const txt = downBtn.querySelector('.sheet-down-txt');
      if (txt) txt.textContent = isCollapsed ? 'رفع التفاصيل' : 'نزول للخريطة';
      if (isCollapsed && typeof map !== 'undefined' && selected) {
        map.easeTo({ padding: { top: 75, bottom: 85, left: 20, right: 20 }, duration: 400 });
      } else if (!isCollapsed && typeof map !== 'undefined' && selected) {
        map.easeTo({ padding: PANEL_PAD(), duration: 400 });
      }
    });
  }
  const cardEl = $('card');
  if (cardEl) {
    cardEl.addEventListener('click', (e) => {
      if (cardEl.classList.contains('collapsed') && !e.target.closest('#btn-clear') && !e.target.closest('#btn-sheet-down')) {
        cardEl.classList.remove('collapsed');
        const txt = document.querySelector('.sheet-down-txt');
        if (txt) txt.textContent = 'نزول للخريطة';
        if (typeof map !== 'undefined' && selected) {
          map.easeTo({ padding: PANEL_PAD(), duration: 400 });
        }
      }
    });
  }
  /* v1.12: once a plan is open (level plan/parcel) a tap on a parcel always opens its card, even at the plan's overview zoom;
     at Riyadh/district level a tap still opens the plan. Both handlers read the level as it was before the tap. */
  let tapLevel = null;
  map.on('mousedown', () => { tapLevel = level; }); map.on('touchstart', () => { tapLevel = level; });
  const planOpen = () => { const lv = tapLevel || level; return lv === 'plan' || lv === 'parcel'; };
  const pickBlocked = () => !!(window.AridAdmin && window.AridAdmin.mapBusy());   // v1.14: drawing / boundary editing owns the taps
  ['parcel-fill', 'adm-fill'].forEach(L => map.on('click', L, e => { if (pickBlocked()) return; const f = e.features && e.features[0]; const lf = f && byUid.get(f.properties.uid); if (lf && planOpen()) select(lf, false); }));
  map.on('click', 'plan-fill', e => { if (pickBlocked()) return; const f = e.features && e.features[0]; const onParcel = planOpen() && map.queryRenderedFeatures(e.point, { layers: ['parcel-fill', 'adm-fill'] }).length;
    if (f && !onParcel && levelFromZoom() !== 'plan') go('plan', f.properties.plan); tapLevel = null; });

  /* ---------- search with on-screen keypad ---------- */
  let q = '';
  let searchMode = 'parcel';   // v1.14: 'parcel' | 'plan'
  function setSearchMode(m) {
    searchMode = m; q = ''; $('q').textContent = ''; $('results').innerHTML = '';
    document.querySelectorAll('#smode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
    document.querySelector('#keypad button[data-k="/أ"]').disabled = m === 'plan';
    setLevel(level);
  }
  document.querySelectorAll('#smode button').forEach(b => b.addEventListener('click', () => setSearchMode(b.dataset.m)));
  function planSearch() {
    const box = $('results'); box.innerHTML = '';
    const hits = PLANS.map(p => p.meta.id).filter(id => id.replace(/[^0-9]/g, '').startsWith(q) || id.startsWith(q)).sort();
    if (!hits.length) { box.innerHTML = `<p>لا يوجد مخطط معروض برقم <bdi dir="ltr" class="num">${esc(q)}</bdi>.</p>`; return; }
    if (hits.length === 1) { go('plan', hits[0]); box.innerHTML = `<p>تم فتح ${planLabel(hits[0])}.</p>`; return; }
    box.insertAdjacentHTML('beforeend', `<p>${hits.length} مخططات تطابق الرقم. اختر واحدًا:</p>`);
    hits.forEach(id => { const b = document.createElement('button'); const n = (LIVE_BY_PLAN.get(id) || []).length;
      b.innerHTML = `<span><bdi dir="ltr" class="num">${n.toLocaleString('en-US')}</bdi> قطعة</span><b><bdi dir="ltr" class="num">${esc(id)}</bdi></b>`;
      b.addEventListener('click', () => { go('plan', id); }); box.appendChild(b); });
  }
  const render = () => { $('q').textContent = q; };
  $('keypad').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k || b.textContent;
    if (k === 'del') q = q.slice(0, -1);
    else if (k === '/أ') { if (q && !q.includes('/')) q += '/أ'; }
    else if (q.length < 7 && !q.includes('/')) q += k;
    if (searchMode === 'plan' && q.includes('/')) q = q.replace(/\/.*/, '');
    render(); $('results').innerHTML = '';
  });
  // numbers printed as sub-divisions of q (e.g. "3/10396", "10396/1", "10396/أ/1") — shown separately, never merged
  function related(pid, nq) {
    const out = [];
    for (const f of (LIVE_BY_PLAN.get(pid) || PLAN_BY_ID[pid].parcels.features)) {
      if (f.properties.nos.some(n => { const m = normNo(n); return m !== nq && (m.startsWith(nq + '/') || m.endsWith('/' + nq)); })) out.push(f);
      if (out.length >= 30) break;
    }
    return out;
  }
  function resultButton(f, i, showPlan, box) {
    const b = document.createElement('button');
    const pos = f.properties.dup_n ? 'الموقع ' + f.properties.dup_k + '، ' : '';
    b.innerHTML = `<span>${pos}المساحة ${fmtArea(f.properties.area)}${showPlan ? '، ' + planLabel(f.properties.plan) : ''}${reviewOf(f.properties.uid) ? ' <em class="rv-tag">قيد المراجعة</em>' : ''}</span><b><bdi dir="ltr" class="num">${esc(f.properties.no)}</bdi></b>`;
    b.addEventListener('click', () => select(f, true)); box.appendChild(b);
  }
  function runSearch() {
    const box = $('results'); box.innerHTML = '';
    if (!q) return;
    if (searchMode === 'plan') return planSearch();
    const nq = normNo(q);
    const all = PLANS.map(p => p.meta.id);
    const plans = currentPlan ? [currentPlan] : all;
    const hits = [].concat(...plans.map(pid => byNo.get(pid + '|' + nq) || []));
    for (const pid of plans) for (const f of (byAlias.get(pid + '|' + nq) || [])) if (!hits.includes(f)) hits.push(f);
    const rel = [].concat(...plans.map(pid => related(pid, nq)));
    const scope = currentPlan ? planLabel(currentPlan) : 'المخططات المعروضة';
    if (!hits.length && !rel.length) {
      const other = currentPlan ? [].concat(...all.filter(pid => pid !== currentPlan).map(pid => byNo.get(pid + '|' + nq) || [])) : [];
      box.innerHTML = `<p>لا توجد قطعة برقم <bdi dir="ltr" class="num">${esc(q)}</bdi> في ${scope}. تأكد من الرقم، أو جرّب الرقم مع /أ.</p>`;
      if (other.length) {
        box.insertAdjacentHTML('beforeend', `<p>الرقم نفسه مكتوب في ${other.length === 1 ? 'مخطط آخر' : 'مخططات أخرى'} — كل قطعة منفصلة:</p>`);
        other.forEach((f, i) => resultButton(f, i, true, box));
      }
      return;
    }
    if (hits.length === 1 && !rel.length) { select(hits[0], true); return; }
    const multiPlan = new Set(hits.map(f => f.properties.plan)).size > 1 || plans.length > 1;
    if (hits.length) {
      box.insertAdjacentHTML('beforeend', hits.length === 1 ? `<p>القطعة رقم <bdi dir="ltr" class="num">${esc(q)}</bdi>:</p>`
        : `<p>الرقم <bdi dir="ltr" class="num">${esc(q)}</bdi> مكتوب على ${hits.length === 2 ? 'قطعتين' : hits.length + ' قطع'}${multiPlan ? ' في ' + scope : ' في المخطط'}. اختر واحدة:</p>`);
      hits.forEach((f, i) => resultButton(f, i, multiPlan, box));
    }
    if (rel.length) {
      box.insertAdjacentHTML('beforeend', `<p>أرقام فرعية تبدأ أو تنتهي بالرقم <bdi dir="ltr" class="num">${esc(q)}</bdi>:</p>`);
      rel.forEach((f, i) => resultButton(f, i, multiPlan, box));
    }
  }
  $('btn-search').addEventListener('click', runSearch);
  $('search-label').addEventListener('click', e => { if (e.target.id === 'btn-scope') { currentPlan = null; setLevel(level); $('results').innerHTML = ''; } });
  const expandSearch = () => { clearSelection(false); $('panel').classList.remove('compact'); q = ''; render(); $('results').innerHTML = ''; $('panel').scrollTop = 0; };
  $('btn-again').addEventListener('click', expandSearch);
  $('q').addEventListener('click', () => { if ($('panel').classList.contains('compact')) expandSearch(); });
  window.addEventListener('keydown', e => {   // physical keyboard support (testing / non-touch)
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;   // v1.14: typing in an admin form
    if (document.body.classList.contains('modal-open')) return;
    if (/^[0-9]$/.test(e.key)) { if (q.length < 7 && !q.includes('/')) q += e.key; render(); }
    else if (e.key === 'Backspace') { q = q.slice(0, -1); render(); }
    else if (e.key === 'Enter') runSearch();
    else if (e.key === 'Escape') clearSelection(false);
  });

  /* ---------- idle reset for kiosk ---------- */
  let idleT;
  const bump = () => { clearTimeout(idleT); const admin = document.body.classList.contains('admin-mode');
    idleT = setTimeout(() => { q = ''; render(); $('results').innerHTML = ''; if (window.AridImagery) window.AridImagery.reset();
      if (window.AridLand) window.AridLand.onIdle(); if (window.AridAdmin) window.AridAdmin.onIdle(); go('riyadh'); }, admin ? 600000 : IDLE_MS); };   // v1.14: admin mode → 10 min, then back to view mode
  ['pointerdown', 'wheel', 'keydown'].forEach(ev => window.addEventListener(ev, bump, { passive: true }));
  bump();

  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, ms || 6000); }

  /* ---------- start ---------- */
  map.on('load', () => {
    /* v1.19: 54,000 parcels are indexed in the background after the first view is on screen (parcels only appear from zoom 13,
       so the Riyadh/district views do not need them); before, the whole start-up waited for this. */
    map.getSource('parcels').setData(PAR); map.getSource('review').setData(REVIEW_FC);
    /* v1.21: side-length labels are built from the base parcels once the first view is on screen */
    if (SIDES) setTimeout(() => { const b = SIDES.build([...BASE_UID.values()]); SIDE_BUILD = b; map.getSource('sides').setData(b.fc); }, 0);
    if (window.AridImagery) window.AridImagery.init({ map, toast, ZO, TS });   // map-type switch (separate imagery layer; parcels untouched)
    Promise.all([loadSales(), STORE ? STORE.ready.catch(() => null) : null]).then(([ok]) => {
      salesLoaded = ok;
      if (!ok) toast('تعذّر تحميل ملف حالة البيع data/sales_status.csv — تُعرض كل القطع "غير محددة".', 9000);
      mapReady = true;
      rebuildLive();   // base + admin store (also sets the hidden filters and the admin source)
      for (const f of byUid.values()) { if (f.properties.adm) continue; const st = statusOf(f), pr = priceInfo(f); if (st !== 'unknown' || pr) applyState(f.properties.uid); }
      map.on('styledata', () => applyHidden(true));
      renderDiag();
      if (window.AridLand) window.AridLand.init();
      if (window.AridAdmin) window.AridAdmin.init();
      window.__APP_READY = true;
      (function handleUrlAutoZoom() {
        try {
          const sp = new URLSearchParams(window.location.search);
          const rawPlan = (sp.get('plan') || '').trim();
          const rawPlot = (sp.get('plot') || sp.get('parcel') || '').trim();
          if (!rawPlan && !rawPlot) return;
          if (rawPlot) {
            const np = normNo(rawPlot);
            let hit = null;
            if (rawPlan) {
              const hits = byNo.get(rawPlan + '|' + np) || (byAlias && byAlias.get(rawPlan + '|' + np));
              if (hits && hits.length) hit = hits[0];
            }
            if (!hit) {
              for (const p of PLANS) {
                const hits = byNo.get(p.meta.id + '|' + np) || (byAlias && byAlias.get(p.meta.id + '|' + np));
                if (hits && hits.length) { hit = hits[0]; break; }
              }
            }
            if (!hit && byUid.has(rawPlot)) {
              hit = byUid.get(rawPlot);
            }
            if (hit) {
              select(hit, true);
              return;
            }
          }
          if (rawPlan) {
            const p = PLAN_BY_ID[rawPlan] || PLANS.find(x => x.meta && x.meta.aliases && x.meta.aliases.includes(rawPlan));
            if (p) {
              go('plan', p.meta.id);
            }
          }
        } catch (e) {
          console.warn('URL auto-zoom error:', e);
        }
      })();
    });
    setLevel('riyadh');
    $('lg-review').hidden = !REVIEW_FC.features.length;
  });
  // test hooks (used by the automated checks; harmless in production)
  /* ---------- staff diagnostics disabled in view-only mode ---------- */
  function reviewDiag() {
    return '';
  }
  function renderDiag() {
    if (!$('diag-body')) return;
  }
  // test hooks (used by the automated checks; harmless in production)
  window.__app = { get salesSource() { return salesSource; }, salesReport, map, go, byNo, byUid, sales, statusOf,
    /* v1.14 land management API (used by js/land_view.js and js/land_admin.js) */
    svcLabel, SVC_COLOR, BASE_UID, LIVE_BY_PLAN, PLAN_BY_ID, STATUS, CURRENCY, recOf, priceInfo, statusSource, notesOf, rebuildLive, applyState, geomArea, labelPoint, inGeom: inGeomP,
    get sideBuild() { return SIDE_BUILD; },
    normNo, esc, fmtMoney, fmtDate, toast, planLabel, srcOf, get selected() { return selected; }, get hidden() { return HIDDEN; },
    selectUid: (uid, fly) => { const f = byUid.get(uid); if (f) select(f, fly !== false); return !!f; }, refreshCard: () => { if (selected) { const f = byUid.get(selected.properties.uid); if (f) select(f, false, true); else clearSelection(false); } },
    clearSelection: () => clearSelection(false), PANEL_PAD, ZO, TS, get level() { return level; }, get currentPlan() { return currentPlan; },
    setSearchMode, get searchMode() { return searchMode; },
    search: (no) => { q = String(no); render(); runSearch(); return Array.from($('results').querySelectorAll('button')).length; },
    setScope: (pid) => { currentPlan = pid; setLevel(level); }, plans: PLANS.map(p => p.meta.id), reviewOf, reviewCount: REVIEW_FC.features.length, byAlias,
    select: (no, plan) => { const h = byNo.get((plan || currentPlan || PLANS[0].meta.id) + '|' + normNo(no)) || (byUid.get(no) ? [byUid.get(no)] : null); if (h) select(h[0], true); return !!h; } };
  } // start()
})();
