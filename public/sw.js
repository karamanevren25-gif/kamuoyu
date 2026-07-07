// Reyy Service Worker — basit ve güvenli sürüm
// Görevi: uygulama kabuğunu önbelleğe almak, çevrimdışıyken nazik bir ekran göstermek.
// Veri istekleri (Supabase/API) HER ZAMAN ağdan gider, asla önbellekten dönmez.

const CACHE = "reyy-shell-v1";
const OFFLINE_URL = "/offline.html";
const SHELL = ["/", "/offline.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Sadece kendi sitemizin GET isteklerine karışırız
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  // Sayfa gezinmeleri: önce ağ, olmazsa çevrimdışı ekranı
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Statik dosyalar: önce ağ (her zaman güncel), olmazsa önbellek
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
