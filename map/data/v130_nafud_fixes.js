/* v1.30 TEST: Al-Nafud Road fixes, applied at load on top of data/v180_overlay.js (that file is unchanged).
   1) gap_fill — closes the two 21-25 m breaks where both carriageways cross the street at 46.7195 E, 24.4727 N.
      Each fill is one straight segment between the two existing OSM end nodes of that carriageway (no new points),
      so the road keeps its exact alignment.
   2) nw_osm_202611 — replaces 4 north-west map lines (all outside Arid) with the current OpenStreetMap geometry, which includes
      two edits by the same mapper: 2026-11-04 (cs 191457516: NW end at Dirab Rd) and 2026-11-06 (cs 191546765: NW-bound
      carriageway at 46.692-46.702 E). Both were checked against Esri/Vantor imagery of 2025-09 before being applied.
      Only the ways listed in `replace` change.
   3) dirab_link — adds the 4 OSM link roads of 2026-11-04 that now connect Al-Nafud to Dirab Road (drawn in the thin ramp style).
      The basemap tips that still ran into Dirab Road are shortened in data/v130_basemap_trim.js. Each replacement is matched by the line's OSM way id; an unmatched id is skipped.
   Removing this file and its <script> tag restores v1.29 exactly. */
window.V130_NAFUD = { version: 'v1.30-TEST', built: '2026-11-07', applied: { gap_fill: 0, replace: 0, dirab_links: 0 },
  gap_fill: [
    { dir: 'SE-bound', from_osm: 1572342099, to_osm: 1572342101, st: 'open', coordinates: [[46.719157, 24.472709], [46.719291, 24.472568]] },
    { dir: 'NW-bound', from_osm: 1572342100, to_osm: 1572342098, st: 'open', coordinates: [[46.719733, 24.472488], [46.719575, 24.472658]] }
  ],
  dirab_links_src: 'OpenStreetMap ways created in changeset 191457516 (2026-11-04); they join Al-Nafud to Dirab Road now that the at-grade junction is replaced by the Dirab tunnel. The bypass bridge into the SE-bound carriageway (trunk_link) is already in the basemap.',
  dirab_links: [{"osm":1575364472,"kind":"secondary (unnamed link road to Dirab Rd)","br":0,"c":[[46.65649,24.518186],[46.656397,24.518109],[46.656356,24.518091],[46.656267,24.518078],[46.656215,24.518073],[46.655328,24.518542],[46.65431,24.519083],[46.653543,24.519486],[46.653301,24.519623],[46.652811,24.519872],[46.652391,24.520101],[46.651865,24.520377],[46.651569,24.520544],[46.651156,24.520777],[46.650597,24.521053],[46.650039,24.521355],[46.64923,24.521774],[46.648621,24.522113],[46.648559,24.522177],[46.648512,24.522289],[46.648518,24.522399],[46.648685,24.522756],[46.648876,24.5233]]},{"osm":1575364473,"kind":"primary_link (link road -> Al-Nafud NW-bound)","br":0,"c":[[46.651569,24.520544],[46.650622,24.520952]]},{"osm":1575364474,"kind":"secondary_link (from Dirab Rd)","br":0,"c":[[46.648487,24.523958],[46.648441,24.52375],[46.648358,24.523554],[46.64832,24.523451],[46.648307,24.523389],[46.648326,24.523293]]},{"osm":1575364475,"kind":"secondary_link bridge","br":1,"c":[[46.648326,24.523293],[46.648347,24.523236],[46.648407,24.523186],[46.648488,24.523145],[46.648566,24.523129],[46.648766,24.523191],[46.648876,24.5233]]}],
  replace_src: 'OpenStreetMap API read 2026-11-07: changesets 191457516 (2026-11-04, NW end at Dirab Rd) and 191546765 (2026-11-06, NW-bound carriageway 46.692-46.702 E)',
  replace: {"157620752":[[46.648398,24.52189],[46.649057,24.521542],[46.651847,24.520052],[46.656156,24.517752],[46.656306,24.517678],[46.663139,24.514071],[46.664886,24.513149],[46.665078,24.513048],[46.665317,24.512922],[46.665395,24.51288],[46.665981,24.512569],[46.671693,24.50954],[46.672653,24.509032],[46.672867,24.508915],[46.673048,24.508817],[46.673987,24.508306],[46.67431,24.50813],[46.675282,24.507601],[46.676029,24.507223],[46.677138,24.506685],[46.677963,24.506326],[46.678527,24.506112],[46.678754,24.506027],[46.679504,24.505743],[46.68017,24.505507],[46.681778,24.504985],[46.682495,24.504752],[46.683214,24.504476],[46.685243,24.503569],[46.685942,24.5032],[46.68664,24.502788],[46.687411,24.502332],[46.687717,24.502144],[46.688057,24.501911],[46.689154,24.501145],[46.689284,24.501041],[46.689845,24.500592],[46.691173,24.499397],[46.692353,24.498109]],"332006946":[[46.692605,24.498416],[46.691761,24.499248],[46.691311,24.499674],[46.690013,24.500731],[46.688938,24.501567],[46.688171,24.5021],[46.687817,24.502292],[46.687568,24.502458],[46.687177,24.502706],[46.686817,24.502918],[46.686038,24.503371],[46.68536,24.503738],[46.684264,24.504291],[46.68398,24.50442],[46.683312,24.504689],[46.682585,24.504958],[46.682163,24.505105],[46.681034,24.505442],[46.679798,24.505856],[46.678681,24.506268],[46.678106,24.506514],[46.677281,24.506881],[46.676657,24.507183],[46.675193,24.507936],[46.674109,24.508507],[46.673336,24.508914],[46.672796,24.509199],[46.672217,24.509506],[46.671707,24.509776],[46.668189,24.511641],[46.666754,24.512376],[46.66606,24.512769],[46.665566,24.513031],[46.665252,24.513198],[46.665056,24.513301],[46.663721,24.513978],[46.662464,24.514675],[46.659232,24.516351],[46.657863,24.517066],[46.657355,24.51734],[46.656351,24.517874],[46.656241,24.517937],[46.653242,24.519563],[46.652442,24.519987],[46.650622,24.520952],[46.649415,24.521591],[46.649259,24.521674],[46.648599,24.522017],[46.648537,24.522045],[46.648484,24.522052],[46.648439,24.522043],[46.648398,24.522001],[46.648371,24.521951],[46.648398,24.52189]],"332006944":[[46.694302,24.49648],[46.692605,24.498416]],"1572342098":[[46.719575,24.472658],[46.714839,24.476954],[46.713247,24.478439],[46.712268,24.479258],[46.710682,24.480367],[46.70917,24.48144],[46.708631,24.481822],[46.708449,24.481958],[46.707362,24.482762],[46.705007,24.484532],[46.703635,24.485757],[46.702709,24.486696],[46.701678,24.48793],[46.700933,24.48876],[46.699952,24.489914],[46.697853,24.492377],[46.697195,24.493148],[46.696043,24.494474],[46.694302,24.49648]]}
};
(function () {
  var D = window.V180, P = window.V130_NAFUD; if (!D || !D.landmarks) return;
  var lm = null; D.landmarks.forEach(function (l) { if (l.id === 'nafud') lm = l; }); if (!lm || !lm.lines) return;
  Object.keys(P.replace).forEach(function (id) {
    lm.lines.forEach(function (f) {
      if (String(f.properties.osm) === id) { f.geometry = { type: 'LineString', coordinates: P.replace[id] }; f.properties.v130 = 'nw_osm_202611'; P.applied.replace++; }
    });
  });
  (P.dirab_links || []).forEach(function (k) {
    lm.lines.push({ type: 'Feature', properties: { st: 'open', br: k.br, osm: k.osm, rk: 'ramp', v130: 'dirab_link', src: 'osm_cs191457516' }, geometry: { type: 'LineString', coordinates: k.c } });
    P.applied.dirab_links++;
  });
  P.gap_fill.forEach(function (g) {
    lm.lines.push({ type: 'Feature', properties: { st: g.st, br: 0, osm: 0, v130: 'gap_fill', src: 'osm_end_nodes_' + g.from_osm + '_' + g.to_osm }, geometry: { type: 'LineString', coordinates: g.coordinates } });
    P.applied.gap_fill++;
  });
})();
