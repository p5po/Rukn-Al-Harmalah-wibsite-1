/* AridMap v1.27 — Planned Roads (شوارع مخططة).
   Approved streets from Suhail that are not drawn as existing roads (data/v127_planned_roads.js).
   - Own source and layers, drawn dashed in violet so they cannot be mistaken for existing roads.
   - Not part of the road network: no routing, no road statistics, no tap target.
   - Can be shown or hidden on their own (legend chip and «نوع الخريطة» panel); the choice is remembered on this screen. */
(function () {
  'use strict';
  const D = window.PLANNED_ROADS; if (!D || !D.data) return;
  const $ = id => document.getElementById(id);
  const KEY = 'aridmap.plannedRoads';
  const TS = Math.min(2.4, Math.max(0.85, Math.min(innerWidth, innerHeight) / 1080)), ZO = Math.log2(TS);
  const Z = z => z + ZO;
  const zi = (...st) => { const o = ['interpolate', ['linear'], ['zoom']]; for (let i = 0; i < st.length; i += 2) o.push(Z(st[i]), st[i + 1] * TS); return o; };
  let visible = true;
  try { const v = localStorage.getItem(KEY); if (v === '0') visible = false; } catch (e) { /* storage unavailable: default visible */ }
  let map = null;
  const LAYERS = ['planned-casing', 'planned-line'];

  function apply() {
    if (map) LAYERS.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'); });
    document.querySelectorAll('[data-planned-toggle]').forEach(b => { b.setAttribute('aria-pressed', String(visible)); b.classList.toggle('off', !visible); });
    const st = $('pl-state'); if (st) st.textContent = visible ? 'ظاهرة' : 'مخفية';
  }
  function set(v) { visible = !!v; try { localStorage.setItem(KEY, visible ? '1' : '0'); } catch (e) { /* ignore */ } apply(); }

  function addLayers() {
    if (map.getSource('planned')) return;
    map.addSource('planned', { type: 'geojson', data: D.data });
    const before = map.getLayer('plan-fill') ? 'plan-fill' : undefined;   // under the plans and parcels, like the other roads
    map.addLayer({ id: 'planned-casing', type: 'line', source: 'planned', minzoom: Z(11.5),
      layout: { 'line-cap': 'butt', 'line-join': 'round', visibility: visible ? 'visible' : 'none' },
      paint: { 'line-color': '#1a1720', 'line-opacity': 0.55, 'line-width': zi(11.5, 2.6, 14, 4, 17, 7) } }, before);
    map.addLayer({ id: 'planned-line', type: 'line', source: 'planned', minzoom: Z(11.5),
      layout: { 'line-cap': 'butt', 'line-join': 'round', visibility: visible ? 'visible' : 'none' },
      paint: { 'line-color': '#b794ff', 'line-dasharray': [2.2, 1.6], 'line-opacity': 0.95, 'line-width': zi(11.5, 1.1, 14, 1.8, 17, 3.2) } }, before);
  }

  function buildUI() {
    // legend chip (plan / parcel levels)
    const lg = $('legend');
    if (lg && !$('lg-planned')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'lg-planned'; b.className = 'lg-planned'; b.setAttribute('data-planned-toggle', '');
      b.title = 'شوارع مخططة ومعتمدة، وليست بالضرورة منفذة على أرض الواقع. اضغط للإظهار أو الإخفاء.';
      b.innerHTML = '<i class="sw s-planned" aria-hidden="true"></i>شوارع مخططة <small>(ليست بالضرورة منفذة)</small>';
      const unit = lg.querySelector('.lg-unit'); lg.insertBefore(b, unit || null);
      b.addEventListener('click', () => set(!visible));
    }
    // «نوع الخريطة» panel (all levels)
    const pop = $('mt-pop');
    if (pop && !$('pl-row')) {
      const row = document.createElement('button');
      row.type = 'button'; row.id = 'pl-row'; row.className = 'pl-row'; row.setAttribute('data-planned-toggle', '');
      row.innerHTML = '<span class="pl-sw" aria-hidden="true"></span><span class="pl-txt"><b>الشوارع المخططة</b><small>معتمدة، وليست بالضرورة منفذة — <span id="pl-state"></span></small></span>';
      const msg = $('mt-msg'); pop.insertBefore(row, msg || null);
      row.addEventListener('click', () => set(!visible));
    }
    apply();
  }

  function wait() {
    const a = window.__app; if (!a || !a.map) return setTimeout(wait, 120);
    map = a.map;
    const go = () => { try { addLayers(); buildUI(); } catch (e) { console.error('planned roads', e); } };
    if (map.isStyleLoaded() && map.getLayer('plan-fill')) go(); else map.once('idle', go);
    // the imagery switch rebuilds layers: re-add when the style changes
    map.on('styledata', () => { if (!map.getSource('planned') && map.isStyleLoaded()) { try { addLayers(); apply(); } catch (e) { /* retried on next styledata */ } } });
  }
  window.AridPlanned = { show: () => set(true), hide: () => set(false), get visible() { return visible; }, count: D.count, km: D.length_km };
  wait();
})();
