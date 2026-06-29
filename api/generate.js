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

  const prompt = `Sen tarafsız bir haber editörü asistanısın. Aşağıdaki gündem konusunu dengeli ve KISA biçimde yapılandır.

KONU: "${topic.trim()}"
KATEGORİ: ${category || "DİĞER"}

ÜSLUP KURALLARI (çok önemli):
- Kısa, net, yalın cümleler kur. Gereksiz sıfat ve dolgu kelime kullanma.
- Her alan EN FAZLA 2 kısa cümle olsun. Mümkünse tek cümle.
- Akıcı, doğrudan ve anlaşılır yaz. Karmaşık, uzun cümlelerden kaçın.
- Mobil ekranda hızlı okunmalı.

DENGE DENETİMİ (yayınlamadan önce KENDİ KENDİNE yap):
Yanıtı oluşturduktan sonra, son hali vermeden önce şunları zihninde kontrol et ve gerekirse düzelt:
- İki taraf (destekleyen ve karşı) EŞİT GÜÇTE mi? Her iki argümanı da en güçlü, en makul haliyle yaz (steelman). Bir tarafı zayıf, gülünç veya kolay çürütülür biçimde sunma.
- İki argümanın uzunluğu ve tonu benzer mi? Biri uzun ve ikna edici, diğeri kısa ve güçsüz olmasın.
- Yanlı, küçümseyici, alaycı veya yönlendirici dil var mı? Varsa nötrle.
- Özet ve uzman görüşü tarafsız mı? Uzman görüşü gizliden bir tarafı desteklemesin; gerçekten dengeleyici olsun.
Bu denetimi geçtikten sonra düzeltilmiş, dengeli son hali ver.

HASSASİYET KURALLARI (hukuki risk — çok önemli):
- Kanıtlanmamış kişisel suçlama veya iddiaları GERÇEK gibi sunma. Belirli bir kişiyi (isimle) suçlayan, itham eden veya hakkında kanıtlanmamış iddia içeren bir konuysa, başlığı kişiyi hedef almadan, GENEL POLİTİKA/İLKE tartışmasına çevir.
- Örnek: "X kişisi rüşvet aldı mı?" yerine → konuyu "Kamu görevlilerinin denetimi nasıl olmalı?" gibi genel ve tarafsız bir çerçeveye taşı.
- Kişilerin özel hayatı, sağlığı, cinsel yönelimi gibi konuları işleme.
- Devam eden bir yargı sürecini "suçlu/masum" diye sunma; masumiyet karinesini koru.

Şunları üret:
1. title: Tarafsız, net başlık, soru biçiminde (max 70 karakter)
2. summary: Konunun özü, tarafsız, en fazla 2 kısa cümle
3. forArgument: DESTEKLEYENLERİN en güçlü argümanı, en fazla 2 kısa cümle
4. againstArgument: KARŞI ÇIKANLARIN en güçlü argümanı, en fazla 2 kısa cümle
5. expertRole: Genel uzmanlık alanı (GERÇEK KİŞİ İSMİ KULLANMA, örn: "Anayasa Hukuku Akademisyeni")
6. expertOpinion: Tarafsız, dengeleyici değerlendirme, en fazla 2 kısa cümle

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
