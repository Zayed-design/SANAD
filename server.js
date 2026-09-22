import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

async function nearbyMechanics(lat, lon) {
  if (lat == null || lon == null) return [];
  const q = `[out:json][timeout:8];(nwr(around:7000,${lat},${lon})["shop"="car_repair"];nwr(around:7000,${lat},${lon})["craft"="car_repair"];nwr(around:7000,${lat},${lon})["amenity"="car_repair"];);out center tags;`;
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: q });
    const data = await r.json();
    const arr = (data.elements || []).map(x => {
      const la = x.lat ?? x.center?.lat, lo = x.lon ?? x.center?.lon, t = x.tags || {};
      return { name: t.name || t["name:ar"] || "ورشة سيارات", phone: t.phone || t["contact:phone"] || "", lat: la, lon: lo, distance: distance(lat, lon, la, lo) };
    }).filter(x => x.lat && x.lon).sort((a, b) => meters(a.distance) - meters(b.distance)).slice(0, 5);
    return arr;
  } catch { return []; }
}

function distance(a, b, c, d) { const R = 6371, rad = Math.PI / 180; const x = (c - a) * rad, y = (d - b) * rad; const h = Math.sin(x / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(y / 2) ** 2; return (R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))).toFixed(1) + " كم"; }
function meters(s) { return parseFloat(s) * 1000; }

app.post("/api/assist", async (req, res) => {
  const { message, latitude, longitude } = req.body || {};
  let services = [];
  const asksMechanic = /ميكانيك|ميكانيكي|ورشة|تصليح السيارة|سحب|ونش|قطعة غيار|خدمة سيارات/i.test(message || "");
  if (asksMechanic) services = await nearbyMechanics(latitude, longitude);

  if (!ai) {
    return res.json({ reply: "واجهة سند جاهزة، لكن الذكاء الاصطناعي غير مفعّل. أضف GEMINI_API_KEY في ملف .env ثم أعد التشغيل.", safety: "إذا كانت الحالة طارئة، اتصل مباشرة بالطوارئ.", services });
  }

  const location = latitude && longitude ? `موقع المستخدم التقريبي من GPS: ${latitude}, ${longitude}` : "لا يوجد موقع GPS متاح.";
  const serviceText = services.length ? JSON.stringify(services) : "لا توجد نتائج خدمات قريبة متاحة.";
  const systemInstruction = `أنت "سند"، مساعد سلامة وخدمات في الإمارات. هدفك مساعدة المستخدم بأقل عدد ممكن من الأسئلة. ابدأ دائمًا بالسلامة إذا كانت هناك خطورة. لا تدّعي أنك اتصلت بجهة حكومية أو أرسلت موقعًا ما لم يحدث ذلك فعليًا. إذا طلب المستخدم ميكانيكيًا أو خدمة قريبة، استخدم النتائج المرفقة ولا تخترع أسماء أو أرقامًا. إذا لم يوجد GPS، اطلب تفعيل الموقع فقط عندما يكون البحث القريب ضروريًا. كن مختصرًا وواضحًا بالعربية. عند الطوارئ اذكر أن الشرطة 999، الإسعاف 998، الدفاع المدني 997.\n${location}\nنتائج الخدمات القريبة: ${serviceText}`;

  try {
   const response = await ai.models.generateContent({
  model: "gemini-3.6-flash",
  contents: message,
  config: {
    systemInstruction: systemInstruction,
  }
});

    res.json({
      reply: response.text || "لم أحصل على رد.",
      services,
      safety: "المعلومات إرشادية وليست بديلًا عن خدمات الطوارئ أو فني مختص."
    });
  } catch (e) {
    console.error("Gemini Error:", e);
    res.status(500).json({
      reply: "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي. تحقق من GEMINI_API_KEY.",
      services
    });
  }
});

app.listen(PORT, () => console.log(`Sanad running on http://localhost:${PORT}`));