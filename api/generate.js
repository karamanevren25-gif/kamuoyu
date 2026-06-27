// Güvenli aracı: API anahtarını gizli tutarak Claude'a istek atar.
// Vercel bu dosyayı otomatik olarak /api/generate adresinde çalıştırır.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Yalnızca POST destekleniyor" });
    return;
  }

  const { topic, category } = req.body || {};
  if (!topic || !topic.trim()) {
    res.status(400).json({ error: "Konu boş olamaz" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Sunucuda API anahtarı ayarlanmamış (ANTHROPIC_API_KEY)" });
    return;
  }

  const prompt = `Sen tarafsız bir haber editörü asistanısın. Aşağıdaki gündem konusunu dengeli biçimde yapılandır.

KONU: "${topic.trim()}"
KATEGORİ: ${category || "DİĞER"}

Şunları üret:
1. title: Tarafsız, net başlık (max 100 karakter)
2. summary: Tarafsız özet, taraf tutmadan, 2-3 cümle
3. forArgument: DESTEKLEYENLERİN en güçlü argümanı, 2-3 cümle
4. againstArgument: KARŞI ÇIKANLARIN en güçlü argümanı, 2-3 cümle
5. expertRole: Genel uzmanlık alanı tanımı (GERÇEK KİŞİ İSMİ KULLANMA, örn: "Anayasa Hukuku Akademisyeni")
6. expertOpinion: O alandan tarafsız, dengeleyici değerlendirme, 2-3 cümle

SADECE şu JSON formatında yanıt ver, başka hiçbir metin ekleme:
{"title":"...","summary":"...","forArgument":"...","againstArgument":"...","expertRole":"...","expertOpinion":"..."}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      res.status(502).json({ error: "AI servisi hatası", detail: (data.error && data.error.message) || "" });
      return;
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "AI boş yanıt döndü" });
      return;
    }

    const clean = textBlock.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "Beklenmeyen hata: " + e.message });
  }
}
