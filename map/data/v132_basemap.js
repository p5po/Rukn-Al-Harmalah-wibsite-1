/* v1.32 TEST: basemap part of the Imam Muslim clean-up (see data/v132_interchanges.js). The OpenStreetMap basemap carries its own
   copy of the two doubled collector curves (ways 1473510267 / 1473510268, already cut by v1.28); both pieces of each are removed here
   so no faint line stays where the client circled. Matched by exact part end points; unmatched features are left as they are. */
window.V132_BM = { version: 'v1.32-TEST', applied: 0, drop: [{"i": 1675, "part": 0, "first": [46.76906, 24.47405], "last": [46.771365, 24.477743], "n": 8, "near": 1.0}, {"i": 1675, "part": 1, "first": [46.773326, 24.479427], "last": [46.77756, 24.48184], "n": 9, "near": 1.0}, {"i": 1676, "part": 0, "first": [46.77683, 24.48141], "last": [46.77316, 24.47943], "n": 8, "near": 1.0}, {"i": 1676, "part": 1, "first": [46.771363, 24.477878], "last": [46.76893, 24.47411], "n": 8, "near": 1.0}] };
(function () {
  var B = window.BASEMAP, P = window.V132_BM; if (!B || !B.arid_detail) return;
  var same = function (a, b) { return Math.abs(a[0] - b[0]) < 2e-6 && Math.abs(a[1] - b[1]) < 2e-6; };
  var F = B.arid_detail.features;
  for (var i = F.length - 1; i >= 0; i--) {
    var g = F[i] && F[i].geometry; if (!g || g.type !== 'MultiLineString') continue;
    var parts = g.coordinates, keep = [];
    parts.forEach(function (c, pi) {
      var hit = P.drop.some(function (d) { return d.part === pi && c.length === d.n && same(c[0], d.first) && same(c[c.length - 1], d.last); });
      if (hit) P.applied++; else keep.push(c);
    });
    if (keep.length === parts.length) continue;
    if (!keep.length) F.splice(i, 1);
    else if (keep.length === 1) F[i].geometry = { type: 'LineString', coordinates: keep[0] };
    else g.coordinates = keep;
  }
})();
