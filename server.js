import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

const KINDS = [
  { test: /ميكانيك|ورشة|تصليح السيارة|سحب|ونش|قطع غيار|خدمة سيارات/, tags: ['["shop"="car_repair"]', '["craft"="car_repair"]', '["amenity"="car_repair"]'], fallback: "ورشة سيارات" },
  { test: /مستشفى|عيادة|مركز صحي/, tags: ['["amenity"="hospital"]', '["amenity"="clinic"]'], fallback: "منشأة صحية" },
];

function meters(a, b, c, d) {
  const R = 6371000, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function nearby(kind, lat, lon) {
  const around = kind.tags.map(t => `nwr(around:7000,${lat},${lon})${t};`).join("");
  const q = `[out:json][timeout:10];(${around});out center tags;`;
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.elements || [])
      .map(x => {
        const la = x.lat ?? x.center?.lat, lo = x.lon ?? x.center?.lon, t = x.tags || {};
        return { name: t["name:ar"] || t.name || kind.fallback, phone: t.phone || t["contact:phone"] || "", lat: la, lon: lo, m: la && lo ? meters(lat, lon, la, lo) : Infinity };
      })
      .filter(x => Number.isFinite(x.m))
      .sort((a, b) => a.m - b.m)
      .slice(0, 5)
      .map(({ m, ...s }) => ({ ...s, distance: (m / 1000).toFixed(1) + " كم" }));
  } catch { return []; }
}

app.post("/api/assist", async (req, res) => {
  const { message, latitude, longitude } = req.body || {};
  const text = String(message || "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({ reply: "اكتب رسالتك أولًا." });

  const la = Number(latitude), lo = Number(longitude);
  const hasLoc = latitude != null && longitude != null && Number.isFinite(la) && Number.isFinite(lo);
  const kind = KINDS.find(k => k.test.test(text));
  const services = kind && hasLoc ? await nearby(kind, la, lo) : [];

  if (!ai) {
    return res.json({ reply: "الذكاء الاصطناعي غير مفعّل. أضف GEMINI_API_KEY في ملف .env ثم أعد تشغيل الخادم. للطوارئ اتصل بـ 999.", services });
  }

  const location = hasLoc ? `موقع المستخدم من GPS: ${la}, ${lo}` : "لا يوجد موقع GPS متاح.";
  const serviceText = services.length ? JSON.stringify(services) : "لا توجد نتائج خدمات قريبة.";
  const systemInstruction = `أنت "سند"، مساعد سلامة وخدمات في الإمارات. ساعد المستخدم بأقل عدد ممكن من الأسئلة. ابدأ بالسلامة إذا كانت هناك خطورة. لا تدّعي أنك اتصلت بجهة أو أرسلت موقعًا. إذا طلب خدمة قريبة فاستخدم النتائج المرفقة فقط ولا تخترع أسماء أو أرقامًا. إذا لم يوجد GPS فاطلب منه الضغط على زر "موقعي" عندما يكون البحث القريب ضروريًا. أجب بالعربية باختصار ووضوح. أرقام الطوارئ: الشرطة 999، الإسعاف 998، الدفاع المدني 997.\n${location}\nنتائج الخدمات القريبة: ${serviceText}`;

  try {
    const response = await ai.models.generateContent({ model: MODEL, contents: text, config: { systemInstruction } });
    res.json({ reply: response.text || "لم أحصل على رد.", services });
  } catch (e) {
    console.error("Gemini error:", e);
    res.status(500).json({ reply: "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي. تحقق من GEMINI_API_KEY واسم النموذج.", services });
  }
});

app.listen(PORT, () => console.log(`Sanad running on http://localhost:${PORT}`));
