import { useState, useEffect, useRef } from "react";

/* ════════ SUPABASE BAĞLANTISI ════════ */
const SUPABASE_URL = "https://mzfnafgmlutucxnpuuzo.supabase.co";
const SUPABASE_KEY = "sb_publishable_BdT_E38q0e2Ieb5lrDiUVA_kksMkRhv";
const REST = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

// Veritabanı satırını arayüz biçimine çevir
const fromRow = (r) => ({
  id: r.id,
  category: r.category,
  title: r.title,
  summary: r.summary,
  status: r.status,
  for: { text: r.for_text || "" },
  against: { text: r.against_text || "" },
  expert: { author: r.expert_role || "Uzman Değerlendirmesi", text: r.expert_text || "" },
});

async function dbGet(status) {
  const url = status
    ? `${REST}/topics?status=eq.${status}&select=*&order=created_at.desc`
    : `${REST}/topics?select=*&order=created_at.desc`;
  const res = await fetch(url, { headers: HEADERS });
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
    status: topic.status || "pending",
  };
  const res = await fetch(`${REST}/topics`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`INSERT ${res.status}`);
  return fromRow((await res.json())[0]);
}

async function dbUpdateStatus(id, status) {
  const res = await fetch(`${REST}/topics?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...HEADERS, Prefer: "return=representation" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`UPDATE ${res.status}`);
}

async function dbDelete(id) {
  const res = await fetch(`${REST}/topics?id=eq.${id}`, { method: "DELETE", headers: HEADERS });
  if (!res.ok) throw new Error(`DELETE ${res.status}`);
}

const CATEGORIES = ["ANAYASA", "EKONOMİ", "EĞİTİM", "SAĞLIK", "DIŞ POLİTİKA", "ÇEVRE", "TEKNOLOJİ", "DİĞER"];
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
function SwipeDeck({ topics, loading }) {
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [swipeDir, setSwipeDir] = useState(null);
  const [history, setHistory] = useState([]);
  const [done, setDone] = useState(false);
  const [expertOpen, setExpertOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(null);
  const flying = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  useEffect(() => { setIdx(0); setHistory([]); setDone(false); }, [topics]);

  const topic = topics[idx];
  const getDir = (x, y) => {
    if (y > 50 && Math.abs(x) < y * 0.9) return "down";
    if (Math.abs(x) > 35) return x > 0 ? "right" : "left";
    return null;
  };
  const onStart = (cx, cy) => { if (flying.current) return; start.current = { x: cx, y: cy }; setDragging(true); setDrag({ x: 0, y: 0 }); setPanelOpen(null); setExpertOpen(false); };
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
    setHistory(h => [...h, { title: topic.title, dir }]);
    setDrag({ x: dir === "right" ? 500 : dir === "left" ? -500 : 0, y: dir === "down" ? 500 : 0 });
    setTimeout(() => {
      flying.current = false;
      if (idx + 1 >= topics.length) setDone(true); else setIdx(i => i + 1);
      setDrag({ x: 0, y: 0 }); setSwipeDir(null);
    }, 380);
  };

  if (loading) return <div style={S.loading}>Konular yükleniyor…</div>;
  if (!topics.length) return (
    <div style={S.emptyState}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
      <p style={{ color: "#9CA3AF", fontSize: 14, textAlign: "center", lineHeight: 1.6 }}>
        Yayında konu yok.<br />Yönetici modundan bir konu onaylayıp yayınla.
      </p>
    </div>
  );

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
        <button style={S.resetBtn} onClick={() => { setIdx(0); setHistory([]); setDone(false); }}>Tekrar Başla</button>
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
      <div style={S.expertBar} onClick={() => setExpertOpen(o => !o)}>
        <div style={S.expertLabel}>
          <span style={S.expertIcon}>↑</span>
          UZMAN GÖRÜŞÜ · <span style={S.expertAuthor}>{topic.expert.author}</span>
          <span style={{ marginLeft: "auto", opacity: 0.5 }}>{expertOpen ? "▲" : "▼"}</span>
        </div>
        {expertOpen && <p style={S.expertBody}>{topic.expert.text}</p>}
      </div>
      <div style={S.arena}>
        <div style={{ ...S.panel, ...S.panelLeft, opacity: swipeDir === "left" ? 0.25 + dOpacity * 0.75 : 0.18, borderColor: swipeDir === "left" ? `${DIR.left.color}40` : "rgba(255,255,255,0.05)" }}
          onClick={() => setPanelOpen(p => (p === "against" ? null : "against"))}>
          <div style={{ ...S.panelTag, color: DIR.left.color }}>✗ KARŞIYIM</div>
          <p style={S.panelText}>{panelOpen === "against" ? topic.against.text : topic.against.text.slice(0, 72) + "…"}</p>
          <div style={S.panelHint}>{panelOpen === "against" ? "Kapat ↑" : "Devamı →"}</div>
        </div>
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
          <div style={S.categoryTag}>{topic.category}</div>
          <h1 style={S.cardTitle}>{topic.title}</h1>
          <p style={S.cardBody}>{topic.summary}</p>
          <div style={S.hints}>
            <span style={{ color: DIR.left.color }}>← Karşıyım</span>
            <span style={{ color: DIR.down.color }}>↓ Fikrim yok</span>
            <span style={{ color: DIR.right.color }}>Destekle →</span>
          </div>
        </div>
        <div style={{ ...S.panel, ...S.panelRight, opacity: swipeDir === "right" ? 0.25 + dOpacity * 0.75 : 0.18, borderColor: swipeDir === "right" ? `${DIR.right.color}40` : "rgba(255,255,255,0.05)" }}
          onClick={() => setPanelOpen(p => (p === "for" ? null : "for"))}>
          <div style={{ ...S.panelTag, color: DIR.right.color }}>✓ DESTEKLE</div>
          <p style={S.panelText}>{panelOpen === "for" ? topic.for.text : topic.for.text.slice(0, 72) + "…"}</p>
          <div style={S.panelHint}>{panelOpen === "for" ? "Kapat ↑" : "← Devamı"}</div>
        </div>
      </div>
      <div style={S.footer}>
        <div style={S.bar}><div style={{ ...S.fill, width: `${(idx / topics.length) * 100}%` }} /></div>
        <div style={S.counter}>{idx + 1} / {topics.length} konu</div>
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
          <div style={S.draftCategory}>{draft.category}</div>
          <textarea style={S.editTitle} rows={2} value={draft.title} onChange={editField("title")} />
          <textarea style={S.editBody} rows={3} value={draft.summary} onChange={editField("summary")} />
          <div style={S.editArgLabel}><span style={{ color: DIR.right.color }}>✓ DESTEKLEYEN GÖRÜŞ</span></div>
          <textarea style={S.editArg} rows={3} value={draft.for.text} onChange={editField("for", true)} />
          <div style={S.editArgLabel}><span style={{ color: DIR.left.color }}>✗ KARŞI GÖRÜŞ</span></div>
          <textarea style={S.editArg} rows={3} value={draft.against.text} onChange={editField("against", true)} />
          <div style={S.editArgLabel}>↑ UZMAN — <span style={{ opacity: 0.6 }}>{draft.expert.author}</span></div>
          <textarea style={S.editArg} rows={3} value={draft.expert.text} onChange={editField("expert", true)} />
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
              <div style={S.approvedCat}>{t.category}</div>
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
              <div style={S.approvedCat}>{t.category}</div>
              <div style={S.approvedTitle}>{t.title}</div>
            </div>
            <button style={S.removeBtn} onClick={() => changeStatus(t.id, "rejected")} disabled={busy}>Kaldır</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════ APP ROOT ════════ */
export default function App() {
  const [mode, setMode] = useState("admin");
  const [allTopics, setAllTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState("loading");

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

  useEffect(() => { reload(); }, []);

  const liveTopics = allTopics.filter(t => t.status === "live");

  return (
    <div style={S.root}>
      <style>{FONTS}</style>
      <div style={S.switcher}>
        <button style={{ ...S.switchBtn, ...(mode === "admin" ? S.switchBtnActive : {}) }} onClick={() => setMode("admin")}>🛠 Yönetici</button>
        <button style={{ ...S.switchBtn, ...(mode === "user" ? S.switchBtnActive : {}) }} onClick={() => setMode("user")}>📱 Önizleme</button>
      </div>
      {mode === "admin"
        ? <AdminPanel allTopics={allTopics} reload={reload} conn={conn} />
        : <SwipeDeck topics={liveTopics} loading={loading} />}
    </div>
  );
}

/* ════════ STYLES ════════ */
const S = {
  root: { minHeight: "100vh", background: "#07111F", display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "'Inter', system-ui, sans-serif", color: "#F0EDE8", overflow: "hidden", position: "relative" },
  loading: { padding: 60, color: "#4B5563", fontSize: 13 },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: 40, marginTop: 40 },
  switcher: { display: "flex", gap: 6, padding: "14px 0 4px", zIndex: 20 },
  switchBtn: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#6B7280", fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 20, cursor: "pointer", letterSpacing: "0.03em" },
  switchBtnActive: { background: "rgba(37,99,235,0.18)", borderColor: "#2563EB80", color: "#8DBBF5" },

  deckRoot: { display: "flex", flexDirection: "column", alignItems: "center", width: "100%", flex: 1, userSelect: "none", position: "relative" },
  glow: { position: "fixed", inset: 0, pointerEvents: "none", transition: "background 0.15s", zIndex: 0 },
  expertBar: { width: "100%", maxWidth: 500, padding: "11px 20px", background: "rgba(74,127,165,0.1)", borderBottom: "1px solid rgba(74,127,165,0.18)", cursor: "pointer", zIndex: 10, flexShrink: 0, boxSizing: "border-box" },
  expertLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.09em", color: "#6EB5D8", fontWeight: 700 },
  expertIcon: { fontSize: 14 },
  expertAuthor: { color: "#8DCCE8", fontWeight: 400 },
  expertBody: { fontSize: 13, color: "#9CC8E0", marginTop: 10, lineHeight: 1.65, paddingBottom: 4 },
  arena: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "16px 0", position: "relative", zIndex: 1 },
  card: { width: 300, minHeight: 370, background: "linear-gradient(160deg, #111827 0%, #0D1520 100%)", border: "1px solid", borderRadius: 22, padding: "26px 22px 20px", position: "relative", zIndex: 2, flexShrink: 0, touchAction: "none", boxSizing: "border-box" },
  badge: { position: "absolute", border: "2px solid", borderRadius: 8, padding: "4px 11px", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", pointerEvents: "none" },
  categoryTag: { fontSize: 10, letterSpacing: "0.18em", color: "#4B5563", fontWeight: 700, marginBottom: 14 },
  cardTitle: { fontSize: 18, fontWeight: 700, lineHeight: 1.38, color: "#F9FAFB", margin: "0 0 14px" },
  cardBody: { fontSize: 13, lineHeight: 1.7, color: "#9CA3AF", margin: "0 0 24px" },
  hints: { display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.65, letterSpacing: "0.03em" },
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
  draftCategory: { fontSize: 10, letterSpacing: "0.18em", color: "#4B5563", fontWeight: 700, marginBottom: 8 },
  editTitle: { width: "100%", background: "transparent", border: "1px dashed rgba(255,255,255,0.15)", borderRadius: 8, color: "#F9FAFB", fontSize: 16, fontWeight: 700, lineHeight: 1.35, fontFamily: "inherit", padding: 8, marginBottom: 10, resize: "vertical", boxSizing: "border-box" },
  editBody: { width: "100%", background: "transparent", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 8, color: "#9CA3AF", fontSize: 12.5, lineHeight: 1.6, fontFamily: "inherit", padding: 8, marginBottom: 14, resize: "vertical", boxSizing: "border-box" },
  editArgLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 6, marginTop: 4, color: "#9CA3AF" },
  editArg: { width: "100%", background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 8, color: "#D1D5DB", fontSize: 12, lineHeight: 1.6, fontFamily: "inherit", padding: 8, marginBottom: 10, resize: "vertical", boxSizing: "border-box" },
  queueItem: { background: "rgba(224,168,90,0.06)", border: "1px solid rgba(224,168,90,0.18)", borderRadius: 10, padding: 12, marginBottom: 10 },
  approvedItem: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" },
  approvedCat: { fontSize: 9, color: "#4B5563", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 2 },
  approvedTitle: { fontSize: 12.5, color: "#D1D5DB", lineHeight: 1.4, marginBottom: 6 },
  removeBtn: { background: "transparent", border: "1px solid rgba(224,90,90,0.3)", color: "#E05A5A", fontSize: 11, padding: "5px 10px", borderRadius: 8, cursor: "pointer", flexShrink: 0 },
};
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');`;
