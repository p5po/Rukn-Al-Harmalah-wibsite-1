/* v1.25 TEST: the old alignment of the Second Southern Ring Road that crossed the Asala housing project is hidden.
   OpenStreetMap way 332006936 (an earlier single-carriageway sketch of the ring road) runs through the built houses of
   the Asala project; the road under construction follows the southern alignment (OSM ways 331473715 / 1485584867), which
   data/v180_overlay.js draws. Only this one basemap line and its one label are hidden; no other road is touched.
   Removing this file and its <script> tag restores v1.24. */
window.V125_ROAD_FIXES = { version: 'v1.25-TEST', built: '2026-11-02', hidden: 0, labels_hidden: 0 };
(function () {
  var B = window.BASEMAP; if (!B) return;
  var same = function (a, b) { return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9; };
  /* arid_detail: 'Second Ring Road' construction, 26 points, from [46.85059, 24.5466] to [46.62585, 24.49069] (= OSM 332006936) */
  if (B.arid_detail) {
    var out = [];
    B.arid_detail.features.forEach(function (f) {
      var g = f.geometry, p = f.properties || {};
      if (g && g.type === 'LineString' && p.n === 'Second Ring Road' && p.h === 'construction' && g.coordinates.length === 26 &&
          same(g.coordinates[0], [46.85059, 24.5466]) && same(g.coordinates[25], [46.62585, 24.49069])) { window.V125_ROAD_FIXES.hidden++; return; }
      out.push(f);
    });
    /* v1.27 r3: the basemap copy of the ring road on the old alignment (≈100 m south-east of the built corridor) — the ring is
       drawn by data/v180_overlay.js on the Suhail «الشباحة» corridor, which matches the satellite imagery */
    out = out.filter(function (f) {
      var g = f.geometry, p = f.properties || {}; if (!g || g.type !== 'LineString' || p.n !== 'Second Ring Road' || p.h !== 'construction') return true;
      var c = g.coordinates, a = c[0], z = c[c.length - 1];
      if ((same(a, [46.69628, 24.44737]) && same(z, [46.85059, 24.5466])) || (same(a, [46.8504, 24.54666]) && same(z, [46.69629, 24.44754]))) { window.V125_ROAD_FIXES.hidden++; return false; }
      return true;
    });
    B.arid_detail.features = out;
  }
  /* its label inside the Asala project */
  if (B.road_labels) {
    B.road_labels.features = B.road_labels.features.filter(function (f) {
      var p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
      if (p.n === 'Second Ring Road' && c && same(c, [46.74407, 24.49522])) { window.V125_ROAD_FIXES.labels_hidden++; return false; }
      return true;
    });
  }
})();
