/**
 * Couponi Auto-Scraper — جامع الكوبونات التلقائي
 * يجمع أحدث الكوبونات من مواقع الكوبونات العربية
 * يشتغل كل يوم عبر GitHub Actions
 */

const https = require('https');
const fs = require('fs');

// المصادر اللي نجمع منها الكوبونات
const SOURCES = {
  noon: [
    'https://almowafir.com/en/store/noon/',
    'https://couponfollow.com/site/noon.com'
  ],
  amazon_sa: [
    'https://almowafir.com/en/store/amazon/',
    'https://couponfollow.com/site/amazon.sa'
  ],
  extra: [
    'https://almowafir.com/en/store/extra/',
    'https://couponfollow.com/site/extra.com'
  ],
  jarir: [
    'https://almowafir.com/en/store/jarir-bookstore/',
    'https://couponfollow.com/site/jarir.com'
  ]
};

// جلب صفحة ويب
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
      }
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchPage(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// استخراج أكواد الكوبونات من HTML
function extractCoupons(html, storeName) {
  const coupons = [];
  const seen = new Set();

  // نمط 1: أكواد داخل عناصر بـ class أو data attributes
  const codePatterns = [
    // كود داخل عنصر coupon
    /data-(?:code|coupon|clipboard-text|copy-value|voucher)="([A-Z0-9]{3,20})"/gi,
    // كود في class="code"
    /class="[^"]*code[^"]*"[^>]*>([A-Z0-9]{3,20})</gi,
    // كود في عنصر مع نسخ
    /copy[^>]*>([A-Z0-9]{3,20})</gi,
    // أكواد في spans/divs خاصة
    /coupon-code[^>]*>([A-Z0-9]{3,20})</gi,
    /promo-code[^>]*>([A-Z0-9]{3,20})</gi,
    /discount-code[^>]*>([A-Z0-9]{3,20})</gi,
  ];

  for (const pattern of codePatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const code = match[1].trim();
      if (code.length >= 3 && code.length <= 20 && !seen.has(code)) {
        seen.add(code);
        coupons.push(code);
      }
    }
  }

  // نمط 2: بحث عن أكواد بين علامات معروفة
  const contextPatterns = [
    /(?:code|coupon|promo|كود|كوبون)[^A-Z0-9]*([A-Z][A-Z0-9]{2,19})/gi,
    /(?:use|استخدم|أدخل)[^A-Z0-9]*([A-Z][A-Z0-9]{2,19})/gi,
  ];

  for (const pattern of contextPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const code = match[1].trim();
      // تصفية: الكود لازم يكون مزيج حروف وأرقام أو حروف كبيرة
      if (code.length >= 3 && code.length <= 15 &&
          /[A-Z]/.test(code) &&
          !/^(THE|AND|FOR|GET|OFF|USE|ALL|NEW|TOP|HOW|NOW|BUY|ADD|SEE|OUR)$/i.test(code) &&
          !seen.has(code)) {
        seen.add(code);
        coupons.push(code);
      }
    }
  }

  return coupons;
}

// استخراج نسبة الخصم
function extractDiscount(html, code) {
  // ابحث عن نسبة خصم قريبة من الكود
  const codeIndex = html.indexOf(code);
  if (codeIndex === -1) return '10%';

  const surrounding = html.substring(Math.max(0, codeIndex - 500), Math.min(html.length, codeIndex + 500));

  const discountMatch = surrounding.match(/(\d{1,2})%/);
  if (discountMatch) return discountMatch[0];

  return '10%';
}

// المتاجر المعروفة وأكوادها الثابتة (fallback)
const KNOWN_COUPONS = {
  noon: [
    { code: 'ALC53', discount: '15%', description: '15% للجدد / 10% للكل' },
    { code: 'AMR52', discount: '15%', description: 'كاش باك 15% على جميع المنتجات' },
    { code: 'BG642', discount: '10%', description: 'خصم 10% على كل المنتجات' },
  ],
  amazon_sa: [
    { code: 'WELCOME20', discount: '20%', description: 'خصم 20% على أول طلب + شحن مجاني' },
    { code: 'NEW20', discount: '15%', description: 'خصم 15% على مشترياتك' },
    { code: 'AB10', discount: '10%', description: 'خصم 10% على منتجات ماركات Amazon' },
  ],
  extra: [
    { code: 'SR39', discount: '10%', description: 'خصم 10% على جميع المنتجات' },
    { code: 'extra10', discount: '10%', description: 'خصم 10% + شحن مجاني' },
    { code: 'BST15', discount: '10%', description: 'خصم 10% على الإلكترونيات' },
  ],
  jarir: [
    { code: 'JARIR10', discount: '10%', description: 'خصم 10% للطلاب' },
  ]
};

const STORE_NAMES = {
  noon: { name: 'نون', name_en: 'Noon', domain: 'noon.com' },
  amazon_sa: { name: 'أمازون السعودية', name_en: 'Amazon.sa', domain: 'amazon.sa' },
  extra: { name: 'إكسترا', name_en: 'eXtra', domain: 'extra.com' },
  jarir: { name: 'جرير', name_en: 'Jarir', domain: 'jarir.com' }
};

async function scrapeStore(storeKey) {
  console.log(`[${storeKey}] جاري الجمع...`);
  const allCodes = new Set();

  // جرب كل مصدر
  for (const url of SOURCES[storeKey]) {
    try {
      console.log(`  → ${url}`);
      const html = await fetchPage(url);
      const codes = extractCoupons(html, storeKey);
      codes.forEach(c => allCodes.add(c));
      console.log(`  ✓ وجدنا ${codes.length} كود`);
    } catch (e) {
      console.log(`  ✗ فشل: ${e.message}`);
    }
  }

  // أضف الأكواد المعروفة دائماً (ما نخسرها)
  const knownCodes = KNOWN_COUPONS[storeKey] || [];
  knownCodes.forEach(c => allCodes.add(c.code));

  // بناء قائمة الكوبونات
  const coupons = [];
  const seen = new Set();

  // أولاً: الأكواد المعروفة (أولوية)
  for (const known of knownCodes) {
    if (!seen.has(known.code)) {
      seen.add(known.code);
      coupons.push({
        code: known.code,
        discount: known.discount,
        type: 'percentage',
        max_discount_sar: 100,
        min_order_sar: 0,
        description: known.description,
        categories: ['all'],
        new_users_only: false,
        active: true
      });
    }
  }

  // ثانياً: الأكواد الجديدة من السكريبت
  for (const code of allCodes) {
    if (!seen.has(code)) {
      seen.add(code);
      coupons.push({
        code,
        discount: '10%',
        type: 'percentage',
        max_discount_sar: 100,
        min_order_sar: 0,
        description: `خصم على ${STORE_NAMES[storeKey].name}`,
        categories: ['all'],
        new_users_only: false,
        active: true
      });
    }
  }

  console.log(`[${storeKey}] المجموع: ${coupons.length} كوبون`);
  return coupons;
}

async function main() {
  console.log('=== Couponi Auto-Scraper ===');
  console.log(`التاريخ: ${new Date().toISOString()}\n`);

  // اقرأ الملف الحالي
  let currentData;
  try {
    currentData = JSON.parse(fs.readFileSync('coupons.json', 'utf8'));
  } catch {
    currentData = { version: '1.0.0', stores: {} };
  }

  // اجمع الكوبونات لكل متجر
  const stores = {};
  for (const storeKey of Object.keys(SOURCES)) {
    const coupons = await scrapeStore(storeKey);
    stores[storeKey] = {
      ...STORE_NAMES[storeKey],
      coupons
    };
  }

  // حدّث الإصدار
  const versionParts = (currentData.version || '1.0.0').split('.');
  versionParts[2] = String(parseInt(versionParts[2] || '0') + 1);
  const newVersion = versionParts.join('.');

  const newData = {
    version: newVersion,
    last_updated: new Date().toISOString().split('T')[0],
    stores
  };

  // احفظ
  fs.writeFileSync('coupons.json', JSON.stringify(newData, null, 2) + '\n');

  // ملخص
  console.log('\n=== ملخص ===');
  let totalCoupons = 0;
  for (const [key, store] of Object.entries(stores)) {
    console.log(`${store.name}: ${store.coupons.length} كوبون`);
    totalCoupons += store.coupons.length;
  }
  console.log(`الإجمالي: ${totalCoupons} كوبون`);
  console.log(`الإصدار: ${newVersion}`);
}

main().catch(e => {
  console.error('خطأ:', e);
  process.exit(1);
});
