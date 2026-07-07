import { useState, useEffect, useRef } from "react";

/* ════════ SUPABASE BAĞLANTISI ════════ */
const SUPABASE_URL = "https://mzfnafgmlutucxnpuuzo.supabase.co";
const SUPABASE_KEY = "sb_publishable_BdT_E38q0e2Ieb5lrDiUVA_kksMkRhv";
const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH = `${SUPABASE_URL}/auth/v1`;

// Giriş yapılınca buraya yöneticinin oturum anahtarı (token) yazılır.
// Yoksa genel (publishable) anahtar kullanılır — sadece yayındakiler okunabilir.
let currentToken = null;

function authHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${currentToken || SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

/* ── Giriş / Oturum işlemleri ── */
async function signIn(email, password) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Giriş başarısız");
  currentToken = data.access_token;
  try { localStorage.setItem("kamuoyu_refresh", data.refresh_token); } catch (e) {}
  return data.user;
}

async function restoreSession() {
  let refresh = null;
  try { refresh = localStorage.getItem("kamuoyu_refresh"); } catch (e) {}
  if (!refresh) return null;
  try {
    const res = await fetch(`${AUTH}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error("oturum süresi dolmuş");
    currentToken = data.access_token;
    try { localStorage.setItem("kamuoyu_refresh", data.refresh_token); } catch (e) {}
    return data.user;
  } catch (e) {
    try { localStorage.removeItem("kamuoyu_refresh"); } catch (e2) {}
    return null;
  }
}

function signOut() {
  currentToken = null;
  try { localStorage.removeItem("kamuoyu_refresh"); } catch (e) {}
}

// Veritabanı satırını arayüz biçimine çevir
const fromRow = (r) => ({
  id: r.id,
  category: r.category,
  title: r.title,
  summary: r.summary,
  status: r.status,
  source: r.source_url || "",
  for: { text: r.for_text || "" },
  against: { text: r.against_text || "" },
  expert: { author: r.expert_role || "Uzman Değerlendirmesi", text: r.expert_text || "" },
});

async function dbGet(status) {
  const url = status
    ? `${REST}/topics?status=eq.${status}&select=*&order=created_at.desc`
    : `${REST}/topics?select=*&order=created_at.desc`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${res.status}`);
  return (await res.json()).map(fromRow);
}

async function dbInsert(topic) {
  const body = {
    category: topic.category,
    title: topic.title,
    summary: topic.summary,
    for_text: topic.for.text,
    against_text: topic.against.text,
    expert_role: topic.expert.author,
    expert_text: topic.expert.text,
    source_url: topic.source ? topic.source.trim() : null,
    status: topic.status || "pending",
  };
  const res = await fetch(`${REST}/topics`, {
    method: "POST",
    headers: { ...authHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`INSERT ${res.status}`);
  return fromRow((await res.json())[0]);
}

async function dbUpdateStatus(id, status) {
  const res = await fetch(`${REST}/topics?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`UPDATE ${res.status}`);
}

async function dbDelete(id) {
  const res = await fetch(`${REST}/topics?id=eq.${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(`DELETE ${res.status}`);
}

/* ── Oylama ── */
const DIR_TO_VOTE = { right: "for", left: "against", down: "neutral" };

function getVoterId() {
  try {
    let id = localStorage.getItem("kamuoyu_voter");
    if (!id) {
      id = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("kamuoyu_voter", id);
    }
    return id;
  } catch (e) {
    return "v_" + Math.random().toString(36).slice(2);
  }
}

async function castVote(topicId, voterId, direction) {
  const res = await fetch(`${REST}/rpc/cast_vote`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ p_topic_id: topicId, p_voter_id: voterId, p_direction: direction }),
  });
  if (!res.ok) throw new Error(`VOTE ${res.status}`);
  const rows = await res.json();
  const r = Array.isArray(rows) ? rows[0] : rows;
  return {
    for: Number(r.for_count) || 0,
    against: Number(r.against_count) || 0,
    neutral: Number(r.neutral_count) || 0,
    alreadyVoted: !!r.already_voted,
  };
}

async function getVotedTopics(voterId) {
  const res = await fetch(`${REST}/rpc/get_voted_topics`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ p_voter_id: voterId }),
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).map((r) => (r && typeof r === "object" ? r.topic_id : r));
}

const CATEGORIES = ["HUKUK", "SİYASET", "EKONOMİ", "EĞİTİM", "SAĞLIK", "DIŞ POLİTİKA", "ÇEVRE", "TEKNOLOJİ", "MAGAZİN", "SPOR", "DİĞER"];
// Kategori renkleri — swipe renklerinden (yeşil/kırmızı/gri) kasıtlı olarak ayrı tonlar
const CAT_COLOR = {
  "HUKUK": "#8B7FD8",        // mor
  "SİYASET": "#C77DBB",      // pembe-mor
  "EKONOMİ": "#5BA3C7",      // mavi
  "EĞİTİM": "#5BC7B0",       // turkuaz
  "SAĞLIK": "#5FB87A",       // yeşilimsi (yumuşak)
  "DIŞ POLİTİKA": "#C79A5B", // koyu altın
  "ÇEVRE": "#7FB85B",        // fıstık yeşili
  "TEKNOLOJİ": "#6E8FD8",    // indigo
  "MAGAZİN": "#D87FA8",      // pembe
  "SPOR": "#D88F5B",         // turuncu
  "DİĞER": "#8893A8",        // nötr gri-mavi
};
const catColor = (c) => CAT_COLOR[c] || CAT_COLOR["DİĞER"];
const DIR = {
  right: { label: "DESTEKLE", color: "#4CAF7D", sign: "✓" },
  left: { label: "KARŞIYIM", color: "#E05A5A", sign: "✗" },
  down: { label: "FİKRİM YOK", color: "#6B7280", sign: "—" },
};
const STATUS_META = {
  pending: { label: "ONAY BEKLİYOR", color: "#E0A85A" },
  live: { label: "YAYINDA", color: "#4CAF7D" },
  rejected: { label: "REDDEDİLDİ", color: "#6B7280" },
};
const THRESHOLD = 85;

/* ════════ SWIPE DECK ════════ */
function SwipeDeck({ topics, loading, error, onRetry }) {
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [swipeDir, setSwipeDir] = useState(null);
  const [history, setHistory] = useState([]);
  const [done, setDone] = useState(false);
  const [expertOpen, setExpertOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(null);
  const [voted, setVoted] = useState(null); // { dir, counts } — oy sonrası sonuç ekranı
  const [shareMsg, setShareMsg] = useState(null);
  const [filter, setFilter] = useState([]); // seçili kategoriler; boşsa hepsi
  const [votedIds, setVotedIds] = useState(() => new Set()); // bu cihazın daha önce oyladığı konular
  const flying = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const voterId = useRef(getVoterId());

  // Açılışta: bu ziyaretçinin daha önce oyladığı konuları öğren (oylananlar tekrar gösterilmez)
  useEffect(() => {
    getVotedTopics(voterId.current)
      .then((ids) => setVotedIds(new Set(ids)))
      .catch(() => {});
  }, []);

  // Filtreye göre gösterilecek konular (daha önce oylananlar hariç)
  const deck = (filter.length ? topics.filter(t => filter.includes(t.category)) : topics).filter(t => !votedIds.has(t.id));
  // Filtre çubuğunda gösterilecek mevcut kategoriler (yayındaki konulardan, sabit sıra)
  const availableCats = CATEGORIES.filter(c => topics.some(t => t.category === c));
  const toggleCat = (c) => setFilter(f => (f.includes(c) ? f.filter(x => x !== c) : [...f, c]));

  useEffect(() => { setIdx(0); setHistory([]); setDone(false); setVoted(null); }, [topics, filter.join(",")]);

  const topic = deck[idx];
  const getDir = (x, y) => {
    if (y > 50 && Math.abs(x) < y * 0.9) return "down";
    if (Math.abs(x) > 35) return x > 0 ? "right" : "left";
    return null;
  };
  const onStart = (cx, cy) => { if (flying.current || voted) return; start.current = { x: cx, y: cy }; setDragging(true); setDrag({ x: 0, y: 0 }); setPanelOpen(null); setExpertOpen(false); };
  const onMove = (cx, cy) => { if (!dragging || flying.current) return; const x = cx - start.current.x, y = cy - start.current.y; setDrag({ x, y }); setSwipeDir(getDir(x, y)); };
  const onEnd = () => {
    if (!dragging) return;
    setDragging(false);
    const dir = getDir(drag.x, drag.y);
    const over = dir === "down" ? drag.y > THRESHOLD : Math.abs(drag.x) > THRESHOLD;
    if (dir && over) commit(dir); else { setDrag({ x: 0, y: 0 }); setSwipeDir(null); }
  };
  const commit = (dir) => {
    flying.current = true;
    setDrag({ x: dir === "right" ? 500 : dir === "left" ? -500 : 0, y: dir === "down" ? 500 : 0 });
    castVote(topic.id, voterId.current, DIR_TO_VOTE[dir])
      .then((counts) => {
        setTimeout(() => { flying.current = false; setVoted({ dir, counts }); setDrag({ x: 0, y: 0 }); setSwipeDir(null); }, 380);
      })
      .catch(() => {
        setTimeout(() => { flying.current = false; setVoted({ dir, counts: null }); setDrag({ x: 0, y: 0 }); setSwipeDir(null); }, 380);
      });
  };
  const proceed = () => {
    setHistory(h => [...h, { title: topic.title, dir: voted.dir }]);
    setVoted(null);
    // Bu konuyu kalıcı olarak "oylandı" işaretle — desteden düşer, tekrar gösterilmez
    const newLen = deck.length - 1; // bu konu çıkınca kalan sayı
    setVotedIds(s => { const n = new Set(s); n.add(topic.id); return n; });
    if (newLen <= 0) { setDone(true); return; }
    // Konu desteden çıktığı için sıradaki konu aynı indekse kayar; sadece taşmayı önle
    if (idx >= newLen) setIdx(0);
  };

  async function shareTopic() {
    const url = "https://reyyapp.com";
    const counts = voted && voted.counts;
    let text;
    if (counts) {
      const tot = counts.for + counts.against + counts.neutral;
      const pf = tot ? Math.round((counts.for / tot) * 100) : 0;
      const pa = tot ? Math.round((counts.against / tot) * 100) : 0;
      text = `${topic.title}\n\n%${pf} destekliyor, %${pa} karşı çıkıyor. Sen ne dersin? Reyy'de oyla 👇`;
    } else {
      text = `${topic.title}\n\nSen ne düşünüyorsun? Reyy'de oyla 👇`;
    }
    try {
      if (navigator.share) {
        await navigator.share({ title: "Reyy", text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setShareMsg("Bağlantı kopyalandı ✓");
        setTimeout(() => setShareMsg(null), 2000);
      }
    } catch (e) { /* kullanıcı vazgeçti veya desteklenmiyor */ }
  }

  // Filtre çubuğu (birden fazla kategori varsa göster)
  const onWheelScroll = (e) => {
    // Webde fare tekerleğini yatay kaydırmaya çevir
    if (e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY;
    }
  };
  const filterBar = availableCats.length > 1 ? (
    <div style={S.filterBar} onWheel={onWheelScroll}>
      <button style={{ ...S.chip, ...(filter.length === 0 ? S.chipAllActive : S.chipInactive) }} onClick={() => setFilter([])}>Tümü</button>
      {availableCats.map((c) => {
        const on = filter.includes(c);
        return (
          <button key={c} onClick={() => toggleCat(c)}
            style={{ ...S.chip, color: on ? "#0A0F1A" : catColor(c), background: on ? catColor(c) : catColor(c) + "1A", borderColor: catColor(c) + "55", fontWeight: on ? 800 : 700 }}>
            {c}
          </button>
        );
      })}
    </div>
  ) : null;

  if (loading) return <div style={S.loading}>Konular yükleniyor…</div>;
  if (!topics.length) return (
    <div style={S.emptyState}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{error ? "📡" : "📭"}</div>
      <p style={{ color: "#9CA3AF", fontSize: 14, textAlign: "center", lineHeight: 1.6 }}>
        {error
          ? <>Şu an konulara ulaşılamıyor.<br />İnternet bağlantını kontrol edip tekrar dene.</>
          : <>Henüz yayında konu yok.<br />Yakında yeni konular eklenecek.</>}
      </p>
      {error && onRetry && (
        <button style={{ ...S.resetBtn, width: "auto", padding: "11px 28px" }} onClick={onRetry}>Yenile</button>
      )}
    </div>
  );

  // Deste boş: ya tüm konular oylandı ya da filtre daralttı
  if (!deck.length) {
    const filteredAll = filter.length ? topics.filter(t => filter.includes(t.category)) : topics;
    const allVoted = filteredAll.length > 0 && filteredAll.every(t => votedIds.has(t.id));
    return (
      <div style={S.deckRoot}>
        {filterBar}
        <div style={S.emptyState}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>{allVoted ? "🎉" : "🔍"}</div>
          <p style={{ color: "#9CA3AF", fontSize: 14, textAlign: "center", lineHeight: 1.6 }}>
            {allVoted
              ? <>Şimdilik hepsi bu kadar — tüm konuları oyladın!<br />Yeni konular eklendikçe burada olacak.</>
              : <>Bu filtreye uygun konu yok.<br />Başka bir kategori seç veya "Tümü"ne dön.</>}
          </p>
          <div style={S.footerLinks}>
            <a href="/hakkinda.html" target="_blank" rel="noreferrer" style={S.footerLink}>Hakkında</a>
            <span style={{ opacity: 0.3 }}>·</span>
            <a href="/gizlilik.html" target="_blank" rel="noreferrer" style={S.footerLink}>Gizlilik</a>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    const c = { right: 0, left: 0, down: 0 };
    history.forEach(h => c[h.dir]++);
    return (
      <div style={S.resultWrap}>
        <div style={S.resultEmoji}>📊</div>
        <h2 style={S.resultHeading}>Oylamalar Tamamlandı</h2>
        {["right", "left", "down"].map(d => (
          <div key={d} style={S.resultRow}>
            <span style={{ color: DIR[d].color }}>{DIR[d].sign} {DIR[d].label}</span>
            <strong style={{ color: "#F9FAFB", fontSize: 18 }}>{c[d]}</strong>
          </div>
        ))}
        <p style={{ color: "#6B7280", fontSize: 12.5, textAlign: "center", lineHeight: 1.6, marginTop: 18 }}>
          Yeni konular eklendikçe burada olacak. 👋
        </p>
        <div style={S.footerLinks}>
          <a href="/hakkinda.html" target="_blank" rel="noreferrer" style={S.footerLink}>Hakkında</a>
          <span style={{ opacity: 0.3 }}>·</span>
          <a href="/gizlilik.html" target="_blank" rel="noreferrer" style={S.footerLink}>Gizlilik</a>
        </div>
      </div>
    );
  }

  /* ── OY SONRASI SONUÇ EKRANI ── */
  if (voted) {
    const counts = voted.counts;
    const total = counts ? counts.for + counts.against + counts.neutral : 0;
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
    const rows = [
      { key: "for", dir: "right", value: counts ? counts.for : 0 },
      { key: "against", dir: "left", value: counts ? counts.against : 0 },
      { key: "neutral", dir: "down", value: counts ? counts.neutral : 0 },
    ];
    const myVote = DIR_TO_VOTE[voted.dir];
    return (
      <div style={S.deckRoot}>
        {filterBar}
        <div style={S.expertBar}>
          <div style={S.expertLabel}><span style={S.expertIcon}>↑</span> UZMAN GÖRÜŞÜ · <span style={S.expertAuthor}>{topic.expert.author}</span></div>
        </div>
        <div style={S.arena}>
          <div style={{ ...S.card, cursor: "default" }}>
            <div style={{ ...S.categoryTag, color: catColor(topic.category), background: catColor(topic.category) + "22" }}>{topic.category}</div>
            <h1 style={{ ...S.cardTitle, marginBottom: 18 }}>{topic.title}</h1>
            <div style={S.voteResultLabel}>{counts ? "Sonuçlar" : "Senin oyun kaydedildi"}</div>
            {rows.map((r) => {
              const isMine = r.key === myVote;
              const p = pct(r.value);
              return (
                <div key={r.key} style={{ marginBottom: 12 }}>
                  <div style={S.voteRowTop}>
                    <span style={{ color: DIR[r.dir].color, fontWeight: isMine ? 800 : 600 }}>
                      {DIR[r.dir].sign} {DIR[r.dir].label} {isMine && <span style={S.youTag}>· SEN</span>}
                    </span>
                    <span style={{ color: "#F9FAFB", fontWeight: 700 }}>{counts ? `%${p}` : (isMine ? "✓" : "—")}</span>
                  </div>
                  <div style={S.voteBarBg}>
                    <div style={{ ...S.voteBarFill, width: counts ? `${p}%` : (isMine ? "100%" : "0%"), background: DIR[r.dir].color, opacity: isMine ? 1 : 0.55 }} />
                  </div>
                </div>
              );
            })}
            <div style={S.voteTotal}>{counts ? `${total} kişi oyladı` : "Sonuç şu an gösterilemiyor"}</div>
            {topic.source && (
              <a href={topic.source} target="_blank" rel="noreferrer" style={{ ...S.sourceLink, display: "block", textAlign: "center", marginTop: 12, marginBottom: 0 }}>
                📰 Kaynak haberi gör ↗
              </a>
            )}
            <div style={S.voteActions}>
              <button style={S.shareBtn} onClick={shareTopic}>↗ Paylaş</button>
              <button style={S.continueBtnFlex} onClick={proceed}>Devam →</button>
            </div>
            {shareMsg && <div style={S.shareMsg}>{shareMsg}</div>}
          </div>
        </div>
        <div style={S.footer}>
          <div style={S.bar}><div style={{ ...S.fill, width: `${((idx + 1) / deck.length) * 100}%` }} /></div>
          <div style={S.counter}>{idx + 1} / {deck.length} konu</div>
        </div>
      </div>
    );
  }

  const rotation = drag.x / 22;
  const dOpacity = Math.min(Math.abs(drag.x) / THRESHOLD, 1);
  const activeColor = swipeDir ? DIR[swipeDir].color : null;

  return (
    <div style={S.deckRoot}
      onMouseMove={e => onMove(e.clientX, e.clientY)} onMouseUp={onEnd} onMouseLeave={onEnd}
      onTouchMove={e => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }} onTouchEnd={onEnd}>
      {activeColor && <div style={{ ...S.glow, background: `radial-gradient(ellipse at ${swipeDir === "right" ? "80%" : swipeDir === "left" ? "20%" : "50%"} 50%, ${activeColor}22 0%, transparent 65%)` }} />}
      {filterBar}
      <div style={S.expertBar} onClick={() => setExpertOpen(o => !o)}>
        <div style={S.expertLabel}>
          <span style={S.expertIcon}>↑</span>
          UZMAN GÖRÜŞÜ · <span style={S.expertAuthor}>{topic.expert.author}</span>
          <span style={{ marginLeft: "auto", opacity: 0.5 }}>{expertOpen ? "▲" : "▼"}</span>
        </div>
        {expertOpen && <p style={S.expertBody}>{topic.expert.text}</p>}
      </div>
      <div style={S.arena}>
        <div style={S.cardGroup}>
          <div style={{
            ...S.card,
            transform: `translateX(${drag.x}px) translateY(${Math.max(drag.y * 0.35, 0)}px) rotate(${rotation}deg)`,
            transition: dragging || flying.current ? (flying.current ? "transform 0.38s cubic-bezier(0.4,0,1,1)" : "box-shadow 0.1s") : "transform 0.35s cubic-bezier(0.175,0.885,0.32,1.275)",
            boxShadow: activeColor ? `0 24px 72px ${activeColor}55` : "0 20px 60px rgba(0,0,0,0.55)",
            borderColor: activeColor ? `${activeColor}50` : "rgba(255,255,255,0.07)",
            cursor: dragging ? "grabbing" : "grab",
          }}
            onMouseDown={e => onStart(e.clientX, e.clientY)} onTouchStart={e => onStart(e.touches[0].clientX, e.touches[0].clientY)}>
            {swipeDir === "right" && dOpacity > 0.1 && <div style={{ ...S.badge, color: DIR.right.color, borderColor: DIR.right.color, left: 18, top: 18, opacity: dOpacity }}>✓ DESTEKLE</div>}
            {swipeDir === "left" && dOpacity > 0.1 && <div style={{ ...S.badge, color: DIR.left.color, borderColor: DIR.left.color, right: 18, top: 18, left: "auto", opacity: dOpacity }}>✗ KARŞIYIM</div>}
            {swipeDir === "down" && drag.y > 30 && <div style={{ ...S.badge, color: DIR.down.color, borderColor: DIR.down.color, top: "50%", left: "50%", transform: "translate(-50%,-50%)", opacity: Math.min(drag.y / THRESHOLD, 1) }}>— FİKRİM YOK</div>}
            <div style={{ ...S.categoryTag, color: catColor(topic.category), background: catColor(topic.category) + "22" }}>{topic.category}</div>
            <h1 style={S.cardTitle}>{topic.title}</h1>
            <p style={S.cardBody}>{topic.summary}</p>
            {topic.source && (
              <a href={topic.source} target="_blank" rel="noreferrer" style={S.sourceLink}
                onMouseDown={e => e.stopPropagation()}
                onTouchStart={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}>
                📰 Kaynak haberi gör ↗
              </a>
            )}
            <div style={S.hints}>
              <span style={{ color: DIR.left.color }}>← Karşıyım</span>
              <span style={{ color: DIR.down.color }}>↓ Fikrim yok</span>
              <span style={{ color: DIR.right.color }}>Destekle →</span>
            </div>
          </div>

          {/* İki görüş — okunabilir kutular */}
          <div style={S.viewsRow}>
            <div style={{ ...S.viewBox, borderColor: `${DIR.left.color}33` }}>
              <div style={{ ...S.viewTag, color: DIR.left.color }}>✗ KARŞIYIM</div>
              <p style={S.viewText}>{topic.against.text}</p>
            </div>
            <div style={{ ...S.viewBox, borderColor: `${DIR.right.color}33` }}>
              <div style={{ ...S.viewTag, color: DIR.right.color }}>✓ DESTEKLE</div>
              <p style={S.viewText}>{topic.for.text}</p>
            </div>
          </div>
        </div>
      </div>
      <div style={S.footer}>
        <div style={S.bar}><div style={{ ...S.fill, width: `${(idx / deck.length) * 100}%` }} /></div>
        <div style={S.counter}>{idx + 1} / {deck.length} konu</div>
      </div>
    </div>
  );
}

/* ════════ ADMIN PANEL ════════ */
function AdminPanel({ allTopics, reload, conn }) {
  const [input, setInput] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [draft, setDraft] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function generateDraft() {
    if (!input.trim() || generating) return;
    setGenerating(true); setError(null); setDraft(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: input.trim(), category }),
      });
      const parsed = await response.json();
      if (!response.ok) {
        throw new Error(parsed.error || "Bilinmeyen hata");
      }
      setDraft({
        category, title: parsed.title || "", summary: parsed.summary || "",
        for: { text: parsed.forArgument || "" }, against: { text: parsed.againstArgument || "" },
        expert: { author: parsed.expertRole || "Uzman Değerlendirmesi", text: parsed.expertOpinion || "" },
        source: "",
      });
    } catch (e) {
      setError("Taslak oluşturulamadı: " + e.message);
    } finally { setGenerating(false); }
  }

  async function saveDraft(status) {
    if (!draft || busy) return;
    setBusy(true); setError(null);
    try {
      await dbInsert({ ...draft, status });
      setDraft(null); setInput("");
      await reload();
    } catch (e) {
      setError("Veritabanına kaydedilemedi: " + e.message);
    } finally { setBusy(false); }
  }

  async function changeStatus(id, status) {
    setBusy(true);
    try { await dbUpdateStatus(id, status); await reload(); }
    catch (e) { setError("Güncellenemedi: " + e.message); }
    finally { setBusy(false); }
  }
  async function remove(id) {
    setBusy(true);
    try { await dbDelete(id); await reload(); }
    catch (e) { setError("Silinemedi: " + e.message); }
    finally { setBusy(false); }
  }

  const editField = (field, sub) => (e) =>
    setDraft(d => sub ? { ...d, [field]: { ...d[field], text: e.target.value } } : { ...d, [field]: e.target.value });

  const pending = allTopics.filter(t => t.status === "pending");
  const live = allTopics.filter(t => t.status === "live");

  return (
    <div style={S.adminRoot}>
      {/* Bağlantı durumu */}
      <div style={{ ...S.connBar, borderColor: conn === "ok" ? "rgba(76,175,125,0.3)" : conn === "error" ? "rgba(224,90,90,0.3)" : "rgba(255,255,255,0.1)" }}>
        <span style={{ color: conn === "ok" ? "#7ADCA8" : conn === "error" ? "#F09797" : "#9CA3AF" }}>
          {conn === "ok" ? "● Veritabanı bağlı" : conn === "error" ? "● Veritabanına bağlanılamadı" : "● Bağlanıyor…"}
        </span>
      </div>

      {/* Üretim */}
      <div style={S.adminSection}>
        <label style={S.label}>Haber başlığı / kısa konu</label>
        <textarea style={S.textarea} rows={2} placeholder="örn: Hükümet KDV oranını %20'ye çıkarmayı planlıyor" value={input} onChange={e => setInput(e.target.value)} />
        <div style={S.row}>
          <select style={S.select} value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button style={{ ...S.btn, ...S.btnPrimary, opacity: generating || !input.trim() ? 0.5 : 1 }} disabled={generating || !input.trim()} onClick={generateDraft}>
            {generating ? "Oluşturuluyor…" : "🤖 AI ile Taslak Oluştur"}
          </button>
        </div>
        {error && <p style={S.errorText}>{error}</p>}
      </div>

      {/* Taslak */}
      {draft && (
        <div style={S.draftWrap}>
          <div style={S.draftLabel}>TASLAK — DÜZENLE VE KAYDET</div>
          <div style={{ ...S.draftCategory, color: catColor(draft.category), background: catColor(draft.category) + "22" }}>{draft.category}</div>
          <textarea style={S.editTitle} rows={2} value={draft.title} onChange={editField("title")} />
          <textarea style={S.editBody} rows={3} value={draft.summary} onChange={editField("summary")} />
          <div style={S.editArgLabel}><span style={{ color: DIR.right.color }}>✓ DESTEKLEYEN GÖRÜŞ</span></div>
          <textarea style={S.editArg} rows={3} value={draft.for.text} onChange={editField("for", true)} />
          <div style={S.editArgLabel}><span style={{ color: DIR.left.color }}>✗ KARŞI GÖRÜŞ</span></div>
          <textarea style={S.editArg} rows={3} value={draft.against.text} onChange={editField("against", true)} />
          <div style={S.editArgLabel}>↑ UZMAN — <span style={{ opacity: 0.6 }}>{draft.expert.author}</span></div>
          <textarea style={S.editArg} rows={3} value={draft.expert.text} onChange={editField("expert", true)} />
          <div style={S.editArgLabel}>📰 KAYNAK LİNKİ <span style={{ opacity: 0.6 }}>(isteğe bağlı)</span></div>
          <input style={S.editSource} type="url" placeholder="https://haberkaynagi.com/haber..." value={draft.source || ""} onChange={editField("source")} />
          <div style={S.row}>
            <button style={{ ...S.btn, ...S.btnReject }} onClick={() => setDraft(null)} disabled={busy}>✗ İptal</button>
            <button style={{ ...S.btn, ...S.btnGhost }} onClick={() => saveDraft("pending")} disabled={busy}>⏳ Kuyruğa At</button>
            <button style={{ ...S.btn, ...S.btnApprove }} onClick={() => saveDraft("live")} disabled={busy}>✓ Onayla &amp; Yayınla</button>
          </div>
        </div>
      )}

      {/* Onay kuyruğu */}
      {pending.length > 0 && (
        <div style={S.adminSection}>
          <label style={S.label}>⏳ Onay bekleyenler ({pending.length})</label>
          {pending.map(t => (
            <div key={t.id} style={S.queueItem}>
              <div style={{ ...S.approvedCat, color: catColor(t.category), background: catColor(t.category) + "22" }}>{t.category}</div>
              <div style={S.approvedTitle}>{t.title}</div>
              <div style={S.row}>
                <button style={{ ...S.btnSm, ...S.btnReject }} onClick={() => changeStatus(t.id, "rejected")} disabled={busy}>✗ Reddet</button>
                <button style={{ ...S.btnSm, ...S.btnApprove }} onClick={() => changeStatus(t.id, "live")} disabled={busy}>✓ Yayınla</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Yayında */}
      <div style={S.adminSection}>
        <label style={S.label}>✓ Yayında olanlar ({live.length})</label>
        {live.length === 0 && <p style={S.helperNote}>Henüz yayında konu yok.</p>}
        {live.map(t => (
          <div key={t.id} style={S.approvedItem}>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.approvedCat, color: catColor(t.category), background: catColor(t.category) + "22" }}>{t.category}</div>
              <div style={S.approvedTitle}>{t.title}</div>
            </div>
            <button style={S.removeBtn} onClick={() => changeStatus(t.id, "rejected")} disabled={busy}>Kaldır</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════ GİRİŞ FORMU ════════ */
function LoginForm({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!email.trim() || !password || busy) return;
    setBusy(true); setError(null);
    try {
      const user = await signIn(email.trim(), password);
      onSuccess(user);
    } catch (e) {
      setError(e.message || "Giriş başarısız");
      setBusy(false);
    }
  }

  return (
    <div style={S.adminRoot}>
      <div style={S.adminSection}>
        <label style={S.label}>🔒 Yönetici Girişi</label>
        <p style={S.helperNote}>Bu alan yalnızca yöneticiye açıktır. İçerik eklemek/onaylamak için giriş yap.</p>
        <input style={{ ...S.textarea, marginTop: 12 }} type="email" placeholder="E-posta" value={email}
          onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        <input style={{ ...S.textarea, marginTop: 10 }} type="password" placeholder="Şifre" value={password}
          onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        <button style={{ ...S.btn, ...S.btnPrimary, marginTop: 12, width: "100%", opacity: busy ? 0.6 : 1 }}
          disabled={busy} onClick={submit}>
          {busy ? "Giriş yapılıyor…" : "Giriş Yap"}
        </button>
        {error && <p style={S.errorText}>{error}</p>}
      </div>
    </div>
  );
}

/* ════════ APP ROOT ════════ */
/* ════════ AÇILIŞ ANİMASYONU ════════ */
function Splash() {
  const cards = [
    { rot: -9, dx: -14, dy: 6, delay: 0.0, z: 1, faded: 0.5 },
    { rot: 7, dx: 12, dy: 3, delay: 0.24, z: 2, faded: 0.7 },
    { rot: 0, dx: 0, dy: 0, delay: 0.48, z: 3, faded: 1, front: true },
  ];
  return (
    <div style={S.splash}>
      <div style={S.splashStack}>
        {cards.map((c, i) => (
          <div key={i} style={{ ...S.splashDrop, zIndex: c.z, animationDelay: `${c.delay}s` }}>
            <div style={{
              ...S.splashCard,
              opacity: c.faded,
              transform: `translate(${c.dx}px, ${c.dy}px) rotate(${c.rot}deg)`,
              border: c.front ? "1px solid rgba(110,181,216,0.35)" : "1px solid rgba(255,255,255,0.08)",
            }}>
              {c.front && (
                <>
                  <div style={S.splashPill} />
                  <div style={{ ...S.splashLine, width: "80%" }} />
                  <div style={{ ...S.splashLine, width: "60%" }} />
                  <div style={S.splashMiniRow}>
                    <div style={{ ...S.splashMiniBox, borderColor: "rgba(224,90,90,0.4)" }} />
                    <div style={{ ...S.splashMiniBox, borderColor: "rgba(76,175,125,0.4)" }} />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={S.splashWord}>Reyy</div>
      <div style={S.splashBarWrap}>
        <div style={S.splashBarRed} />
        <div style={S.splashBarGreen} />
      </div>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState("admin");
  const [allTopics, setAllTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState("loading");
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdminRoute, setIsAdminRoute] = useState(typeof window !== "undefined" && window.location.hash === "#admin");
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 2600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onHash = () => setIsAdminRoute(window.location.hash === "#admin");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const all = await dbGet(null);
      setAllTopics(all);
      setConn("ok");
    } catch (e) {
      setConn("error");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    (async () => {
      const user = await restoreSession();
      if (user) setSession(user);
      setAuthChecked(true);
      await reload();
    })();
  }, []);

  function handleLogout() {
    signOut();
    setSession(null);
    setMode("admin");
    reload();
  }

  async function handleLoginSuccess(user) {
    setSession(user);
    await reload();
  }

  const liveTopics = allTopics.filter(t => t.status === "live");

  // Normal kullanıcı: sadece swipe ekranı, hiçbir yönetici düğmesi yok
  if (!isAdminRoute) {
    return (
      <div style={S.root}>
        <style>{FONTS}</style>
        {showSplash && <Splash />}
        <SwipeDeck topics={liveTopics} loading={loading} error={conn === "error"} onRetry={reload} />
      </div>
    );
  }

  // Yönetici (gizli /#admin adresi): giriş + panel + önizleme
  return (
    <div style={S.root}>
      <style>{FONTS}</style>
      {showSplash && <Splash />}
      <div style={S.switcher}>
        <button style={{ ...S.switchBtn, ...(mode === "admin" ? S.switchBtnActive : {}) }} onClick={() => setMode("admin")}>🛠 Yönetici</button>
        <button style={{ ...S.switchBtn, ...(mode === "user" ? S.switchBtnActive : {}) }} onClick={() => setMode("user")}>📱 Önizleme</button>
        {session && mode === "admin" && (
          <button style={{ ...S.switchBtn, color: "#F09797", borderColor: "rgba(224,90,90,0.3)" }} onClick={handleLogout}>Çıkış</button>
        )}
      </div>
      {mode === "admin"
        ? (!authChecked
            ? <div style={S.loading}>Kontrol ediliyor…</div>
            : session
              ? <AdminPanel allTopics={allTopics} reload={reload} conn={conn} />
              : <LoginForm onSuccess={handleLoginSuccess} />)
        : <SwipeDeck topics={liveTopics} loading={loading} error={conn === "error"} onRetry={reload} />}
    </div>
  );
}

/* ════════ STYLES ════════ */
const S = {
  root: { minHeight: "100vh", background: "#07111F", display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "'Inter', system-ui, sans-serif", color: "#F0EDE8", overflow: "hidden", position: "relative", paddingTop: "env(safe-area-inset-top, 0px)" },
  loading: { padding: 60, color: "#4B5563", fontSize: 13 },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: 40, marginTop: 40 },
  switcher: { display: "flex", gap: 6, padding: "14px 0 4px", zIndex: 20 },
  switchBtn: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#6B7280", fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 20, cursor: "pointer", letterSpacing: "0.03em" },
  switchBtnActive: { background: "rgba(37,99,235,0.18)", borderColor: "#2563EB80", color: "#8DBBF5" },

  deckRoot: { display: "flex", flexDirection: "column", alignItems: "center", width: "100%", flex: 1, userSelect: "none", position: "relative" },
  filterBar: { display: "flex", gap: 6, overflowX: "auto", padding: "10px 14px", width: "100%", maxWidth: 500, boxSizing: "border-box", zIndex: 10, scrollbarWidth: "none", flexShrink: 0 },
  chip: { flexShrink: 0, fontSize: 11, padding: "6px 13px", borderRadius: 20, border: "1px solid", cursor: "pointer", whiteSpace: "nowrap", letterSpacing: "0.04em", fontFamily: "inherit" },
  chipAllActive: { background: "rgba(37,99,235,0.9)", color: "#fff", borderColor: "#2563EB", fontWeight: 800 },
  chipInactive: { background: "rgba(255,255,255,0.04)", color: "#9CA3AF", borderColor: "rgba(255,255,255,0.12)", fontWeight: 700 },
  glow: { position: "fixed", inset: 0, pointerEvents: "none", transition: "background 0.15s", zIndex: 0 },
  expertBar: { width: "100%", maxWidth: 500, padding: "11px 20px", background: "rgba(74,127,165,0.1)", borderBottom: "1px solid rgba(74,127,165,0.18)", cursor: "pointer", zIndex: 10, flexShrink: 0, boxSizing: "border-box" },
  expertLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.09em", color: "#6EB5D8", fontWeight: 700 },
  expertIcon: { fontSize: 14 },
  expertAuthor: { color: "#8DCCE8", fontWeight: 400 },
  expertBody: { fontSize: 13, color: "#9CC8E0", marginTop: 10, lineHeight: 1.65, paddingBottom: 4 },
  arena: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "16px 0", position: "relative", zIndex: 1 },
  cardGroup: { display: "flex", flexDirection: "column", alignItems: "center", width: 300 },
  viewsRow: { display: "flex", gap: 8, width: "100%", marginTop: 12 },
  viewBox: { flex: 1, background: "#0D1520", border: "1px solid", borderRadius: 14, padding: "12px 12px 14px" },
  viewTag: { fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", marginBottom: 8 },
  viewText: { fontSize: 12, color: "#C2CAD6", lineHeight: 1.55, margin: 0 },
  card: { width: 300, minHeight: 300, background: "linear-gradient(160deg, #111827 0%, #0D1520 100%)", border: "1px solid", borderRadius: 22, padding: "26px 22px 20px", position: "relative", zIndex: 2, flexShrink: 0, touchAction: "none", boxSizing: "border-box" },
  badge: { position: "absolute", border: "2px solid", borderRadius: 8, padding: "4px 11px", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", pointerEvents: "none" },
  categoryTag: { display: "inline-block", fontSize: 10, letterSpacing: "0.12em", fontWeight: 800, marginBottom: 14, padding: "4px 10px", borderRadius: 20 },
  cardTitle: { fontSize: 18, fontWeight: 700, lineHeight: 1.38, color: "#F9FAFB", margin: "0 0 14px" },
  cardBody: { fontSize: 13, lineHeight: 1.7, color: "#9CA3AF", margin: "0 0 24px" },
  hints: { display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.65, letterSpacing: "0.03em" },
  sourceLink: { display: "inline-block", fontSize: 11, color: "#6EB5D8", textDecoration: "none", marginBottom: 18, opacity: 0.85, cursor: "pointer" },
  panel: { width: 104, background: "#0D1520", border: "1px solid", borderRadius: 16, padding: "14px 11px", flexShrink: 0, cursor: "pointer", transition: "opacity 0.12s, border-color 0.12s", boxSizing: "border-box" },
  panelLeft: { marginRight: -12, zIndex: 1 },
  panelRight: { marginLeft: -12, zIndex: 1 },
  panelTag: { fontSize: 10, fontWeight: 800, letterSpacing: "0.09em", marginBottom: 8 },
  panelText: { fontSize: 11, color: "#6B7280", lineHeight: 1.55 },
  panelHint: { fontSize: 10, color: "#374151", marginTop: 10, textAlign: "right" },
  footer: { width: "100%", maxWidth: 500, padding: "10px 24px 22px", zIndex: 10, boxSizing: "border-box" },
  bar: { height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 2, marginBottom: 8 },
  fill: { height: "100%", background: "linear-gradient(90deg, #2563EB, #6EB5D8)", borderRadius: 2, transition: "width 0.3s" },
  counter: { textAlign: "center", fontSize: 11, color: "#374151", letterSpacing: "0.08em" },
  resultWrap: { background: "#0D1520", borderRadius: 22, padding: "36px 28px", width: 310, marginTop: 60, border: "1px solid rgba(255,255,255,0.07)" },
  resultEmoji: { fontSize: 44, textAlign: "center", marginBottom: 14 },
  resultHeading: { fontSize: 20, fontWeight: 700, color: "#F9FAFB", textAlign: "center", margin: "0 0 24px" },
  resultRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", fontSize: 13, borderBottom: "1px solid rgba(255,255,255,0.06)" },
  resetBtn: { marginTop: 24, width: "100%", padding: "13px", background: "linear-gradient(135deg, #1E3A5F, #2563EB)", color: "#F0EDE8", border: "none", borderRadius: 11, fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: "0.05em" },
  footerLinks: { display: "flex", gap: 10, justifyContent: "center", alignItems: "center", marginTop: 22, fontSize: 12 },
  footerLink: { color: "#6B7280", textDecoration: "none" },

  voteResultLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#6B7280", textTransform: "uppercase", marginBottom: 16 },
  voteRowTop: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, marginBottom: 6 },
  youTag: { fontSize: 9, color: "#8DBBF5", letterSpacing: "0.08em" },
  voteBarBg: { height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 5, overflow: "hidden" },
  voteBarFill: { height: "100%", borderRadius: 5, transition: "width 0.6s cubic-bezier(0.22,1,0.36,1)" },
  voteTotal: { fontSize: 11, color: "#4B5563", textAlign: "center", marginTop: 16, letterSpacing: "0.04em" },
  continueBtn: { marginTop: 18, width: "100%", padding: "13px", background: "linear-gradient(135deg, #1E3A5F, #2563EB)", color: "#F0EDE8", border: "none", borderRadius: 11, fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: "0.05em" },
  voteActions: { display: "flex", gap: 9, marginTop: 18 },
  shareBtn: { flexShrink: 0, padding: "13px 18px", background: "transparent", color: "#9FD0E8", border: "1px solid rgba(110,181,216,0.35)", borderRadius: 11, fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: "0.03em", fontFamily: "inherit" },
  continueBtnFlex: { flex: 1, padding: "13px", background: "linear-gradient(135deg, #1E3A5F, #2563EB)", color: "#F0EDE8", border: "none", borderRadius: 11, fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: "0.05em", fontFamily: "inherit" },
  shareMsg: { textAlign: "center", fontSize: 12, color: "#4CAF7D", marginTop: 10, fontWeight: 600 },

  adminRoot: { width: "100%", maxWidth: 480, padding: "8px 18px 40px", boxSizing: "border-box" },
  connBar: { fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", padding: "8px 14px", border: "1px solid", borderRadius: 10, marginBottom: 14, textAlign: "center" },
  adminSection: { background: "#0D1520", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 18, marginBottom: 16 },
  label: { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#6B7280", marginBottom: 8, textTransform: "uppercase" },
  textarea: { width: "100%", background: "#07111F", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#F0EDE8", fontFamily: "inherit", fontSize: 13, padding: "10px 12px", resize: "vertical", boxSizing: "border-box" },
  row: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" },
  select: { background: "#07111F", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#9CA3AF", fontSize: 12, padding: "0 10px", fontFamily: "inherit" },
  btn: { border: "none", borderRadius: 10, fontSize: 12.5, fontWeight: 700, padding: "10px 16px", cursor: "pointer", letterSpacing: "0.02em", flex: 1 },
  btnSm: { border: "1px solid", borderRadius: 8, fontSize: 11.5, fontWeight: 700, padding: "7px 12px", cursor: "pointer", flex: 1 },
  btnPrimary: { background: "linear-gradient(135deg, #1E3A5F, #2563EB)", color: "#F0EDE8" },
  btnApprove: { background: "rgba(76,175,125,0.18)", color: "#7ADCA8", border: "1px solid rgba(76,175,125,0.35)" },
  btnReject: { background: "rgba(224,90,90,0.12)", color: "#F09797", border: "1px solid rgba(224,90,90,0.3)" },
  btnGhost: { background: "rgba(224,168,90,0.12)", color: "#E0C07A", border: "1px solid rgba(224,168,90,0.3)" },
  helperNote: { fontSize: 11, color: "#4B5563", lineHeight: 1.6, marginTop: 6 },
  errorText: { fontSize: 12, color: "#F09797", marginTop: 8 },
  draftWrap: { background: "linear-gradient(160deg, #111827 0%, #0D1520 100%)", border: "1px solid rgba(37,99,235,0.3)", borderRadius: 16, padding: 18, marginBottom: 16 },
  draftLabel: { fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: "#6EB5D8", marginBottom: 10 },
  draftCategory: { display: "inline-block", fontSize: 10, letterSpacing: "0.12em", fontWeight: 800, marginBottom: 8, padding: "3px 9px", borderRadius: 20 },
  editTitle: { width: "100%", background: "transparent", border: "1px dashed rgba(255,255,255,0.15)", borderRadius: 8, color: "#F9FAFB", fontSize: 16, fontWeight: 700, lineHeight: 1.35, fontFamily: "inherit", padding: 8, marginBottom: 10, resize: "vertical", boxSizing: "border-box" },
  editBody: { width: "100%", background: "transparent", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 8, color: "#9CA3AF", fontSize: 12.5, lineHeight: 1.6, fontFamily: "inherit", padding: 8, marginBottom: 14, resize: "vertical", boxSizing: "border-box" },
  editArgLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 6, marginTop: 4, color: "#9CA3AF" },
  editArg: { width: "100%", background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 8, color: "#D1D5DB", fontSize: 12, lineHeight: 1.6, fontFamily: "inherit", padding: 8, marginBottom: 10, resize: "vertical", boxSizing: "border-box" },
  editSource: { width: "100%", background: "rgba(110,181,216,0.06)", border: "1px solid rgba(110,181,216,0.25)", borderRadius: 8, color: "#9FD0E8", fontSize: 12, fontFamily: "inherit", padding: 9, marginBottom: 12, boxSizing: "border-box" },
  queueItem: { background: "rgba(224,168,90,0.06)", border: "1px solid rgba(224,168,90,0.18)", borderRadius: 10, padding: 12, marginBottom: 10 },
  approvedItem: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" },
  approvedCat: { display: "inline-block", fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", marginBottom: 4, padding: "2px 8px", borderRadius: 20 },
  approvedTitle: { fontSize: 12.5, color: "#D1D5DB", lineHeight: 1.4, marginBottom: 6 },
  removeBtn: { background: "transparent", border: "1px solid rgba(224,90,90,0.3)", color: "#E05A5A", fontSize: 11, padding: "5px 10px", borderRadius: 8, cursor: "pointer", flexShrink: 0 },

  splash: { position: "fixed", inset: 0, background: "#07111F", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 9999, animation: "reyFadeOut 2.6s ease forwards", pointerEvents: "none" },
  splashStack: { position: "relative", width: 132, height: 168, marginBottom: 30 },
  splashDrop: { position: "absolute", inset: 0, animation: "reyDrop 1s cubic-bezier(0.18,0.9,0.32,1.28) both" },
  splashCard: { width: 132, height: 168, borderRadius: 18, background: "linear-gradient(160deg, #111827 0%, #0D1520 100%)", boxShadow: "0 18px 40px rgba(0,0,0,0.5)", padding: 14, boxSizing: "border-box" },
  splashPill: { width: 42, height: 12, borderRadius: 20, background: "rgba(139,127,216,0.5)", marginBottom: 14 },
  splashLine: { height: 8, borderRadius: 6, background: "rgba(255,255,255,0.14)", marginBottom: 9 },
  splashMiniRow: { display: "flex", gap: 8, marginTop: 18 },
  splashMiniBox: { flex: 1, height: 38, borderRadius: 8, border: "1px solid" },
  splashWord: { fontFamily: "'Inter', sans-serif", fontSize: 30, fontWeight: 800, color: "#F5F8FF", letterSpacing: "0.02em", animation: "reyRise 0.7s ease 0.9s both" },
  splashBarWrap: { display: "flex", width: 84, height: 5, marginTop: 12, borderRadius: 4, overflow: "hidden", animation: "reyRise 0.7s ease 1.1s both", transformOrigin: "center" },
  splashBarRed: { flex: 1, background: "#E05A5A", animation: "reyBarFill 0.7s ease 1.2s both", transformOrigin: "left" },
  splashBarGreen: { flex: 1, background: "#4CAF7D", animation: "reyBarFill 0.7s ease 1.4s both", transformOrigin: "right" },
};
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
@keyframes reyDrop {
  0%   { transform: translateY(-180%); opacity: 0; }
  70%  { opacity: 1; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes reyRise {
  0%   { transform: translateY(14px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes reyBarFill {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}
@keyframes reyFadeOut {
  0%, 78% { opacity: 1; }
  100%    { opacity: 0; }
}`;
