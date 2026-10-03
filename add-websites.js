// أداة لإضافة روابط المواقع الإلكترونية للورش الموجودة بملف workshops.json (بدون ما تعدّل الملف يدويًا).
//
// الاستخدام:
//   node add-websites.js path/to/websites.txt
//
// الصق بالملف النصي اسم الورشة ورابطها، بأي شكل من هذي الأشكال:
//
//   اسم الورشة
//   https://www.example.com
//
//   اسم ورشة ثانية | https://example.ae
//   Another Workshop - www.example2.com
//
// السكربت يطابق الاسم مع الورش الموجودة (يتجاهل الحروف الكبيرة/الصغيرة والرموز)، ويكتب الرابط بحقل "website".
// كل ما ما انطابق اسمه يُطبع بالنهاية عشان تعدّله وتعيد التشغيل. الرابط يُصلَّح تلقائيًا (مثل www,site → www.site).

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), "workshops.json");

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

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, "");
const URL_RE = /(?:https?:\/\/|www[.,])[^\s،]+/i;

const file = process.argv[2];
if (!file) { console.error("الاستخدام: node add-websites.js path/to/websites.txt"); process.exit(1); }

const lines = readFileSync(file, "utf8").split("\n").map(l => l.trim()).filter(Boolean);
const pairs = [];
let pendingName = "";
for (const line of lines) {
  const m = line.match(URL_RE);
  if (!m) { pendingName = line.replace(/^[-*•]\s*/, ""); continue; }
  const before = line.slice(0, m.index).replace(/[|\-–—:،,\s]+$/g, "").replace(/^[-*•]\s*/, "").trim();
  const name = before || pendingName;
  if (name) pairs.push({ name, raw: m[0], url: cleanUrl(m[0]) });
  pendingName = "";
}

const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
const unmatched = [], badUrl = [];
let touched = 0;
for (const p of pairs) {
  if (!p.url) { badUrl.push(p); continue; }
  const k = norm(p.name);
  let hits = data.filter(w => norm(w.name) === k);
  if (!hits.length && k.length >= 6) hits = data.filter(w => { const n = norm(w.name); return n.includes(k) || (n.length >= 6 && k.includes(n)); });
  if (!hits.length) { unmatched.push(p); continue; }
  hits.forEach(w => { w.website = p.url; touched++; });
  console.log(`✅ ${p.name} → ${p.url}${hits.length > 1 ? ` (${hits.length} فروع/تكرارات بنفس الاسم)` : ""}`);
}
writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
console.log(`\nتم تحديث ${touched} ورشة.`);
if (unmatched.length) { console.log("\n⚠️ ما انطابق اسمها مع أي ورشة:"); unmatched.forEach(p => console.log("  -", p.name, p.raw)); }
if (badUrl.length) { console.log("\n⚠️ رابط غير صالح:"); badUrl.forEach(p => console.log("  -", p.name, p.raw)); }
