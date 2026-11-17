/* v1.21 TEST: side lengths next to each side of every parcel.
   Data: data/side_lengths.js (Suhail length_m, already bound to a side of the displayed polygon and verified — see docs).
   This file only turns those records into map label points; it never changes parcel data.
   Each label sits at the middle of its side, turned along the side and pushed just inside the parcel, so a shared boundary
   carries each neighbour's value on its own side of the line. A label appears from the zoom at which its side is long enough
   on screen to hold the text (bucket "z"); the selected parcel always shows all of its lengths. */
(function () {
  'use strict';
  const D = window.SIDE_LENGTHS || null;
  const DG = window.SIDE_LENGTHS_GEOM || null;     // v1.22: lengths COMPUTED from the boundary (sides with no verified Suhail length) — kept apart
  const COLOR = { s: '#d9caa5', g: '#8fc6d8' };     // Suhail: warm sand · computed: cool blue
  const R = 6378137, RAD = Math.PI / 180, CIRC = 40075016.686;
  const FS = 11;                                   // base text size (px) — the map scales it with the screen like the other labels
  const BUCKETS = [17, 17.5, 18, 18.5, 19, 19.5];  // zoom steps; a label needing more than the max zoom is shown only when its parcel is selected
  const merc = c => [R * c[0] * RAD, R * Math.log(Math.tan(Math.PI / 4 + c[1] * RAD / 2))];
  const unmerc = p => [p[0] / R / RAD, (2 * Math.atan(Math.exp(p[1] / R)) - Math.PI / 2) / RAD];
  function ringsOf(g) { return g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? [].concat(...g.coordinates) : []; }
  function inRing(pt, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; }
  function inGeom(pt, g) { const ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; return ps.some(p => inRing(pt, p[0]) && !p.slice(1).some(h => inRing(pt, h))); }
  const fmt = cm => (cm / 100).toFixed(2);                        // Suhail value, exactly as published (cm)
  const fmtG = mm => mm < 1000 ? '≈ ' + Math.floor(mm / 10 + 0.5) + ' سم'      // v1.23: computed side shorter than 1 m → approximate centimetres
                              : (Math.floor(mm / 100 + 0.5) / 10).toFixed(1);   // computed (stored in mm): shown to 0.1 m, half up (outline coordinates are quantised to ~0.14 m)
  /* text angle (screen, upright), inward side and first zoom for a label at point mid on the boundary piece a→b (Mercator) */
  function place(g, mid, a, b, roomMerc, txt) {
    const dx = b[0] - a[0], dy = -(b[1] - a[1]);
    let ang = Math.atan2(dy, dx) / RAD; if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
    const lat = unmerc(mid)[1], k = 1 / Math.cos(lat * RAD), cl = Math.hypot(dx, dy) || 1;
    const nx = -dy / cl, ny = dx / cl;
    const probe = unmerc([mid[0] + nx * 0.5 * k, mid[1] - ny * 0.5 * k]);
    const nIn = inGeom(probe, g) ? [nx, ny] : [-nx, -ny];
    const th = ang * RAD, down = [-Math.sin(th), Math.cos(th)];
    const s = (nIn[0] * down[0] + nIn[1] * down[1]) >= 0 ? 1 : -1;
    const metres = roomMerc / k, wpx = 0.6 * FS * txt.length + 8 + 2 * 1.2 * FS;
    const zNeed = Math.log2(wpx * CIRC * Math.cos(lat * RAD) / (512 * metres));
    let z = 99; for (const bz of BUCKETS) if (zNeed <= bz) { z = bz; break; }
    return { r: Math.round(ang * 10) / 10, s, z };
  }
  /* v1.23: Suhail lengths shown at Suhail's own point on the drawn boundary ("ring.edge.fraction×10000.cm") */
  function labelsAtPoints(f, rec) {
    const g = f.geometry, rings = ringsOf(g), out = [];
    for (const it of rec.split('|')) {
      const [ri, e, t4, cm] = it.split('.').map(Number); const ring = rings[ri]; if (!ring) return null;
      const n = ring.length - 1; if (e >= n) return null;
      const a = merc(ring[e]), b = merc(ring[(e + 1) % n]), t = t4 / 10000;
      const mid = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const lat = unmerc(mid)[1], txt = fmt(cm);
      const P = place(g, mid, a, b, (cm / 100) / Math.cos(lat * RAD), txt);
      out.push({ type: 'Feature', properties: { uid: f.properties.uid, k: 's', q: 1, t: txt, r: P.r, s: P.s, z: P.z }, geometry: { type: 'Point', coordinates: unmerc(mid).map(v => Math.round(v * 1e7) / 1e7) } });
    }
    return out;
  }
  /* one parcel → its label features (null if the geometry no longer has the recorded vertices) */
  function labelsFor(f, rec, kind) {
    kind = kind || 's'; const F = kind === 'g' ? fmtG : fmt;
    const g = f.geometry, rings = ringsOf(g), out = [];
    for (const it of rec.split('|')) {
      const [ri, i, j, cm] = it.split('.').map(Number); const ring = rings[ri]; if (!ring) return null;
      const n = ring.length - 1; if (i >= n || j >= n) return null;
      const pts = []; for (let t = i; ; t = (t + 1) % n) { pts.push(merc(ring[t])); if (t === j) break; if (pts.length > n + 1) return null; }
      // middle of the side, measured along the side (Mercator distances; the factor is constant over one side)
      let L = 0; const seg = []; for (let t = 0; t < pts.length - 1; t++) { const s = Math.hypot(pts[t + 1][0] - pts[t][0], pts[t + 1][1] - pts[t][1]); seg.push(s); L += s; }
      let half = L / 2, mid = pts[0], ms = 0;
      for (let t = 0; t < seg.length; t++) { if (half <= seg[t]) { const k = seg[t] ? half / seg[t] : 0; mid = [pts[t][0] + k * (pts[t + 1][0] - pts[t][0]), pts[t][1] + k * (pts[t + 1][1] - pts[t][1])]; ms = t; break; } half -= seg[t]; }
      // the text follows the boundary piece it sits on (a side may bend slightly between its two corners)
      const a = pts[ms], b = pts[ms + 1] || pts[pts.length - 1];
      const dx = b[0] - a[0], dy = -(b[1] - a[1]);            // screen frame: y down
      let ang = Math.atan2(dy, dx) / RAD; if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
      // which side of the line is inside the parcel? (test a point 0.5 m off the middle, in metres → Mercator units)
      const lat = unmerc(mid)[1], k = 1 / Math.cos(lat * RAD), cl = Math.hypot(dx, dy) || 1;
      const nx = -dy / cl, ny = dx / cl;                       // a unit normal in the screen frame
      const pd = kind === 'g' ? Math.min(0.5, 0.3 * L / k) : 0.5;   // v1.23: a short computed side is probed closer, so the probe stays in front of it
      const probe = unmerc([mid[0] + nx * pd * k, mid[1] - ny * pd * k]);
      const nIn = inGeom(probe, g) ? [nx, ny] : [-nx, -ny];
      const th = ang * RAD, down = [-Math.sin(th), Math.cos(th)]; // the text's "down" direction on screen
      const s = (nIn[0] * down[0] + nIn[1] * down[1]) >= 0 ? 1 : -1;
      // first zoom at which the side (straight length on screen) holds the text plus one text height clear of each corner,
      // so the lengths of two sides meeting at a corner cannot touch
      // room for the text: the whole side when it is straight; on a side that bends, only the piece the text sits on
      let bent = false;
      for (let t = 1; t < pts.length - 1; t++) { const u1 = Math.atan2(pts[t][1] - pts[t - 1][1], pts[t][0] - pts[t - 1][0]), u2 = Math.atan2(pts[t + 1][1] - pts[t][1], pts[t + 1][0] - pts[t][0]);
        let tr = Math.abs(u2 - u1) / RAD % 360; if (tr > 180) tr = 360 - tr; if (tr > 3) bent = true; }
      const room = bent ? 2 * Math.min(Math.hypot(mid[0] - a[0], mid[1] - a[1]), Math.hypot(mid[0] - b[0], mid[1] - b[1]))
                        : Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]);
      const txt = F(cm), metres = (room / k), wpx = 0.6 * FS * txt.length + 8 + 2 * 1.2 * FS;
      const zNeed = Math.log2(wpx * CIRC * Math.cos(lat * RAD) / (512 * metres));
      let z = 99; for (const bz of BUCKETS) if (zNeed <= bz) { z = bz; break; }
      if (kind === 'g' && cm < 1000 && z === 99) z = 0;   // v1.23: sub-metre computed sides: their own layer from zoom 18.5, shown wherever there is room
      out.push({ type: 'Feature', properties: { uid: f.properties.uid, k: kind, t: txt, r: Math.round(ang * 10) / 10, s, z }, geometry: { type: 'Point', coordinates: unmerc(mid).map(v => Math.round(v * 1e7) / 1e7) } });
    }
    return out;
  }
  /* v1.24: Suhail lengths that do not agree with the drawn outline, written where Suhail writes them ("lonE7.latE7.az×10.cm").
     Suhail's azimuth is measured in degree space (no cos-latitude factor); it is turned into the on-screen angle here. */
  function labelsAtSuhail(f, rec) {
    const g = f.geometry, out = [];
    for (const it of rec.split('|')) {
      const [lo, la, az10, cm] = it.split('.').map(Number);
      const pt = [lo / 1e7, la / 1e7], mid = merc(pt), lat = pt[1], c = Math.cos(lat * RAD), b = az10 / 10 * RAD;
      const north = Math.atan2(Math.sin(b), Math.cos(b) / c);            // angle from north on the (Mercator) map
      let ang = north / RAD - 90; while (ang > 90) ang -= 180; while (ang <= -90) ang += 180;
      const th = ang * RAD, down = [-Math.sin(th), Math.cos(th)], k = 1 / c;
      const inside = d => inGeom(unmerc([mid[0] + down[0] * d * 0.5 * k, mid[1] - down[1] * d * 0.5 * k]), g);
      let s = inside(1) ? 1 : inside(-1) ? -1 : 0;
      if (!s) { // point off the outline: push the text toward the parcel
        const ring = ringsOf(g)[0]; let cx = 0, cy = 0; for (const q of ring) { const m = merc(q); cx += m[0]; cy += m[1]; } cx /= ring.length; cy /= ring.length;
        s = ((cx - mid[0]) * down[0] - (cy - mid[1]) * down[1]) >= 0 ? 1 : -1; }
      const txt = fmt(cm), metres = cm / 100, wpx = 0.6 * FS * txt.length + 8 + 2 * 1.2 * FS;
      const zNeed = Math.log2(wpx * CIRC * c / (512 * Math.max(metres, 0.01)));
      let z = 99; for (const bz of BUCKETS) if (zNeed <= bz) { z = bz; break; }
      out.push({ type: 'Feature', properties: { uid: f.properties.uid, k: 's', x: 1, t: txt, r: Math.round(ang * 10) / 10, s, z }, geometry: { type: 'Point', coordinates: pt } });
    }
    return out;
  }
  function build(baseFeatures) {
    const fc = { type: 'FeatureCollection', features: [] }, bad = [];
    let nG = 0;
    for (const [DS, kind] of [[D, 's'], [DG, 'g']]) {
      if (!DS || !DS.p) continue;
      for (const f of baseFeatures) {
        const rec = DS.p[f.properties.uid]; if (!rec) continue;
        const ls = labelsFor(f, rec, kind); if (!ls) { bad.push(kind + ':' + f.properties.uid); continue; }
        for (const x of ls) fc.features.push(x);
        if (kind === 'g') nG += ls.length;
      }
    }
    let nQ = 0;
    if (D && D.q) for (const f of baseFeatures) {
      const rec = D.q[f.properties.uid]; if (!rec) continue;
      const ls = labelsAtPoints(f, rec); if (!ls) { bad.push('q:' + f.properties.uid); continue; }
      for (const x of ls) fc.features.push(x); nQ += ls.length;
    }
    let nX = 0;
    if (D && D.x) for (const f of baseFeatures) {
      const rec = D.x[f.properties.uid]; if (!rec) continue;
      for (const x of labelsAtSuhail(f, rec)) { fc.features.push(x); nX++; }
    }
    return { fc, bad, count: fc.features.length, computed: nG, atSuhailPoint: nQ, framed: nX };
  }
  /* values for the parcel card, in the order of the parcel's outline */
  function listFor(uid) { const out = [];
    for (const rec of [D && D.p && D.p[uid], D && D.q && D.q[uid], D && D.x && D.x[uid]]) if (rec) for (const it of rec.split('|')) out.push(fmt(Number(it.split('.')[3])));
    return out; }
  function listForGeom(uid) { const rec = DG && DG.p && DG.p[uid]; return rec ? rec.split('|').map(it => fmtG(Number(it.split('.')[3]))) : []; }
  /* map layers: one per zoom step (label hidden until its side can hold it) + the selected parcel (always all of its labels) */
  function layers() {
    const common = {
      'text-field': ['concat', '‎', ['get', 't']], 'text-font': ['Plex Arabic Medium'], 'text-size': FS,
      'text-rotate': ['get', 'r'], 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'map',
      'text-offset': ['case', ['==', ['get', 's'], 1], ['literal', [0, 0.75]], ['literal', [0, -0.75]]],
      'text-padding': 1, 'text-letter-spacing': 0.02
    };
    const paint = k => ({ 'text-color': COLOR[k], 'text-halo-color': 'rgba(24,23,21,0.95)', 'text-halo-width': 1.4 });
    /* side lengths never block each other (each sits inside its own parcel by its own side — see the zoom rule above),
       but they give way to parcel numbers, areas and road names */
    const L = [];
    for (const [k, pre] of [['g', 'side-geo-'], ['s', 'side-len-']]) for (const bz of BUCKETS)
      L.push({ id: pre + String(bz).replace('.', '_'), type: 'symbol', source: 'sides', minzoom: bz,
        filter: ['all', ['==', ['get', 'k'], k], ['==', ['get', 'z'], bz], ['!', ['has', 'x']]], layout: Object.assign({}, common, { 'text-ignore-placement': true }), paint: paint(k) });
    /* v1.24: Suhail lengths written at Suhail's own point (they do not agree with the drawn outline) — thin frame */
    const frame = { 'icon-image': 'len-frame', 'icon-text-fit': 'both', 'icon-text-fit-padding': [1, 3, 1, 3], 'icon-rotate': ['get', 'r'],
      'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map' };
    for (const bz of BUCKETS)
      L.push({ id: 'side-sx-' + String(bz).replace('.', '_'), type: 'symbol', source: 'sides', minzoom: bz, filter: ['all', ['has', 'x'], ['==', ['get', 'z'], bz]],
        layout: Object.assign({}, common, frame, { 'text-ignore-placement': true, 'icon-ignore-placement': true }), paint: paint('s') });
    /* v1.23: computed sides shorter than 1 m — only where there is free room (they give way to everything, including each other) */
    L.push({ id: 'side-geo-cm', type: 'symbol', source: 'sides', minzoom: 18.5, filter: ['all', ['==', ['get', 'k'], 'g'], ['==', ['get', 'z'], 0]],
      layout: Object.assign({}, common, { 'text-size': FS - 1 }), paint: paint('g') });
    const sel = { id: 'side-sel', type: 'symbol', source: 'sides', minzoom: 13, filter: ['==', ['get', 'uid'], ''],   // (framed ones too; no frame on selection)
      layout: Object.assign({}, common, { 'text-allow-overlap': true, 'text-ignore-placement': true }),
      paint: Object.assign(paint('s'), { 'text-color': ['case', ['==', ['get', 'k'], 'g'], '#b5e0ee', '#fff1cc'] }) };
    return { buckets: L, sel };
  }
  window.AridSides = { labelsAtSuhail, build, listFor, listForGeom, layers, labelsFor, labelsAtPoints, BUCKETS, data: D, dataGeom: DG, COLOR };
})();
