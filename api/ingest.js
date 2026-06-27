// Otomatik haber besleme: RSS'ten başlıkları çeker, her birini AI ile
// dengeli karta dönüştürür ve veritabanına "pending" (onay bekliyor) olarak yazar.
// Vercel her gün bir kez (cron) bu adresi çağırır. Manuel test için ?secret=... ile de tetiklenebilir.

const SUPABASE_URL = "https://mzfnafgmlutucxnpuuzo.supabase.co";
const CATEGORIES = ["ANAYASA", "EKONOMİ", "EĞİTİM", "SAĞLIK", "DIŞ POLİTİKA", "ÇEVRE", "TEKNOLOJİ", "DİĞER"];
const DEFAULT_FEED = "https://news.google.com/rss?hl=tr&gl=TR&ceid=TR:tr";
const MAX_PER_RUN = 3; // her çalışmada en fazla kaç haber işlensin (zaman/maliyet sınırı)

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

function parseItems(xml, limit) {
  const items = [];
  const blocks = xml.split(/<item>/i).slice(1);
  for (const block of blocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    if (!titleMatch) continue;
    let title = decodeEntities(titleMatch[1]);
    // Google News başlık sonuna " - Kaynak" ekler; varsa kırp
    title = title.replace(/\s+-\s+[^-]{2,40}$/, "").trim();
    const link = linkMatch ? decodeEntities(linkMatch[1]) : "";
    if (title.length < 10) continue;
    items.push({ title, link });
    if (items.length >= limit) break;
  }
  return items;
}

async function generateCard(topic) {
  const prompt = `Sen tarafsız bir haber editörü asistanısın. Aşağıdaki haber başlığını dengeli ve KISA bir tartışma kartına dönüştür.

HABER: "${topic}"

ÜSLUP KURALLARI (çok önemli):
- Kısa, net, yalın cümleler kur. Gereksiz sıfat ve dolgu kelime kullanma.
- Her alan EN FAZLA 2 kısa cümle olsun. Mümkünse tek cümle.
- Mobil ekranda hızlı okunmalı.

DENGE DENETİMİ (yayınlamadan önce KENDİ KENDİNE yap):
Yanıtı oluşturduktan sonra, son hali vermeden önce şunları zihninde kontrol et ve gerekirse düzelt:
- İki taraf (destekleyen ve karşı) EŞİT GÜÇTE mi? Her iki argümanı da en güçlü, en makul haliyle yaz (steelman). Bir tarafı zayıf veya kolay çürütülür biçimde sunma.
- İki argümanın uzunluğu ve tonu benzer mi?
- Yanlı, küçümseyici, alaycı veya yönlendirici dil var mı? Varsa nötrle.
- Özet ve uzman görüşü tarafsız mı? Uzman görüşü gizliden bir tarafı desteklemesin.
Bu denetimi geçtikten sonra düzeltilmiş, dengeli son hali ver.

Şunları üret:
1. category: Şu listeden EN UYGUN olanı seç (sadece biri): ${CATEGORIES.join(", ")}
2. title: Tarafsız, net başlık, soru biçiminde (max 70 karakter)
3. summary: Konunun özü, tarafsız, en fazla 2 kısa cümle
4. forArgument: DESTEKLEYENLERİN en güçlü argümanı, en fazla 2 kısa cümle
5. againstArgument: KARŞI ÇIKANLARIN en güçlü argümanı, en fazla 2 kısa cümle
6. expertRole: Genel uzmanlık alanı (GERÇEK KİŞİ İSMİ KULLANMA)
7. expertOpinion: Tarafsız değerlendirme, en fazla 2 kısa cümle

Eğer başlık siyasi/toplumsal bir tartışmaya uygun DEĞİLSE (magazin, spor skoru, hava durumu, bireysel/adli olaylar gibi), sadece {"skip":true} döndür.

SADECE JSON döndür, başka metin ekleme:
{"category":"...","title":"...","summary":"...","forArgument":"...","againstArgument":"...","expertRole":"...","expertOpinion":"..."}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data.error && data.error.message) || "AI hatası");
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("AI boş yanıt");
  return JSON.parse(textBlock.text.replace(/```json|```/g, "").trim());
}

export default async function handler(req, res) {
  // Güvenlik: sadece Vercel cron (Authorization header) veya doğru ?secret= ile çalışır
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  const querySecret = (req.query && req.query.secret) || "";
  const allowed = cronSecret && (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret);
  if (!allowed) {
    res.status(401).json({ error: "Yetkisiz istek" });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    res.status(500).json({ error: "SUPABASE_SERVICE_KEY ayarlanmamış" });
    return;
  }
  const sbHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  try {
    // 1) RSS'i çek ve başlıkları ayıkla
    const feedUrl = process.env.NEWS_RSS_URL || DEFAULT_FEED;
    const feedRes = await fetch(feedUrl, { headers: { "User-Agent": "KamuoyuBot/1.0" } });
    const xml = await feedRes.text();
    const items = parseItems(xml, MAX_PER_RUN * 4); // biraz fazla al, tekrarları eleyince azalır

    // 2) Daha önce eklenenleri (tekrar engelleme) topla
    const existRes = await fetch(`${SUPABASE_URL}/rest/v1/topics?select=source_url`, { headers: sbHeaders });
    const existing = existRes.ok ? await existRes.json() : [];
    const seen = new Set(existing.map((r) => r.source_url).filter(Boolean));

    // 3) Yeni başlıkları işle
    const results = { added: 0, skipped: 0, errors: 0, titles: [] };
    for (const item of items) {
      if (results.added >= MAX_PER_RUN) break;
      if (!item.link || seen.has(item.link)) { results.skipped++; continue; }

      try {
        const card = await generateCard(item.title);
        if (card.skip) { results.skipped++; seen.add(item.link); continue; }

        const category = CATEGORIES.includes(card.category) ? card.category : "DİĞER";
        const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/topics`, {
          method: "POST",
          headers: { ...sbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({
            category,
            title: card.title || item.title,
            summary: card.summary || "",
            for_text: card.forArgument || "",
            against_text: card.againstArgument || "",
            expert_role: card.expertRole || "Uzman Değerlendirmesi",
            expert_text: card.expertOpinion || "",
            status: "pending",
            source_url: item.link,
          }),
        });
        if (!insertRes.ok) { results.errors++; continue; }
        results.added++;
        results.titles.push(card.title || item.title);
        seen.add(item.link);
      } catch (e) {
        results.errors++;
      }
    }

    res.status(200).json({ ok: true, ...results });
  } catch (e) {
    res.status(500).json({ error: "Beslenme hatası: " + e.message });
  }
}
