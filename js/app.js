/**
 * شركة ركن الحراملة العقارية - Rukn Al-Haramala Real Estate
 * Modern Luxury Arabic Real Estate Platform
 * 100% Live Google Sheets CSV Engine with Flexible Column Mapping
 * Enhanced with MengTo Skills: GSAP ScrollTrigger Reveals, Reveal Hover Effect & Liquid Metal Gold Border
 */

// Global Configuration
const WHATSAPP_NUMBER = "966504302102";
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQd4-PmHM5yhvJf3LAt5GzVLezEYB-WDHKft_VB_CCzVxd4ASap_WPEsk6zNcC04go7VaelDFcqAwYp/pub?output=csv";

// Clean Luxury Architectural Fallback Image (used ONLY when image_url cell is empty or invalid)
const DEFAULT_FALLBACK_IMAGE = "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80";

// Live State Management
let allProperties = [];
let currentFilter = "all";
let hideSoldActive = false;
let searchQuery = "";
let revealAnimationFrames = [];

/**
 * Escape HTML to prevent injection and rendering bugs
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format Google Drive and external images into direct viewable URLs
 */
function formatImageUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return DEFAULT_FALLBACK_IMAGE;
  }
  
  const cleanUrl = url.trim();

  // If link was placeholder/removed/invalid
  if (cleanUrl === "[link removed]" || cleanUrl === "-" || cleanUrl === "undefined") {
    return DEFAULT_FALLBACK_IMAGE;
  }

  // Convert Google Drive sharing links to direct thumbnail view URLs
  const driveRegex = /(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=|uc\?.*[?&]id=)|lh3\.googleusercontent\.com\/d\/)([a-zA-Z0-9_-]+)/i;
  const match = cleanUrl.match(driveRegex);
  if (match && match[1]) {
    return `https://lh3.googleusercontent.com/d/${match[1]}`;
  }

  // Handle standard HTTP/HTTPS URLs
  if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
    return cleanUrl;
  }

  return DEFAULT_FALLBACK_IMAGE;
}

/**
 * Check if map URL is a valid web link
 */
function isValidMapUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim();
  if (clean === "" || clean === "[link removed]" || clean === "-" || clean === "undefined") return false;
  return clean.startsWith("http://") || clean.startsWith("https://");
}

/**
 * Get Status Badge CSS classes and label
 */
function getStatusBadge(status) {
  const s = (status || "").trim();
  const lower = s.toLowerCase();

  if (s.includes("مباع") || lower === "sold") {
    return {
      classes: "bg-rose-500/10 text-rose-400 border border-rose-500/30",
      dot: "bg-rose-400",
      isSold: true
    };
  }
  if (s.includes("محجوز") || lower === "reserved") {
    return {
      classes: "bg-amber-500/10 text-amber-400 border border-amber-500/30",
      dot: "bg-amber-400",
      isSold: false
    };
  }
  if (s.includes("متاح") || lower === "available") {
    return {
      classes: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
      dot: "bg-emerald-400",
      isSold: false
    };
  }
  return {
    classes: "bg-gray-500/10 text-gray-300 border border-gray-500/30",
    dot: "bg-gray-400",
    isSold: false
  };
}

/**
 * Build WhatsApp link for plot inquiry using exact title and ID
 */
function buildPropertyWhatsAppLink(property) {
  const title = property.title || "عقار بدون عنوان";
  const id = property.id ? ` (كود: ${property.id})` : "";
  const message = `السلام عليكم ورحمة الله، أود الاستفسار عن تفاصيل: ${title}${id}.`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/**
 * Robust Built-in CSV Parser (acts as a backup if PapaParse CDN fails)
 */
function parseCSVString(text) {
  const p = [];
  let row = [''];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      if (row.length > 1 || row[0] !== '') {
        p.push(row);
      }
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }

  if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
    p.push(row);
  }

  if (p.length === 0) return { data: [], meta: { fields: [] } };
  const headers = p[0].map(h => h.trim());
  const data = p.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] !== undefined ? r[idx].trim() : '';
    });
    return obj;
  });
  return { data, meta: { fields: headers } };
}

/**
 * Flexible Column Mapping: Normalizes both English and Arabic headers
 */
function normalizePropertyRow(rawRow) {
  const norm = {
    id: '',
    title: '',
    type: '',
    district: '',
    area: '',
    streets: '',
    dimensions: '',
    price: '',
    status: '',
    map_url: '',
    image_url: ''
  };

  for (const [key, rawVal] of Object.entries(rawRow)) {
    if (!key) continue;
    const k = key.trim().toLowerCase().replace(/[\r\n_-]/g, ' ');
    const val = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : '';

    // ID
    if (!norm.id && (k === 'id' || k.includes('كود') || k.includes('معرف') || k.includes('رقم العقار') || k.includes('رقم القطعة') || k.includes('رمز'))) {
      norm.id = val;
    }
    // Title
    else if (!norm.title && (k === 'title' || k.includes('عنوان') || k.includes('اسم العقار') || k.includes('اسم العرض') || k.includes('وصف'))) {
      norm.title = val;
    }
    // Type
    else if (!norm.type && (k === 'type' || k.includes('نوع') || k.includes('تصنيف') || k.includes('صنف'))) {
      norm.type = val;
    }
    // District
    else if (!norm.district && (k === 'district' || k.includes('حي') || k.includes('منطقة') || k.includes('منطقه'))) {
      norm.district = val;
    }
    // Area
    else if (!norm.area && (k === 'area' || k.includes('مساح'))) {
      norm.area = val;
    }
    // Streets
    else if (!norm.streets && (k === 'streets' || k === 'street' || k.includes('شارع') || k.includes('شوارع') || k.includes('واجه'))) {
      norm.streets = val;
    }
    // Dimensions
    else if (!norm.dimensions && (k === 'dimensions' || k.includes('أبعاد') || k.includes('ابعاد') || k.includes('أطوال') || k.includes('اطوال') || k.includes('حدود'))) {
      norm.dimensions = val;
    }
    // Price
    else if (!norm.price && (k === 'price' || k.includes('سعر') || k.includes('قيم') || k.includes('مبلغ'))) {
      norm.price = val;
    }
    // Status
    else if (!norm.status && (k === 'status' || k.includes('حال') || k.includes('وضع'))) {
      norm.status = val;
    }
    // Map URL
    else if (!norm.map_url && (k.includes('map') || k.includes('خريط') || k.includes('لوكيشن') || k.includes('موقع'))) {
      norm.map_url = val;
    }
    // Image URL
    else if (!norm.image_url && (k.includes('image') || k.includes('img') || k.includes('photo') || k.includes('صور'))) {
      norm.image_url = val;
    }
  }

  // Exact fallback if key names match the standard English schema directly
  ['id', 'title', 'type', 'district', 'area', 'streets', 'dimensions', 'price', 'status', 'map_url', 'image_url'].forEach(col => {
    if (rawRow[col] !== undefined && rawRow[col] !== null && String(rawRow[col]).trim() !== '') {
      norm[col] = String(rawRow[col]).trim();
    }
  });

  return norm;
}

/**
 * Fetch Live CSV Data reliably with Fallbacks and Comprehensive Console Logging
 */
async function fetchProperties() {
  const countBadge = document.getElementById("properties-count");
  if (countBadge) countBadge.textContent = "جارٍ التحميل...";

  console.log("%c[ركن الحراملة] بدء جلب بيانات العقارات من Google Sheets...", "color: #DFBE7B; font-weight: bold; font-size: 12px;");

  try {
    let parsedResult = null;

    // Primary: Modern fetch API with redirect following and cache busting
    try {
      const response = await fetch(CSV_URL, {
        cache: "no-store",
        redirect: "follow"
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      const csvText = await response.text();

      if (window.Papa) {
        parsedResult = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: 'greedy'
        });
      } else {
        parsedResult = parseCSVString(csvText);
      }
    } catch (fetchErr) {
      console.warn("[ركن الحراملة] تعذر استخدام fetch المباشر، جاري التبديل إلى Papa.parse download...", fetchErr);

      // Secondary: PapaParse download mode
      if (window.Papa) {
        parsedResult = await new Promise((resolve, reject) => {
          Papa.parse(CSV_URL, {
            download: true,
            header: true,
            skipEmptyLines: 'greedy',
            complete: (res) => resolve(res),
            error: (err) => reject(err)
          });
        });
      } else {
        throw fetchErr;
      }
    }

    // Process and log parsed results
    if (parsedResult) {
      const rawHeaders = parsedResult.meta && parsedResult.meta.fields 
        ? parsedResult.meta.fields 
        : (parsedResult.data[0] ? Object.keys(parsedResult.data[0]) : []);

      console.log("%c[ركن الحراملة] تم استلام الـ CSV بنجاح!", "color: #10B981; font-weight: bold;");
      console.log("📋 الأعمدة المكتشفة في الشيت (Headers):", rawHeaders);
      console.log(`📊 إجمالي الصفوف المستلمة: ${parsedResult.data ? parsedResult.data.length : 0}`);

      if (parsedResult.errors && parsedResult.errors.length > 0) {
        console.warn("⚠️ تنبيهات تحليل الـ CSV:", parsedResult.errors);
      }

      // Map columns flexibly
      if (parsedResult.data && Array.isArray(parsedResult.data)) {
        allProperties = parsedResult.data
          .map(normalizePropertyRow)
          .filter(row => {
            const hasId = row.id && row.id !== "";
            const hasTitle = row.title && row.title !== "";
            return hasId || hasTitle;
          });

        console.log(`✅ العقارات الصالحة بعد المطابقة المرنة: ${allProperties.length}`);
      } else {
        allProperties = [];
      }
    } else {
      allProperties = [];
    }

  } catch (error) {
    console.error("%c[ركن الحراملة] خطأ في جلب بيانات Google Sheets:", "color: #EF4444; font-weight: bold;", error);
    allProperties = [];
  }

  // Update UI and trigger GSAP animations
  renderFilterButtons();
  renderProperties();
}

/**
 * Dynamically Generate Filter Buttons from unique values in the live 'type' column
 */
function renderFilterButtons() {
  const container = document.getElementById("filter-buttons-container");
  if (!container) return;

  const typesSet = new Set();
  allProperties.forEach(p => {
    if (p.type && String(p.type).trim() !== "" && String(p.type).trim() !== "-") {
      typesSet.add(String(p.type).trim());
    }
  });

  const uniqueTypes = Array.from(typesSet);

  if (currentFilter !== "all" && !uniqueTypes.includes(currentFilter)) {
    currentFilter = "all";
  }

  let html = `
    <button 
      data-filter-btn="all"
      onclick="setFilter('all')" 
      class="${currentFilter === 'all' ? 'filter-btn-active px-5 py-2 rounded-xl font-medium text-xs sm:text-sm gold-gradient-bg text-black shadow-md transition' : 'filter-btn-inactive px-5 py-2 rounded-xl font-medium text-xs sm:text-sm text-gray-300 hover:text-white bg-[#1A1A1A] border border-white/5 hover:border-[#C5A059]/30 transition'}"
    >
      الكل
    </button>
  `;

  uniqueTypes.forEach(typeName => {
    const isActive = currentFilter === typeName;
    html += `
      <button 
        data-filter-btn="${escapeHtml(typeName)}"
        onclick="setFilter('${escapeHtml(typeName)}')" 
        class="${isActive ? 'filter-btn-active px-5 py-2 rounded-xl font-medium text-xs sm:text-sm gold-gradient-bg text-black shadow-md transition' : 'filter-btn-inactive px-5 py-2 rounded-xl font-medium text-xs sm:text-sm text-gray-300 hover:text-white bg-[#1A1A1A] border border-white/5 hover:border-[#C5A059]/30 transition'}"
      >
        ${escapeHtml(typeName)}
      </button>
    `;
  });

  container.innerHTML = html;
}

/**
 * Filter button click handler
 */
function setFilter(filterType) {
  currentFilter = filterType;
  renderFilterButtons();
  renderProperties();
}

/**
 * Filter properties based on current UI state
 */
function getFilteredProperties() {
  return allProperties.filter(item => {
    // Hide sold filter
    if (hideSoldActive) {
      const badge = getStatusBadge(item.status);
      if (badge.isSold) return false;
    }

    // Dynamic type filter: exact match with sheet cell value
    if (currentFilter !== "all") {
      const itemType = (item.type || "").trim();
      if (itemType !== currentFilter) return false;
    }

    // Real-time search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchTitle = (item.title || "").toLowerCase().includes(q);
      const matchDistrict = (item.district || "").toLowerCase().includes(q);
      const matchId = (item.id || "").toLowerCase().includes(q);
      const matchType = (item.type || "").toLowerCase().includes(q);
      if (!matchTitle && !matchDistrict && !matchId && !matchType) return false;
    }

    return true;
  });
}

/**
 * Render property cards into the grid with Liquid Metal Border & Reveal Hover Effect
 */
function renderProperties() {
  const container = document.getElementById("properties-grid");
  const countBadge = document.getElementById("properties-count");
  if (!container) return;

  // Clear previous reveal animation listeners
  cleanupRevealHoverEffects();

  // Empty State: 0 data rows fetched from Google Sheets or error
  if (allProperties.length === 0) {
    if (countBadge) countBadge.textContent = "0 عقار";
    container.innerHTML = `
      <div class="col-span-full py-20 text-center">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-[#1A1A1A] border border-white/10 flex items-center justify-center text-gray-400">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
          </svg>
        </div>
        <h3 class="text-xl font-bold text-white mb-2">لا توجد عروض متاحة حالياً</h3>
        <p class="text-gray-400 max-w-md mx-auto text-sm">سيتم عرض العروض العقارية فور إضافتها في جدول البيانات المباشر.</p>
      </div>
    `;
    return;
  }

  const filtered = getFilteredProperties();
  if (countBadge) {
    countBadge.textContent = `${filtered.length} عقار`;
  }

  // Filter Empty State: No results match search/filter
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-20 text-center">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-[#1A1A1A] border border-[#C5A059]/30 flex items-center justify-center text-[#C5A059]">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
        </div>
        <h3 class="text-xl font-bold text-white mb-2">لا توجد نتائج تطابق خيارات البحث</h3>
        <p class="text-gray-400 max-w-md mx-auto text-sm mb-6">جرّب تغيير فئة العقار، أو إلغاء تفعيل "إخفاء المباع"، أو البحث بكلمات أخرى.</p>
        <button onclick="resetFilters()" class="px-6 py-2.5 rounded-lg border border-[#C5A059] text-[#DFBE7B] hover:bg-[#C5A059]/10 text-sm font-medium transition">
          إعادة ضبط الفلاتر
        </button>
      </div>
    `;
    return;
  }

  // Render cards from live rows
  container.innerHTML = filtered.map((plot) => {
    const imageUrl = formatImageUrl(plot.image_url);
    const whatsappLink = buildPropertyWhatsAppLink(plot);
    const hasMap = isValidMapUrl(plot.map_url);

    // Exact Status Badge (hidden if empty)
    const statusText = (plot.status || "").trim();
    let statusBadgeHtml = "";
    if (statusText !== "" && statusText !== "-") {
      const badge = getStatusBadge(statusText);
      statusBadgeHtml = `
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-md ${badge.classes}">
          <span class="w-2 h-2 rounded-full ${badge.dot}"></span>
          ${escapeHtml(statusText)}
        </span>
      `;
    }

    // Exact Type Badge (hidden if empty)
    const typeText = (plot.type || "").trim();
    let typeBadgeHtml = "";
    if (typeText !== "" && typeText !== "-") {
      typeBadgeHtml = `
        <span class="px-3 py-1 rounded-full text-xs font-medium bg-[#121212]/80 backdrop-blur-md text-[#DFBE7B] border border-[#C5A059]/30">
          ${escapeHtml(typeText)}
        </span>
      `;
    }

    // Exact ID Badge (hidden if empty)
    const idText = (plot.id || "").trim();
    let idBadgeHtml = "";
    if (idText !== "") {
      idBadgeHtml = `
        <div class="absolute bottom-3 right-4 z-10">
          <span class="text-xs font-mono px-2 py-0.5 rounded bg-black/70 text-gray-200 border border-white/10">
            ${escapeHtml(idText)}
          </span>
        </div>
      `;
    }

    // Exact District (hidden if empty)
    const districtText = (plot.district || "").trim();
    let districtHtml = "";
    if (districtText !== "" && districtText !== "-") {
      districtHtml = `
        <div class="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <svg class="w-4 h-4 text-[#C5A059] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
          </svg>
          <span>${escapeHtml(districtText)}</span>
        </div>
      `;
    }

    // Optional Specifications Grid (Hide any empty field)
    const specItems = [];
    const areaVal = (plot.area || "").trim();
    if (areaVal !== "" && areaVal !== "-") {
      specItems.push({
        label: "المساحة",
        value: areaVal,
        icon: `<svg class="w-3.5 h-3.5 text-[#C5A059] inline-block mb-0.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>`
      });
    }
    const streetsVal = (plot.streets || "").trim();
    if (streetsVal !== "" && streetsVal !== "-") {
      specItems.push({
        label: "الشارع",
        value: streetsVal,
        icon: `<svg class="w-3.5 h-3.5 text-[#C5A059] inline-block mb-0.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>`
      });
    }
    const dimensionsVal = (plot.dimensions || "").trim();
    if (dimensionsVal !== "" && dimensionsVal !== "-") {
      specItems.push({
        label: "الأبعاد",
        value: dimensionsVal,
        icon: `<svg class="w-3.5 h-3.5 text-[#C5A059] inline-block mb-0.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v10m8-10v10m-10-5h12"></path></svg>`
      });
    }

    let specsHtml = "";
    if (specItems.length > 0) {
      const colClass = specItems.length === 1 ? "grid-cols-1" : specItems.length === 2 ? "grid-cols-2" : "grid-cols-3";
      specsHtml = `
        <div class="grid ${colClass} gap-2 py-3 px-3 rounded-xl spec-badge mb-5">
          ${specItems.map((spec, idx) => `
            <div class="text-center ${idx > 0 ? 'border-r border-white/10 pr-2' : ''}">
              <span class="flex items-center justify-center text-[11px] text-gray-400 mb-0.5">
                ${spec.icon}
                <span>${spec.label}</span>
              </span>
              <span class="text-xs font-semibold text-gray-100 truncate block" title="${escapeHtml(spec.value)}">${escapeHtml(spec.value)}</span>
            </div>
          `).join("")}
        </div>
      `;
    }

    // Exact Price (hidden if empty)
    const priceText = (plot.price || "").trim();
    let priceHtml = "";
    if (priceText !== "" && priceText !== "-") {
      priceHtml = `
        <div class="flex items-baseline justify-between mb-4 pt-2 border-t border-white/5">
          <span class="text-xs text-gray-400">السعر</span>
          <span class="text-lg font-bold gold-gradient-text">
            ${escapeHtml(priceText)}
          </span>
        </div>
      `;
    }

    // Action Buttons
    let buttonsHtml = "";
    if (hasMap) {
      buttonsHtml = `
        <div class="grid grid-cols-2 gap-2 relative z-10">
          <a 
            href="${escapeHtml(plot.map_url.trim())}" 
            target="_blank" 
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border border-white/10 text-gray-300 hover:text-white hover:border-[#C5A059]/50 hover:bg-[#C5A059]/10 text-xs font-medium transition"
            title="الموقع على الخريطة"
          >
            <svg class="w-3.5 h-3.5 text-[#DFBE7B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path>
            </svg>
            <span>الموقع على الخريطة</span>
          </a>

          <a 
            href="${whatsappLink}" 
            target="_blank" 
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl gold-gradient-bg text-black font-semibold text-xs shadow-md shadow-[#C5A059]/20 hover:scale-[1.02] transition-transform"
          >
            <svg class="w-3.5 h-3.5 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            <span>استفسر عبر واتساب</span>
          </a>
        </div>
      `;
    } else {
      buttonsHtml = `
        <div class="relative z-10">
          <a 
            href="${whatsappLink}" 
            target="_blank" 
            rel="noopener noreferrer"
            class="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl gold-gradient-bg text-black font-semibold text-xs shadow-md shadow-[#C5A059]/20 hover:scale-[1.02] transition-transform"
          >
            <svg class="w-3.5 h-3.5 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            <span>استفسر عبر واتساب</span>
          </a>
        </div>
      `;
    }

    return `
      <div class="property-card liquid-metal-card overflow-hidden flex flex-col group cursor-pointer" data-reveal-card>
        <!-- MengTo Reveal Hover Spotlight Surface Overlay -->
        <div class="reveal-spotlight"></div>

        <!-- Card Image Header with Reveal Hover Spotlight -->
        <div class="reveal-image-container h-60 w-full overflow-hidden bg-[#1A1A1A]">
          <img 
            src="${imageUrl}" 
            alt="${escapeHtml(plot.title || '')}" 
            loading="lazy"
            onerror="this.onerror=null; this.src='${DEFAULT_FALLBACK_IMAGE}';"
            class="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-[#121212] via-black/25 to-transparent z-10"></div>
          
          <!-- MengTo Reveal Hover Image Light Layer -->
          <div class="reveal-image-spotlight z-10"></div>

          <!-- Top Badges -->
          <div class="absolute top-4 inset-x-4 flex items-center justify-between pointer-events-none z-20">
            ${statusBadgeHtml}
            ${typeBadgeHtml}
          </div>

          <!-- Property ID -->
          ${idBadgeHtml}
        </div>

        <!-- Card Body -->
        <div class="p-6 flex-1 flex flex-col justify-between relative z-10">
          <div>
            ${districtHtml}

            <!-- Title -->
            <h3 class="text-lg font-bold text-white mb-4 line-clamp-1 group-hover:text-[#DFBE7B] transition-colors duration-300">
              ${escapeHtml(plot.title || '')}
            </h3>

            <!-- Specifications -->
            ${specsHtml}
          </div>

          <!-- Price & Action Section -->
          <div>
            ${priceHtml}
            ${buttonsHtml}
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Initialize MengTo Reveal Hover Effect on cards
  initRevealHoverEffects();

  // Trigger GSAP Staggered Entrance Animation
  animateCardsEntrance();
}

/**
 * MENGTO SKILL: GSAP ScrollTrigger & Reveal Animations
 */
function initGsapAnimations() {
  if (typeof gsap === "undefined") return;

  if (typeof ScrollTrigger !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
  }

  // Hero Entrance Timeline
  const heroTl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.8 } });
  
  if (document.querySelector(".hero-badge")) {
    heroTl.from(".hero-badge", { y: -20, opacity: 0, delay: 0.1 });
  }
  if (document.querySelector(".hero-title")) {
    heroTl.from(".hero-title", { y: 30, opacity: 0 }, "-=0.5");
  }
  if (document.querySelector(".hero-desc")) {
    heroTl.from(".hero-desc", { y: 25, opacity: 0 }, "-=0.5");
  }
  if (document.querySelector(".hero-ctas")) {
    heroTl.from(".hero-ctas", { y: 20, opacity: 0, scale: 0.98 }, "-=0.5");
  }
  if (document.querySelectorAll(".hero-stats > div").length > 0) {
    heroTl.from(".hero-stats > div", { y: 20, opacity: 0, stagger: 0.08 }, "-=0.4");
  }

  // ScrollTrigger reveals on Section Titles
  if (typeof ScrollTrigger !== "undefined") {
    gsap.utils.toArray("section").forEach(sec => {
      const heading = sec.querySelector("h2");
      if (heading) {
        gsap.from(heading, {
          scrollTrigger: {
            trigger: heading,
            start: "top 88%",
            toggleActions: "play none none none"
          },
          y: 25,
          opacity: 0,
          duration: 0.7,
          ease: "power2.out"
        });
      }
    });
  }
}

/**
 * Animate property cards entrance on load / filter change
 */
function animateCardsEntrance() {
  if (typeof gsap === "undefined") return;

  const cards = document.querySelectorAll(".property-card");
  if (cards.length === 0) return;

  gsap.fromTo(
    cards,
    { y: 35, opacity: 0, scale: 0.97 },
    {
      y: 0,
      opacity: 1,
      scale: 1,
      duration: 0.65,
      ease: "power2.out",
      stagger: 0.07,
      clearProps: "transform,opacity"
    }
  );

  if (typeof ScrollTrigger !== "undefined") {
    ScrollTrigger.refresh();
  }
}

/**
 * MENGTO SKILL: Reveal Hover Effect (Cursor-Following Spotlight with RAF interpolation)
 */
function initRevealHoverEffects() {
  const cards = document.querySelectorAll("[data-reveal-card]");

  cards.forEach(card => {
    const spotlight = card.querySelector(".reveal-spotlight");
    const imgContainer = card.querySelector(".reveal-image-container");

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let targetRadius = 0;
    let currentRadius = 0;
    let isHovering = false;
    let animId = null;

    const DESKTOP_RADIUS = 280;

    function update() {
      // Smooth interpolation using RAF
      currentX += (targetX - currentX) * 0.12;
      currentY += (targetY - currentY) * 0.12;
      currentRadius += (targetRadius - currentRadius) * 0.15;

      if (spotlight) {
        spotlight.style.setProperty("--reveal-x", `${currentX}px`);
        spotlight.style.setProperty("--reveal-y", `${currentY}px`);
        spotlight.style.setProperty("--reveal-r", `${currentRadius}px`);
      }

      if (imgContainer) {
        imgContainer.style.setProperty("--reveal-img-x", `${currentX}px`);
        imgContainer.style.setProperty("--reveal-img-y", `${currentY}px`);
        imgContainer.style.setProperty("--reveal-img-r", `${currentRadius * 0.8}px`);
      }

      if (isHovering || currentRadius > 0.5) {
        animId = requestAnimationFrame(update);
      }
    }

    card.addEventListener("mouseenter", (e) => {
      isHovering = true;
      const rect = card.getBoundingClientRect();
      targetX = currentX = e.clientX - rect.left;
      targetY = currentY = e.clientY - rect.top;
      targetRadius = DESKTOP_RADIUS;
      if (spotlight) spotlight.style.opacity = "1";
      cancelAnimationFrame(animId);
      animId = requestAnimationFrame(update);
    });

    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      targetX = e.clientX - rect.left;
      targetY = e.clientY - rect.top;
    });

    card.addEventListener("mouseleave", () => {
      isHovering = false;
      targetRadius = 0; // Collapses mask on exit
      if (spotlight) spotlight.style.opacity = "0";
    });

    revealAnimationFrames.push(() => cancelAnimationFrame(animId));
  });
}

function cleanupRevealHoverEffects() {
  revealAnimationFrames.forEach(cancel => cancel());
  revealAnimationFrames = [];
}

/**
 * Toggle 'إخفاء المباع'
 */
function toggleHideSold(checkbox) {
  hideSoldActive = checkbox.checked;
  renderProperties();
}

/**
 * Reset all filters to default
 */
function resetFilters() {
  currentFilter = "all";
  hideSoldActive = false;
  searchQuery = "";

  const hideSoldCheckbox = document.getElementById("toggle-hide-sold");
  if (hideSoldCheckbox) hideSoldCheckbox.checked = false;

  const searchInput = document.getElementById("search-input");
  if (searchInput) searchInput.value = "";

  renderFilterButtons();
  renderProperties();
}

/**
 * Handle Contact Form Submission - Direct WhatsApp Redirection
 */
function handleContactFormSubmit(event) {
  event.preventDefault();
  const name = document.getElementById("contact-name").value.trim();
  const phone = document.getElementById("contact-phone").value.trim();
  const requestType = document.getElementById("contact-type").value;
  const details = document.getElementById("contact-details").value.trim();

  let message = `السلام عليكم ورحمة الله،\nلدي طلب تواصل عبر الموقع الإلكتروني لشركة ركن الحراملة العقارية:\n`;
  if (name) message += `- الاسم: ${name}\n`;
  if (phone) message += `- الجوال: ${phone}\n`;
  if (requestType) message += `- نوع الطلب: ${requestType}\n`;
  if (details) message += `- التفاصيل: ${details}\n`;

  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, "_blank");
}

// Initial Events and Listeners
document.addEventListener("DOMContentLoaded", () => {
  // Initialize GSAP Entrance Animations
  initGsapAnimations();

  // Fetch properties from live Google Sheet CSV
  fetchProperties();

  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");
  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener("click", () => {
      mobileMenu.classList.toggle("hidden");
    });
  }

  // Search input event
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      renderProperties();
    });
  }

  // Contact form listener
  const contactForm = document.getElementById("contact-form");
  if (contactForm) {
    contactForm.addEventListener("submit", handleContactFormSubmit);
  }
});
