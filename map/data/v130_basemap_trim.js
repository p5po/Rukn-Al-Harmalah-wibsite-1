/* v1.30 TEST: Al-Nafud Road at Dirab Road (outside Arid). Since OpenStreetMap changeset 191457516 (2026-11-04), Al-Nafud no longer
   meets Dirab Road at grade: Dirab runs through a tunnel there, and both Al-Nafud carriageways end in a U-turn loop about 20 m
   short of Dirab Road. The older basemap still draws the two carriageways running on into Dirab Road, so this file shortens
   those two basemap lines to the U-turn loop. Each new end point is an OSM loop node that lies on the existing basemap line
   (within 0.5 m), so the shape is unchanged; only the ~20 m tips are removed. Every edit is matched by the feature's exact first/last point and
   point count; an unmatched feature is left as it is. Removing this file and its <script> tag restores the v1.29 basemap. */
window.V130_BASEMAP_TRIM = { version: 'v1.30-TEST', built: '2026-11-07', expected: 2, applied: 0, edits: [
  { layer: 'riyadh_roads', sig: [[46.6482, 24.522], [46.69235, 24.49811], 28], end: 'first', to: [46.648398, 24.52189], note: 'SE-bound start -> OSM node 14348770411' },
  { layer: 'riyadh_roads', sig: [[46.69255, 24.49828], [46.64829, 24.52218], 31], end: 'last', to: [46.648599, 24.522017], note: 'NW-bound end -> OSM node 14348653279' }
] };
(function () {
  var B = window.BASEMAP, P = window.V130_BASEMAP_TRIM; if (!B) return;
  var same = function (a, b) { return Math.abs(a[0] - b[0]) < 2e-6 && Math.abs(a[1] - b[1]) < 2e-6; };
  P.edits.forEach(function (e) {
    var L = B[e.layer]; if (!L || !L.features) return;
    for (var i = 0; i < L.features.length; i++) {
      var g = L.features[i] && L.features[i].geometry;
      if (!g || g.type !== 'LineString' || g.coordinates.length !== e.sig[2]) continue;
      var c = g.coordinates;
      if (!same(c[0], e.sig[0]) || !same(c[c.length - 1], e.sig[1])) continue;
      if (e.end === 'first') c[0] = e.to.slice(); else c[c.length - 1] = e.to.slice();
      P.applied++; return;
    }
  });
})();
