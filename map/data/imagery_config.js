/* إعداد «نوع الخريطة» — AridMap v0.6-dev
   ------------------------------------------------------------------
   الوضع الافتراضي عند التشغيل هو «الخريطة الحالية» دائمًا. لا يتصل التطبيق بالإنترنت
   إلا عندما يختار الزائر «صور الأقمار الصناعية».

   صور الأقمار الصناعية عبر الإنترنت (Esri World Imagery):
     1) أنشئ حسابًا على ArcGIS Location Platform: https://location.arcgis.com
     2) أنشئ مفتاح API بصلاحيات الخرائط الأساسية (التفاصيل في docs/ESRI_SETUP_AR.md).
     3) الصق المفتاح بين علامتي التنصيص في api_key أدناه، واحفظ الملف.
   - المفتاح صالح حتى سنة كحد أقصى؛ جدّده قبل انتهاء صلاحيته.
   - شروط Esri تمنع تخزين بلاطات الصور أو تنزيلها؛ تُعرض مباشرة من الإنترنت فقط.
   - إذا لم يوجد اتصال، أو لم يُضبط المفتاح، أو رفضته الخدمة، ينتقل التطبيق تلقائيًا إلى
     «العرض الواقعي» (رسم توضيحي يعمل دون إنترنت) مع رسالة واضحة، ويعود إلى الصور عند عودة الاتصال.

   local_pack: حزمة صور محلية مرخّصة اختيارية (تُستخدم قبل المصدر المتصل إن وُجدت). null = لا توجد.
*/
window.IMAGERY_CONFIG = {
  local_pack: "data/imagery/copernicus_s2/pack.js",

  // v1.1.1 — معالجة ألوان العرض فقط (تُطبّق على طبقة الصور في كرت الشاشة). لا تغيّر ملفات الصور ولا إحداثياتها ولا محاذاتها.
  //   القيمة رقم، أو [[مستوى التكبير، القيمة]، ...] لتغيّر سلس مع التكبير. أي قيمة ناقصة أو خارج المدى تعود تلقائيًا إلى قيم v1.1.
  //   local  = صور Sentinel-2 المخزّنة: إزالة الصفار المخضرّ (hue_rotate)، تباين معتدل يزيد قليلًا عند التقريب حيث الصحراء مسطحة،
  //            وسطوع أهدأ لشاشة كبيرة يتطابق عند المستوى 15 مع «العرض الواقعي» الذي يظهر بعدها، فلا يحدث قفز لوني.
  //   online = Esri (غير مفعّل حاليًا لعدم وجود مفتاح): يبقى بقيم v1.1 لأنه مصدر بألوان مختلفة لم يُختبر.
  //   plan_fill_opacity_factor = تخفيف التظليل الذهبي لمناطق المخططات فوق الصور فقط (0.2–1).
  display: {
    // v1.13: ألوان الحزمة المحلية معايرة داخل البلاطات نفسها لتشبه صور القمر الصناعي في سهيل، فلا حاجة لمرشح ألوان هنا (قيم محايدة).
    local: {
      saturation: 0,
      contrast: 0,
      brightness_min: 0,
      brightness_max: 1,
      hue_rotate: 0
    },
    online: { saturation: -0.15, contrast: 0.05, brightness_min: 0, brightness_max: 0.82, hue_rotate: 0 },
    plan_fill_opacity_factor: 0.6
  },

  online: {
    enabled: true,
    api_key: "public",
    confirm_before_connect: false,   // true = يطلب من الزائر الموافقة قبل أول اتصال
    fallback_mode: "real",           // ما يُعرض عند تعذّر الصور: "real" (العرض الواقعي) أو "map"
    provider: "Esri World Imagery",
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 19,
    attribution: "Powered by Esri | Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    terms_url: "https://location.arcgis.com/help/terms-of-use/"
  }
};
