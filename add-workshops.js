// أداة سريعة لإضافة ورش جديدة لملف data/workshops.json بدون تعديل server.js يدويًا.
//
// الاستخدام:
//   node add-workshops.js path/to/new-workshops.txt
//
// الصق نص خام بنفس الصيغة المعتادة داخل ملف نصي (كل ورشة بفقرة منفصلة، مفصولة بسطر فاضي):
//
//   اسم الورشة
//   التقييم: 4.3 , الموقع: شرق 9 , الرقم: 0501234567 , يفتح 8 الصباح ويسكر 11 الليل
//   الموقع : 24.288131, 54.640807
//
// الترتيب داخل كل فقرة مو مهم كثير، والسكربت يحاول يلتقط:
//   - الاسم: أول سطر غير فاضي
//   - التقييم: رقم بعد كلمة "تقييم"، أو كلمة عربية زي "اربع نجوم" (يفهم 1-10)
//   - الرقم: أي رقم هاتف إماراتي الشكل (05xxxxxxxx / 02xxxxxxx / 800xxxx)
//   - ساعات الدوام: الجملة اللي فيها "يفتح ... يسكر ..."
//   - الإحداثيات: أول رقمين عشريين بمدى إحداثيات الإمارات (خط عرض 22-27، خط طول 50-58)
//   - الموقع الإلكتروني (اختياري): أي رابط يبدأ بـ http/https أو www (يصلّح www,site لو كتبت فاصلة بالغلط)
//   - الجهة/رقم القطاع: من كلمات "شرق/غرب/شامخة/مفرق" + رقم قريب منها (رقم أو بالحروف)
//
// النتيجة تُضاف (append) لملف data/workshops.json، وتُطبع بالتيرمينال كمان عشان تراجعها.
// المدخلات مو موثوقة 100% (فهم لغة طبيعية تقريبي) — راجع الملف بعد التشغيل للتأكد.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "workshops.json");

const AR_NUM_WORDS = {
  "واحد": 1, "واحده": 1, "اثنين": 2, "ثنين": 2, "اثنان": 2, "ثلاثة": 3, "ثلاثه": 3, "ثلاث": 3,
  "اربعة": 4, "أربعة": 4, "اربعه": 4, "اربع": 4, "أربع": 4, "خمسة": 5, "خمسه": 5, "خمس": 5,
  "ستة": 6, "سته": 6, "ست": 6, "سبعة": 7, "سبعه": 7, "سبع": 7, "ثمانية": 8, "ثمانيه": 8, "ثمان": 8,
  "تسعة": 9, "تسعه": 9, "تسع": 9, "عشرة": 10, "عشره": 10, "عشر": 10,
};

function detectAreaDir(text) {
  if (/شامخ|shamkha/i.test(text)) return "shamkha";
  if (/مفرق|mafraq/i.test(text)) return "mafraq";
  if (/شرق|east/i.test(text)) return "east";
  if (/غرب|west/i.test(text)) return "west";
  return null;
}

function extractSectorNumber(text) {
  // نبحث عن رقم قريب من كلمة الجهة نفسها عشان ما نلتقط رقم هاتف غلط
  const areaMatch = text.match(/(?:شرق|غرب|شامخ\S*|مفرق)\s*(\d{1,3})/);
  if (areaMatch) return parseInt(areaMatch[1], 10);
  const wordMatch = text.match(/(?:شرق|غرب|شامخ\S*|مفرق)\s+(\S+)/);
  if (wordMatch && AR_NUM_WORDS[wordMatch[1]] != null) return AR_NUM_WORDS[wordMatch[1]];
  return undefined;
}

function extractRating(text) {
  const digit = text.match(/تقييم\D{0,10}(\d(?:\.\d)?)/);
  if (digit) return parseFloat(digit[1]);
  const words = { "نجمة": 1, "نجمتين": 2, ...Object.fromEntries(Object.entries(AR_NUM_WORDS).map(([k, v]) => [k, v])) };
  const starMatch = text.match(/(\S+)\s*نجوم|(\S+)\s*نجمة/);
  if (starMatch) {
    const w = starMatch[1] || starMatch[2];
    if (words[w] != null) return words[w];
  }
  return undefined;
}

function extractPhone(text) {
  const m = text.match(/\b(05\d{8}|0[2-9]\d{6,7}|800\d{3,7})\b/);
  return m ? m[1] : "";
}

function extractHours(text) {
  const m = text.match(/يفتح[^\n]*?يسكر[^\n,،.]*/);
  return m ? m[0].trim() : "";
}

function extractCoords(text) {
  // أي رقمين عشريين بمدى إحداثيات الإمارات تقريبًا (خط عرض 22-27، خط طول 50-58)
  const nums = [...text.matchAll(/(\d{2}\.\d{4,})/g)].map(m => parseFloat(m[1]));
  for (let i = 0; i < nums.length - 1; i++) {
    const a = nums[i], b = nums[i + 1];
    if (a >= 22 && a <= 27 && b >= 50 && b <= 58) return { lat: a, lon: b };
    if (b >= 22 && b <= 27 && a >= 50 && a <= 58) return { lat: b, lon: a }; // بترتيب معكوس أحيانًا
  }
  return null;
}

function cleanUrl(u) {
  let s = String(u || "").trim().replace(/[\s،,.;)]+$/g, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) {
    if (!/^www[.,]|\.[a-z]{2,}(\/|$)/i.test(s)) return "";
    s = "https://" + s;
  }
  s = s.replace(/^(https?:\/\/[^\/?#]*)/i, m => m.replace(/,/g, "."));
  try {
    const x = new URL(s);
    if (!/^https?:$/.test(x.protocol) || !x.hostname.includes(".")) return "";
    return x.href;
  } catch { return ""; }
}

function extractWebsite(text) {
  const m = text.match(/(?:https?:\/\/|www[.,])[^\s،]+/i);
  return m ? { raw: m[0], url: cleanUrl(m[0]) } : null;
}

function parseBlock(block) {
  const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const name = lines[0].replace(/^[-*•]\s*/, "");
  const rest = lines.slice(1).join(" ");
  // نستخرج الرابط أولًا ونشيله من النص عشان ما يلخبط التقاط الجهة/الأرقام (مثلاً east داخل الرابط)
  const site = extractWebsite(block);
  const whole = site ? block.replace(site.raw, " ") : block;

  const coords = extractCoords(whole);
  if (!coords) {
    console.warn(`⚠️  تجاهلت "${name}" — ما لقيت إحداثيات صالحة.`);
    return null;
  }

  const area = detectAreaDir(whole);
  const num = area ? extractSectorNumber(whole) : undefined;

  const entry = {
    name,
    phone: extractPhone(whole),
    rating: extractRating(whole),
    hours: extractHours(whole),
    website: site ? site.url : undefined,
    lat: coords.lat,
    lon: coords.lon,
  };
  if (area) entry.area = area;
  if (num != null) entry.num = num;
  // نحذف الحقول الفاضية/غير المعروفة بدل ما نخزنها undefined
  for (const k of Object.keys(entry)) if (entry[k] === undefined || entry[k] === "") delete entry[k];
  return entry;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("الاستخدام: node add-workshops.js path/to/new-workshops.txt");
    process.exit(1);
  }
  const raw = readFileSync(file, "utf8");
  const blocks = raw.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);

  const newEntries = blocks.map(parseBlock).filter(Boolean);
  if (!newEntries.length) {
    console.log("ما لقيت أي ورشة صالحة بالملف.");
    return;
  }

  const existing = existsSync(DATA_PATH) ? JSON.parse(readFileSync(DATA_PATH, "utf8")) : [];
  const merged = [...existing, ...newEntries];
  writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2), "utf8");

  console.log(`✅ أضفت ${newEntries.length} ورشة جديدة إلى ${DATA_PATH}`);
  console.log("راجعها بسرعة قبل ما ترفع التحديث:\n");
  console.log(JSON.stringify(newEntries, null, 2));
}

main();
