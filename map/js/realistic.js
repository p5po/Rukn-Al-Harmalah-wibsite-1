/* AridMap — «العرض الواقعي» (v0.5-dev)
   رسم توضيحي يشبه الصور الجوية، يُولَّد بالكامل داخل المتصفح من بيانات الخريطة الموجودة
   (طرق OSM، والأودية، وحدود المخطط، وأشكال القطع). لا يستخدم أي صور خارجية، ولا يتصل بالإنترنت،
   ولا يعدّل أي بيانات: كل الطبقات والأنماط المضافة تُحذف عند الخروج، وتُعاد قيم الطبقات الأصلية حرفيًا.
   ليس صورة حقيقية للأرض، ويُكتب ذلك للزائر على الشاشة. */
(function () {
  'use strict';
  const P = 'rl-';
  let added = [], images = [], sources = [], saved = [], texCache = null, missingHooked = false, dunesURL = null;   // textures are generated once and reused (faster switching)

  /* ---------- procedural, seamlessly tiling textures ---------- */
  function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  function periodicNoise(size, cells, rand) {
    const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rand();
    const out = new Float32Array(size * size), s = size / cells, sm = t => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
      const gy = y / s, y0 = Math.floor(gy), fy = sm(gy - y0), y1 = (y0 + 1) % cells;
      for (let x = 0; x < size; x++) {
        const gx = x / s, x0 = Math.floor(gx), fx = sm(gx - x0), x1 = (x0 + 1) % cells;
        const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
        out[y * size + x] = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
      }
    }
    return out;
  }
  function fbm(size, octaves, seed) {   // octaves: [[cells, weight], ...]
    const rand = rng(seed), acc = new Float32Array(size * size); let wsum = 0;
    for (const [cells, w] of octaves) { const n = periodicNoise(size, cells, rand); for (let i = 0; i < acc.length; i++) acc[i] += n[i] * w; wsum += w; }
    for (let i = 0; i < acc.length; i++) acc[i] /= wsum;
    return acc;
  }
  function texture(size, rgb, amp, octaves, grain, seed, speck) {
    const n = fbm(size, octaves, seed), r = rng(seed ^ 0x9e3779b9), img = new ImageData(size, size), d = img.data;
    for (let i = 0; i < size * size; i++) {
      const v = (n[i] - 0.5) * amp + (r() - 0.5) * grain;
      d[i * 4] = rgb[0] + v; d[i * 4 + 1] = rgb[1] + v * 0.94; d[i * 4 + 2] = rgb[2] + v * 0.85; d[i * 4 + 3] = 255;
    }
    // sparse stones / dry shrubs (dark) and pale gravel (light), 1–2 px, wrapped at the edges so the tile stays seamless
    const dots = Math.round(size * size * (speck || 0));
    for (let k = 0; k < dots; k++) {
      const x = Math.floor(r() * size), y = Math.floor(r() * size), dark = r() < 0.7, s = r() < 0.3 ? 2 : 1, dv = dark ? -(30 + r() * 30) : 18 + r() * 12;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
        const j = (((y + dy) % size) * size + ((x + dx) % size)) * 4;
        d[j] += dv; d[j + 1] += dv * 0.95; d[j + 2] += dv * 0.9;
      }
    }
    return img;
  }
  // broad tonal variation (dunes, gravel plains, darker wadi beds) as one stretched image over the map extent
  function dunesDataURL() {
    const S = 512, n = fbm(S, [[3, 1], [6, 0.7], [12, 0.45], [24, 0.25]], 7), c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
    for (let i = 0; i < S * S; i++) {
      const v = n[i] - 0.5;
      if (v < 0) { d[i * 4] = 112; d[i * 4 + 1] = 99; d[i * 4 + 2] = 76; d[i * 4 + 3] = Math.min(255, -v * 260); }   // darker gravel / shadowed ground
      else { d[i * 4] = 190; d[i * 4 + 1] = 176; d[i * 4 + 2] = 142; d[i * 4 + 3] = Math.min(255, v * 200); }      // lighter wind-blown sand
    }
    ctx.putImageData(img, 0, 0); return c.toDataURL('image/png');
  }

  /* ---------- helpers ---------- */
  function scaleW(e, k, add) {   // scale the output stops of a (possibly zoom-interpolated / match) width expression
    if (typeof e === 'number') return e * k + add;
    if (Array.isArray(e) && e[0] === 'interpolate') { const o = e.slice(0, 3); for (let i = 3; i < e.length; i += 2) o.push(e[i], scaleW(e[i + 1], k, add)); return o; }
    if (Array.isArray(e) && e[0] === 'match') return e.map((x, i) => (i >= 3 && (i % 2 === 1 || i === e.length - 1)) ? scaleW(x, k, add) : x);
    return e;
  }
  function addLayer(map, layer, before) { map.addLayer(layer, before && map.getLayer(before) ? before : undefined); added.push(layer.id); }
  function setPaint(map, l, k, v) { if (!map.getLayer(l)) return; saved.push([l, k, map.getPaintProperty(l, k)]); map.setPaintProperty(l, k, v); }

  const ASPHALT = '#45423e', TRACK = '#b8a385', CURB = '#c4b69c', DIRT = '#a8875c';

  function enter(map, opt) {
    const ZO = opt.ZO || 0, TS = opt.TS || 1;
    exit(map);
    // v1.13: ground tones matched to the satellite pack (median of the Arid 10 m tiles ≈ 159/147/114), so the hand-over at zoom 15–16 has no colour jump
    const tex = texCache || {
      sand: texture(256, [163, 150, 117], 34, [[4, 1], [8, 0.8], [16, 0.5], [64, 0.35]], 14, 11, 0.004),
      soil: texture(128, [176, 163, 130], 10, [[4, 1], [16, 0.6], [32, 0.4]], 8, 23, 0.0015),
      graded: texture(256, [156, 146, 122], 12, [[8, 1], [32, 0.5], [64, 0.4]], 9, 37, 0.002)
    };
    // patterns stay registered after leaving the mode (removing them while tiles are still parsing triggers warnings); they are invisible unless a layer uses them
    for (const k in tex) if (!map.hasImage(P + k)) map.addImage(P + k, tex[k], { pixelRatio: 2 });
    texCache = tex;
    if (!missingHooked) { missingHooked = true; map.on('styleimagemissing', e => { const k = String(e.id).slice(P.length); if (String(e.id).startsWith(P) && texCache && texCache[k] && !map.hasImage(e.id)) map.addImage(e.id, texCache[k], { pixelRatio: 2 }); }); }

    // ground
    addLayer(map, { id: P + 'ground', type: 'background', paint: { 'background-pattern': P + 'sand' } }, 'water');
    map.addSource(P + 'dunes', { type: 'image', url: (dunesURL = dunesURL || dunesDataURL()), coordinates: [[46.10, 25.20], [47.40, 25.20], [47.40, 24.15], [46.10, 24.15]] }); sources.push(P + 'dunes');
    addLayer(map, { id: P + 'dunes', type: 'raster', source: P + 'dunes', paint: { 'raster-opacity': 0.75, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, 'water');
    addLayer(map, { id: P + 'plan-ground', type: 'fill', source: 'outline', minzoom: 11.5 + ZO, paint: { 'fill-pattern': P + 'graded', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11.5 + ZO, 0, 13 + ZO, 1] } }, 'water');
    addLayer(map, { id: P + 'parcel-ground', type: 'fill', source: 'parcels', minzoom: 13 + ZO, paint: { 'fill-pattern': P + 'soil', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13 + ZO, 0, 14.5 + ZO, 1] } }, 'water');
    // wadi beds: wide soft darker band under the existing water line
    addLayer(map, { id: P + 'wadi', type: 'line', source: 'detail', filter: ['==', ['get', 'k'], 'water'], minzoom: 11 + ZO,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#8f7350', 'line-opacity': 0.45, 'line-blur': ['interpolate', ['linear'], ['zoom'], 11 + ZO, 2 * TS, 17 + ZO, 14 * TS],
               'line-width': ['interpolate', ['linear'], ['zoom'], 11 + ZO, 3 * TS, 17 + ZO, 30 * TS] } }, 'water');

    // roads: concrete curb/shoulder under each road layer, asphalt on top, lane marks on the main roads
    // paved roads (motorway/trunk, primary, OSM class 4 in the district) get a concrete shoulder; the rest are drawn as graded desert tracks
    const ROADS = [['roads-major', 1.32, 1.2, null], ['roads-primary', 1.3, 1, null], ['detail-roads', 1.3, 0.8, ['==', ['get', 'c'], 4]]];
    for (const [id, k, add, extra] of ROADS) {
      const L = map.getLayer(id); if (!L) continue;
      const lyr = map.getStyle().layers.find(x => x.id === id);
      addLayer(map, { id: P + 'curb-' + id, type: 'line', source: lyr.source, filter: extra ? ['all', lyr.filter, extra] : lyr.filter, minzoom: lyr.minzoom, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': CURB, 'line-width': scaleW(map.getPaintProperty(id, 'line-width'), k, add * TS) } }, id);
    }
    setPaint(map, 'roads-major', 'line-color', ASPHALT); setPaint(map, 'roads-primary', 'line-color', ASPHALT);
    setPaint(map, 'roads-minor', 'line-color', TRACK); setPaint(map, 'detail-roads', 'line-color', ['match', ['get', 'c'], 4, ASPHALT, TRACK]);
    setPaint(map, 'detail-construction', 'line-color', DIRT); setPaint(map, 'water', 'line-color', '#7a6448'); setPaint(map, 'water', 'line-opacity', 0.55);
    addLayer(map, { id: P + 'lanes', type: 'line', source: 'roads', filter: ['<=', ['get', 'c'], 2], minzoom: 14.5 + ZO,
      paint: { 'line-color': '#ece6d6', 'line-opacity': 0.8, 'line-dasharray': [4, 4], 'line-width': ['interpolate', ['linear'], ['zoom'], 14.5 + ZO, 0.5 * TS, 18 + ZO, 1.6 * TS] } }, 'plan-fill');
    addLayer(map, { id: P + 'lanes-detail', type: 'line', source: 'detail', filter: ['all', ['==', ['get', 'k'], 'road'], ['==', ['get', 'c'], 4]], minzoom: 15.5 + ZO,
      paint: { 'line-color': '#ece6d6', 'line-opacity': 0.7, 'line-dasharray': [4, 4], 'line-width': ['interpolate', ['linear'], ['zoom'], 15.5 + ZO, 0.5 * TS, 18 + ZO, 1.3 * TS] } }, 'plan-fill');

    // overlays stay legible: survey-style plot lines, dark label halos
    const HALO = 'rgba(14,12,10,0.95)';
    setPaint(map, 'parcel-line', 'line-color', '#fbf3df'); setPaint(map, 'parcel-line', 'line-opacity', ['interpolate', ['linear'], ['zoom'], 13 + ZO, 0.4, 16 + ZO, 0.9]);
    setPaint(map, 'plan-line', 'line-color', '#f3d68c');
    for (const l of ['road-names', 'place-names', 'parcel-no']) setPaint(map, l, 'text-halo-color', HALO);
    setPaint(map, 'parcel-no', 'text-color', '#fffaf0'); setPaint(map, 'road-names', 'text-color', '#f4ecdc'); setPaint(map, 'place-names', 'text-color', '#f1e6d2');
  }

  function exit(map) {
    for (const id of added.reverse()) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of sources) if (map.getSource(id)) map.removeSource(id);
    for (const [l, k, v] of saved.reverse()) if (map.getLayer(l)) map.setPaintProperty(l, k, v);
    added = []; sources = []; images = []; saved = [];
  }

  window.AridRealistic = { enter, exit, get active() { return added.length > 0; } };
})();
