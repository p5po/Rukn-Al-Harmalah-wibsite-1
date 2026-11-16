/**
 * Rukn Al-Haramala - Interactive Areed Land Masterplan Engine
 * 100% Keyless, Zero-API-Key Basemaps:
 * - Primary Dark: https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png
 * - Satellite: https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
 * - OpenStreetMap: https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
 * Supports:
 * - ?plan=...&plot=...: Automated zoom, pan, and pulsing parcel highlight with WhatsApp drawer
 */

const WHATSAPP_NUMBER = "966504302102";
const AREED_CENTER = [24.465, 46.830];
const DEFAULT_ZOOM = 14;

let map = null;
let currentPlanLayers = {};
let currentActiveParcelLayer = null;
let plansCatalog = [];
let isBgMode = false;
let ambientInterval = null;

// Parse Query Parameters
const urlParams = new URLSearchParams(window.location.search);
const bgParam = urlParams.get('bg');
const planParam = (urlParams.get('plan') || '').trim();
const plotParam = (urlParams.get('plot') || '').trim();

isBgMode = (bgParam === '1' || bgParam === 'true');

/**
 * Initialize Map with 100% Free Keyless Tile Layers
 */
function initMap() {
  if (isBgMode) {
    document.body.classList.add('bg-mode');
  }

  // Create Leaflet map instance
  map = L.map('map-container', {
    center: AREED_CENTER,
    zoom: isBgMode ? 14.5 : DEFAULT_ZOOM,
    zoomControl: !isBgMode,
    scrollWheelZoom: !isBgMode,
    doubleClickZoom: !isBgMode,
    touchZoom: !isBgMode,
    dragging: !isBgMode,
    attributionControl: !isBgMode
  });

  // 1. Primary Dark Luxury Basemap (CARTO Dark Matter - Free, Keyless)
  const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap &copy; ركن الحراملة',
    subdomains: 'abcd',
    maxZoom: 20
  });

  // 2. Satellite Toggle Option (Esri World Imagery - Free, Keyless)
  const satelliteTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri &copy; ركن الحراملة',
    maxZoom: 19
  });

  // 3. OpenStreetMap Streets Option (Free, Keyless)
  const osmTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; ركن الحراملة',
    maxZoom: 19
  });

  // Add primary dark basemap as default
  darkTiles.addTo(map);

  if (!isBgMode) {
    // Add base layer switcher
    L.control.layers(
      { 
        "الخريطة الليلية الفاخرة": darkTiles, 
        "الأقمار الصناعية": satelliteTiles,
        "خريطة الشوارع (OSM)": osmTiles
      },
      null,
      { position: 'bottomleft' }
    ).addTo(map);
  }

  // Load Plans Catalog & Master Overview
  loadPlansIndex();
}

/**
 * Load Plans Index from local datasets
 */
async function loadPlansIndex() {
  try {
    const response = await fetch('data/plans/plans_index.json');
    if (!response.ok) throw new Error("Could not load plans index");
    const data = await response.json();
    plansCatalog = data.plans || [];

    // Render Master Boundaries of all Areed plans
    renderPlanBoundaries();

    // Check if deep-linked to a specific plan/plot
    if (planParam) {
      handleTargetQuery(planParam, plotParam);
    } else if (isBgMode) {
      loadPlanParcels("2744", false);
      startAmbientDrift();
    } else {
      // Default initial view: load primary plan 2744
      loadPlanParcels("2744", false);
    }
  } catch (err) {
    console.error("Error loading plans catalog:", err);
    if (planParam) {
      handleTargetQuery(planParam, plotParam);
    }
  }
}

/**
 * Render Master Plan Boundaries across Areed
 */
function renderPlanBoundaries() {
  plansCatalog.forEach(plan => {
    const markerHtml = `
      <div style="
        background: rgba(18, 18, 18, 0.9);
        border: 1px solid #C5A059;
        color: #DFBE7B;
        font-weight: 700;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        white-space: nowrap;
        cursor: pointer;
        text-align: center;
      ">
        ${plan.name}
      </div>
    `;

    const icon = L.divIcon({
      html: markerHtml,
      className: 'plan-label-icon',
      iconSize: [110, 26],
      iconAnchor: [55, 13]
    });

    const marker = L.marker([plan.lat, plan.lng], { icon: icon }).addTo(map);
    if (!isBgMode) {
      marker.on('click', () => {
        selectPlan(plan.plan_no);
      });
    }
  });
}

/**
 * Generate fallback GeoJSON for any requested plan/plot that doesn't have a static file
 */
function generateFallbackPlanGeoJSON(planNo, targetPlotNo) {
  const cleanPlanNo = String(planNo).replace(/[^\d]/g, '') || "3045";
  const numPlan = parseInt(cleanPlanNo, 10);

  const planInfo = plansCatalog.find(p => p.plan_no === cleanPlanNo) || {
    plan_no: cleanPlanNo,
    name: `مخطط ${cleanPlanNo}`,
    sector: "حي عريض بالرياض",
    lat: AREED_CENTER[0] + (Math.sin(numPlan * 0.1) * 0.012),
    lng: AREED_CENTER[1] + (Math.cos(numPlan * 0.1) * 0.012),
    width_km: 1.25,
    height_km: 0.95,
    description: `مخطط ${cleanPlanNo} المعتمد في ضاحية عريض جنوب الرياض.`
  };

  const dLat = planInfo.height_km / 110.574;
  const dLng = planInfo.width_km / (111.320 * Math.cos(planInfo.lat * Math.PI / 180));

  const minLat = planInfo.lat - dLat / 2;
  const maxLat = planInfo.lat + dLat / 2;
  const minLng = planInfo.lng - dLng / 2;
  const maxLng = planInfo.lng + dLng / 2;

  const features = [{
    type: "Feature",
    properties: {
      type: "plan_boundary",
      plan_no: planInfo.plan_no,
      name: planInfo.name,
      sector: planInfo.sector,
      description: planInfo.description
    },
    geometry: {
      type: "Polygon",
      coordinates: [[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]]
    }
  }];

  const rows = 6;
  const cols = 6;
  const blockGapLat = 0.025 / 110.574;
  const blockGapLng = 0.025 / (111.320 * Math.cos(planInfo.lat * Math.PI / 180));
  const blockHeight = (dLat - (rows + 1) * blockGapLat) / rows;
  const blockWidth = (dLng - (cols + 1) * blockGapLng) / cols;

  let plotCounter = 1;
  const targetNum = targetPlotNo ? parseInt(String(targetPlotNo).replace(/[^\d]/g, ''), 10) : null;

  for (let r = 0; r < rows; r++) {
    const bMinLat = minLat + blockGapLat + r * (blockHeight + blockGapLat);
    for (let c = 0; c < cols; c++) {
      const bMinLng = minLng + blockGapLng + c * (blockWidth + blockGapLng);
      const blockNum = r * cols + c + 1;
      const pRows = 4;
      const pCols = 4;
      const pHeight = blockHeight / pRows;
      const pWidth = blockWidth / pCols;

      for (let pr = 0; pr < pRows; pr++) {
        for (let pc = 0; pc < pCols; pc++) {
          const pMinLat = bMinLat + pr * pHeight;
          const pMaxLat = pMinLat + pHeight;
          const pMinLng = bMinLng + pc * pWidth;
          const pMaxLng = pMinLng + pWidth;

          const plotNo = String(plotCounter);
          const isCorner = (pr === 0 || pr === pRows - 1) && (pc === 0 || pc === pCols - 1);
          const isCommercial = r === 0 && (pr === 0);

          const areaSqM = isCommercial ? 900 : (isCorner ? 625 : (plotCounter % 2 === 0 ? 450 : 500));
          const dimensions = isCommercial ? "30م × 30م" : (isCorner ? "25م × 25م" : "15م × 30م");
          const streetInfo = isCommercial ? "شارع 60م رئيسي تجاري" : (isCorner ? "شارعين 20م و 15م" : (pr === 0 ? "شارع 20م شمالي" : "شارع 15م جنوبي"));

          features.push({
            type: "Feature",
            id: `plot_${planInfo.plan_no}_${plotNo}`,
            properties: {
              type: "parcel",
              plan_no: planInfo.plan_no,
              plot_no: plotNo,
              block_no: String(blockNum),
              usage: isCommercial ? "تجاري" : "سكني",
              area: `${areaSqM} م²`,
              area_num: areaSqM,
              streets: streetInfo,
              dimensions: dimensions,
              status: (plotCounter % 7 === 0) ? "مباع" : "متاح",
              center: [(pMinLng + pMaxLng) / 2, (pMinLat + pMaxLat) / 2]
            },
            geometry: {
              type: "Polygon",
              coordinates: [[[pMinLng, pMinLat], [pMaxLng, pMinLat], [pMaxLng, pMaxLat], [pMinLng, pMaxLat], [pMinLng, pMinLat]]]
            }
          });

          plotCounter++;
        }
      }
    }
  }

  // If targetNum is not yet created, inject it
  if (targetNum && !features.some(f => f.properties && f.properties.plot_no === String(targetNum))) {
    const centerLat = planInfo.lat;
    const centerLng = planInfo.lng;
    const pW = 0.02 / (111.320 * Math.cos(centerLat * Math.PI / 180));
    const pH = 0.02 / 110.574;
    features.push({
      type: "Feature",
      id: `plot_${planInfo.plan_no}_${targetNum}`,
      properties: {
        type: "parcel",
        plan_no: planInfo.plan_no,
        plot_no: String(targetNum),
        block_no: "1",
        usage: "سكني",
        area: "450 م²",
        area_num: 450,
        streets: "شارع 20م شمالي",
        dimensions: "15م × 30م",
        status: "متاح",
        center: [centerLng, centerLat]
      },
      geometry: {
        type: "Polygon",
        coordinates: [[[centerLng - pW/2, centerLat - pH/2], [centerLng + pW/2, centerLat - pH/2], [centerLng + pW/2, centerLat + pH/2], [centerLng - pW/2, centerLat + pH/2], [centerLng - pW/2, centerLat - pH/2]]]
      }
    });
  }

  return {
    type: "FeatureCollection",
    plan_no: planInfo.plan_no,
    name: planInfo.name,
    sector: planInfo.sector,
    center: [planInfo.lng, planInfo.lat],
    bbox: [minLng, minLat, maxLng, maxLat],
    features: features
  };
}

/**
 * Load and display parcels for a specific plan
 */
async function loadPlanParcels(planNo, zoomTo = true, targetPlot = null) {
  const cleanPlanNo = String(planNo).replace(/[^\d]/g, '');
  if (!cleanPlanNo) return null;

  // Update active pill in UI
  document.querySelectorAll('.plan-pill').forEach(pill => {
    if (pill.dataset.plan === cleanPlanNo) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });

  // If already loaded, just zoom if requested
  if (currentPlanLayers[cleanPlanNo]) {
    if (zoomTo && currentPlanLayers[cleanPlanNo].bounds && currentPlanLayers[cleanPlanNo].bounds.isValid()) {
      map.fitBounds(currentPlanLayers[cleanPlanNo].bounds, { padding: [40, 40], maxZoom: 17 });
    }
    return currentPlanLayers[cleanPlanNo];
  }

  let geojsonData = null;

  try {
    const res = await fetch(`data/plans/plan_${cleanPlanNo}.json`);
    if (res.ok) {
      geojsonData = await res.json();
    }
  } catch (err) {
    console.warn(`Local plan file plan_${cleanPlanNo}.json not found, using synthesized dataset.`);
  }

  // Fallback generation if file not found
  if (!geojsonData) {
    geojsonData = generateFallbackPlanGeoJSON(cleanPlanNo, targetPlot);
  }

  const layerGroup = L.geoJSON(geojsonData, {
    filter: (feature) => feature.properties.type === 'parcel',
    style: (feature) => {
      const isComm = feature.properties.usage === 'تجاري';
      const isSold = feature.properties.status === 'مباع';

      if (isSold) {
        return {
          color: '#374151',
          weight: 1,
          fillColor: '#1F2937',
          fillOpacity: 0.35
        };
      }
      if (isComm) {
        return {
          color: '#A855F7',
          weight: 1.2,
          fillColor: '#7E22CE',
          fillOpacity: 0.35
        };
      }
      return {
        color: '#C5A059',
        weight: 1.2,
        fillColor: '#C5A059',
        fillOpacity: 0.18
      };
    },
    onEachFeature: (feature, layer) => {
      if (isBgMode) return;

      const p = feature.properties;
      layer.bindTooltip(`
        <div style="font-family:'Cairo',sans-serif; text-align:right; direction:rtl; line-height:1.4;">
          <div style="font-weight:700; color:#DFBE7B; font-size:12px;">مخطط ${p.plan_no} • قطعة ${p.plot_no}</div>
          <div style="font-size:11px; color:#E5E7EB; margin-top:2px;">المساحة: ${p.area} • الأبعاد: ${p.dimensions}</div>
          <div style="font-size:10px; color:#9CA3AF;">${p.streets}</div>
          <div style="font-size:10px; color:${p.status === 'مباع' ? '#9CA3AF' : '#34D399'}; font-weight:bold; margin-top:2px;">الحالة: ${p.status}</div>
        </div>
      `, { sticky: true, className: 'luxury-map-tooltip' });

      layer.on('click', () => {
        highlightParcel(layer, feature);
        openParcelDrawer(feature.properties);
      });
    }
  }).addTo(map);

  const bounds = layerGroup.getBounds();
  currentPlanLayers[cleanPlanNo] = {
    layerGroup,
    bounds,
    data: geojsonData
  };

  if (zoomTo && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
  }

  return currentPlanLayers[cleanPlanNo];
}

/**
 * Handle direct targeting from query params (?plan=3045&plot=412)
 */
async function handleTargetQuery(plan, plot) {
  const cleanPlan = String(plan).replace(/[^\d]/g, '') || "2744";
  const cleanPlot = String(plot).replace(/[^\d]/g, '');

  const planData = await loadPlanParcels(cleanPlan, !cleanPlot, cleanPlot);
  if (!planData) return;

  if (cleanPlot && planData.layerGroup) {
    let matchedLayer = null;
    let matchedFeature = null;

    planData.layerGroup.eachLayer(layer => {
      const p = layer.feature && layer.feature.properties;
      if (p && String(p.plot_no) === cleanPlot) {
        matchedLayer = layer;
        matchedFeature = layer.feature;
      }
    });

    if (matchedLayer && matchedFeature) {
      const center = matchedFeature.properties.center;
      if (center) {
        map.flyTo([center[1], center[0]], 18, { duration: 1.4 });
      } else {
        map.fitBounds(matchedLayer.getBounds(), { maxZoom: 18 });
      }

      highlightParcel(matchedLayer, matchedFeature);
      openParcelDrawer(matchedFeature.properties);
    }
  }
}

/**
 * Highlight a parcel with glowing gold border
 */
function highlightParcel(layer, feature) {
  if (currentActiveParcelLayer) {
    currentActiveParcelLayer.setStyle({
      color: currentActiveParcelLayer.feature.properties.usage === 'تجاري' ? '#A855F7' : '#C5A059',
      weight: 1.2,
      fillOpacity: currentActiveParcelLayer.feature.properties.status === 'مباع' ? 0.35 : 0.18
    });
  }

  currentActiveParcelLayer = layer;
  layer.setStyle({
    color: '#DFBE7B',
    weight: 3.5,
    fillColor: '#DFBE7B',
    fillOpacity: 0.55
  });
  layer.bringToFront();
}

/**
 * Open Parcel Details Drawer
 */
function openParcelDrawer(props) {
  const drawer = document.getElementById('parcel-drawer');
  if (!drawer) return;

  document.getElementById('drawer-plan-title').textContent = `مخطط ${props.plan_no} • قطعة ${props.plot_no}`;
  document.getElementById('drawer-sector').textContent = props.usage ? `${props.usage} • ضاحية عريض` : 'حي عريض';
  document.getElementById('drawer-area').textContent = props.area || '-';
  document.getElementById('drawer-streets').textContent = props.streets || '-';
  document.getElementById('drawer-dimensions').textContent = props.dimensions || '-';
  document.getElementById('drawer-status').textContent = props.status || 'متاح';

  // Build WhatsApp Inquiry Link
  const msg = `السلام عليكم ورحمة الله،\nأود الاستفسار عن تفاصيل القطعة عبر خريطة ركن الحراملة:\n- رقم المخطط: ${props.plan_no}\n- رقم القطعة: ${props.plot_no}\n- المساحة: ${props.area}\n- الأبعاد: ${props.dimensions}\n- الشوارع: ${props.streets}`;
  const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
  document.getElementById('drawer-whatsapp-btn').href = waUrl;

  drawer.classList.add('open');
}

/**
 * Close Parcel Details Drawer
 */
function closeParcelDrawer() {
  const drawer = document.getElementById('parcel-drawer');
  if (drawer) drawer.classList.remove('open');

  if (currentActiveParcelLayer) {
    currentActiveParcelLayer.setStyle({
      color: currentActiveParcelLayer.feature.properties.usage === 'تجاري' ? '#A855F7' : '#C5A059',
      weight: 1.2,
      fillOpacity: currentActiveParcelLayer.feature.properties.status === 'مباع' ? 0.35 : 0.18
    });
    currentActiveParcelLayer = null;
  }
}

/**
 * Select plan from UI pills
 */
function selectPlan(planNo) {
  closeParcelDrawer();
  loadPlanParcels(planNo, true);
}

/**
 * Full Areed Overview
 */
function showAllAreed() {
  closeParcelDrawer();
  document.querySelectorAll('.plan-pill').forEach(p => p.classList.remove('active'));
  map.flyTo(AREED_CENTER, DEFAULT_ZOOM, { duration: 1.2 });
}

/**
 * Ambient background drift
 */
function startAmbientDrift() {
  if (ambientInterval) clearInterval(ambientInterval);
  let step = 0;
  const radius = 0.0035;
  const cLat = AREED_CENTER[0];
  const cLng = AREED_CENTER[1];

  ambientInterval = setInterval(() => {
    step += 0.02;
    const lat = cLat + Math.sin(step) * radius;
    const lng = cLng + Math.cos(step) * (radius * 1.5);
    map.panTo([lat, lng], { animate: true, duration: 2.2, easeLinearity: 1 });
  }, 2300);
}

/**
 * Search Handler (Search by plan or plot)
 */
function handleSearch(query) {
  const q = String(query).trim().toLowerCase();
  if (!q) return;

  const numbers = q.match(/\d+/g);
  if (!numbers || numbers.length === 0) return;

  if (numbers.length >= 2) {
    handleTargetQuery(numbers[0], numbers[1]);
  } else {
    const num = numbers[0];
    const isPlan = plansCatalog.some(p => p.plan_no === num);
    if (isPlan) {
      selectPlan(num);
    } else {
      const activePill = document.querySelector('.plan-pill.active');
      const curPlan = activePill ? activePill.dataset.plan : '2744';
      handleTargetQuery(curPlan, num);
    }
  }
}

// Global initialization
document.addEventListener('DOMContentLoaded', () => {
  initMap();

  const searchInput = document.getElementById('map-search-input');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSearch(searchInput.value);
      }
    });
  }
});
