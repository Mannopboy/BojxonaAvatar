// Bilim bazasi admin paneli (/admin): savol-javoblarni ko'rish, qidirish, tahrirlash, o'chirish, yangi qo'shish va «sinab ko'rish».
// Saqlashda backend qatorni 1000 talik baza bilan bir xil tayyorlaydi (qisqa ovozli javob, 12 tilga tarjima, qidiruv indeksi) — shuning uchun ~10 soniya oladi.
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { KbItem, KbList, KbStats, KbTestResult } from "./api";
import "./admin.css";

const PAGE = 50;
const LANG_NAMES: Record<string, string> = {
  ru: "Ruscha", en: "Inglizcha", zh: "Xitoycha", kk: "Qozoqcha", ky: "Qirg'izcha", ko: "Koreyscha",
  fr: "Fransuzcha", tg: "Tojikcha", ar: "Arabcha", tr: "Turkcha", tk: "Turkmancha", az: "Ozarbayjoncha",
};

type Editing = { mode: "new" } | { mode: "edit"; uid: number } | null;

export default function AdminApp() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(!!api.getKey());

  useEffect(() => {
    if (!api.getKey()) return;
    api.ping(api.getKey()).then(() => setAuthed(true)).catch(() => api.clearKey()).finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="adm-center">Yuklanmoqda…</div>;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <Panel onLogout={() => { api.clearKey(); setAuthed(false); }} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [key, setKeyValue] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await api.ping(key.trim());
      api.setKey(key.trim());
      onDone();
    } catch (ex) {
      const s = ex instanceof api.ApiError ? ex.status : 0;
      setErr(s === 401 ? "Kalit noto'g'ri." : s === 429 ? "Juda ko'p noto'g'ri urinish. 10 daqiqadan keyin qayta urinib ko'ring."
        : s === 503 ? "Admin panel serverda yoqilmagan (KB_ADMIN_KEY sozlanmagan)." : (ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-center">
      <form className="adm-login" onSubmit={submit}>
        <h1>Bilim bazasi</h1>
        <p>Bojxona virtual xodimi — admin panel</p>
        <label htmlFor="adm-key">Admin kaliti</label>
        <input id="adm-key" type="password" autoFocus autoComplete="current-password" value={key} onChange={(e) => setKeyValue(e.target.value)} />
        {err && <div className="adm-error" role="alert">{err}</div>}
        <button className="adm-btn primary" disabled={busy || !key.trim()}>{busy ? "Tekshirilmoqda…" : "Kirish"}</button>
      </form>
    </div>
  );
}

function Panel({ onLogout }: { onLogout: () => void }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<KbList | null>(null);
  const [stats, setStats] = useState<KbStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState("");
  const reqId = useRef(0);

  // qidiruv: yozishdan 300 ms keyin
  useEffect(() => {
    const t = setTimeout(() => { setQuery(search); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const d = await api.list({ search: query, filter, offset, limit: PAGE });
      if (id !== reqId.current) return; // eskirgan javob
      setData(d);
      setStats(d.stats);
      setError("");
    } catch (ex) {
      if (id !== reqId.current) return;
      if (ex instanceof api.ApiError && ex.status === 401) return onLogout();
      setError((ex as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [query, filter, offset, onLogout]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const total = data?.total ?? 0;
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + PAGE, total);

  return (
    <div className="adm">
      <header className="adm-top">
        <div>
          <h1>Bilim bazasi</h1>
          <span className="adm-sub">Bojxona virtual xodimi — savol va javoblar</span>
        </div>
        <div className="adm-top-actions">
          <button className="adm-btn" onClick={() => setTesting(true)}>Sinab ko'rish</button>
          <button className="adm-btn" onClick={() => api.downloadExport().catch((e) => setToast(e.message))}>Eksport</button>
          <button className="adm-btn" onClick={onLogout}>Chiqish</button>
          <button className="adm-btn primary" onClick={() => setEditing({ mode: "new" })}>+ Yangi savol</button>
        </div>
      </header>

      {stats && (
        <div className="adm-stats">
          <Stat label="Jami savollar" value={stats.total} />
          <Stat label="Faol" value={stats.active} />
          <Stat label="Tayyor javobli" value={stats.ready} />
          <Stat label="Tillar" value={stats.langs} />
        </div>
      )}

      <div className="adm-toolbar">
        <input className="adm-search" type="search" placeholder="Savol, javob yoki raqam bo'yicha qidirish…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filter} onChange={(e) => { setFilter(e.target.value); setOffset(0); }} aria-label="Filtr">
          <option value="all">Hammasi</option>
          <option value="active">Faol</option>
          <option value="inactive">O'chirib qo'yilgan</option>
          <option value="noready">Tayyor javobi yo'q</option>
        </select>
      </div>

      {error && <div className="adm-error" role="alert">{error} <button className="adm-link" onClick={() => void load()}>Qayta urinish</button></div>}

      <div className={"adm-table-wrap" + (loading ? " loading" : "")}>
        <table className="adm-table">
          <thead>
            <tr><th className="c-id">№</th><th>Savol</th><th>Ovozda aytiladigan qisqa javob</th><th className="c-st">Holat</th></tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r.uid} onClick={() => setEditing({ mode: "edit", uid: r.uid })} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setEditing({ mode: "edit", uid: r.uid }); }} className={r.active ? "" : "off"}>
                <td className="c-id">{r.uid}</td>
                <td><div className="q">{r.q}</div></td>
                <td><div className="s">{r.s || <i>yo'q — javobni model yozadi</i>}</div></td>
                <td className="c-st">
                  {!r.active && <span className="adm-badge gray">O'chirilgan</span>}
                  {r.active && r.s && <span className="adm-badge green">Tayyor</span>}
                  {r.active && !r.s && <span className="adm-badge amber">Model</span>}
                  {r.s && r.langs < 12 && <span className="adm-badge amber">{r.langs}/12 til</span>}
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr className="empty"><td colSpan={4}>{query ? "Hech narsa topilmadi." : "Bazada savol yo'q."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="adm-pager">
        <span>{from}–{to} / {total}</span>
        <button className="adm-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Oldingi</button>
        <button className="adm-btn" disabled={to >= total} onClick={() => setOffset(offset + PAGE)}>Keyingi →</button>
      </div>

      {editing && (
        <Editor editing={editing} onClose={() => setEditing(null)}
                onSaved={(msg) => { setToast(msg); setEditing(null); void load(); }} />
      )}
      {testing && <TestBox onClose={() => setTesting(false)} onOpen={(uid) => { setTesting(false); setEditing({ mode: "edit", uid }); }} />}
      {toast && <div className="adm-toast" role="status">{toast}</div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="adm-stat"><b>{value}</b><span>{label}</span></div>;
}

function Editor({ editing, onClose, onSaved }: { editing: NonNullable<Editing>; onClose: () => void; onSaved: (msg: string) => void }) {
  const isNew = editing.mode === "new";
  const uid = editing.mode === "edit" ? editing.uid : 0;
  const [row, setRow] = useState<KbItem | null>(null);
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [s, setS] = useState("");
  const [autoS, setAutoS] = useState(true);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState<"" | "load" | "save" | "delete">(isNew ? "" : "load");
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (isNew) return;
    let alive = true;
    api.getRow(uid).then((r) => {
      if (!alive) return;
      setRow(r); setQ(r.q); setA(r.a || ""); setS(r.s); setAutoS(!r.manual_s); setActive(r.active); setBusy("");
    }).catch((ex) => { if (alive) { setErr((ex as Error).message); setBusy(""); } });
    return () => { alive = false; };
  }, [isNew, uid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const valid = q.trim().length >= 3 && a.trim().length >= 3 && (autoS || s.trim().length > 0);

  async function save() {
    setBusy("save");
    setErr("");
    try {
      const body = { q: q.trim(), a: a.trim(), s: autoS ? "" : s.trim(), auto_s: autoS, active };
      const r = isNew ? await api.createRow(body) : await api.updateRow(uid, body);
      const warn = !r.s ? " Diqqat: qisqa javob yaratilmadi — javobni model yozadi." : r.langs < 12 ? ` Diqqat: ${r.langs}/12 tilga tarjima qilindi.` : "";
      onSaved((isNew ? `Yangi savol qo'shildi (№${r.uid}).` : `№${r.uid} saqlandi.`) + warn);
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy("");
    }
  }

  async function remove() {
    setBusy("delete");
    setErr("");
    try {
      await api.deleteRow(uid);
      onSaved(`№${uid} o'chirildi.`);
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy("");
      setConfirmDel(false);
    }
  }

  return (
    <div className="adm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <aside className="adm-drawer" role="dialog" aria-modal="true" aria-label={isNew ? "Yangi savol" : `Savol №${uid}`}>
        <div className="adm-drawer-head">
          <h2>{isNew ? "Yangi savol" : `Savol №${uid}`}</h2>
          <button className="adm-x" onClick={onClose} disabled={!!busy} aria-label="Yopish">×</button>
        </div>

        {busy === "load" ? <div className="adm-pad">Yuklanmoqda…</div> : (
          <div className="adm-form">
            <label htmlFor="f-q">Savol</label>
            <textarea id="f-q" rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Yo'lovchi beradigan savol" />

            <label htmlFor="f-a">To'liq javob (rasmiy matn)</label>
            <textarea id="f-a" rows={8} value={a} onChange={(e) => setA(e.target.value)} placeholder="Qaror, qoida va shartlar bilan to'liq javob" />

            <label htmlFor="f-s">Ovozda aytiladigan qisqa javob</label>
            <label className="adm-check">
              <input type="checkbox" checked={autoS} onChange={(e) => setAutoS(e.target.checked)} />
              Avtomatik yaratish (to'liq javobdan 2–3 gapli qisqa matn)
            </label>
            <textarea id="f-s" rows={4} value={autoS ? (row?.s || "") : s} onChange={(e) => setS(e.target.value)} disabled={autoS}
                      placeholder={autoS ? "Saqlanganda avtomatik yaratiladi" : "Avatar aynan shu matnni aytadi (raqamlarni so'z bilan yozing)"} />
            {autoS && row?.s && <div className="adm-hint">Savol yoki to'liq javob o'zgarsa, qisqa javob qayta yaratiladi.</div>}

            <label className="adm-check">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Faol (o'chirib qo'yilsa, avatar bu savol-javobdan foydalanmaydi)
            </label>

            {row?.t && Object.keys(row.t).length > 0 && (
              <details className="adm-tr">
                <summary>Tarjimalar ({Object.keys(row.t).length} til)</summary>
                {Object.entries(row.t).map(([k, v]) => (
                  <div key={k}><b>{LANG_NAMES[k] || k}</b><p dir={k === "ar" ? "rtl" : "ltr"}>{v}</p></div>
                ))}
              </details>
            )}

            {err && <div className="adm-error" role="alert">{err}</div>}
            {busy === "save" && <div className="adm-hint">Saqlanmoqda: qisqa javob, 12 tilga tarjima va qidiruv indeksi tayyorlanmoqda (~10 soniya)…</div>}
          </div>
        )}

        <div className="adm-drawer-foot">
          {!isNew && !confirmDel && <button className="adm-btn danger" disabled={!!busy} onClick={() => setConfirmDel(true)}>O'chirish</button>}
          {confirmDel && (
            <span className="adm-confirm">
              Butunlay o'chirilsinmi?
              <button className="adm-btn danger" disabled={!!busy} onClick={() => void remove()}>{busy === "delete" ? "O'chirilmoqda…" : "Ha, o'chirish"}</button>
              <button className="adm-btn" disabled={!!busy} onClick={() => setConfirmDel(false)}>Yo'q</button>
            </span>
          )}
          <span className="adm-grow" />
          <button className="adm-btn" disabled={!!busy} onClick={onClose}>Bekor qilish</button>
          <button className="adm-btn primary" disabled={!!busy || !valid} onClick={() => void save()}>{busy === "save" ? "Saqlanmoqda…" : "Saqlash"}</button>
        </div>
      </aside>
    </div>
  );
}

function TestBox({ onClose, onOpen }: { onClose: () => void; onOpen: (uid: number) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<KbTestResult | null>(null);
  const [err, setErr] = useState("");

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setErr("");
    setRes(null);
    try {
      setRes(await api.testQuestion(q.trim()));
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal" role="dialog" aria-modal="true" aria-label="Sinab ko'rish">
        <div className="adm-drawer-head">
          <h2>Sinab ko'rish</h2>
          <button className="adm-x" onClick={onClose} aria-label="Yopish">×</button>
        </div>
        <form className="adm-form" onSubmit={run}>
          <label htmlFor="t-q">Savol (istalgan tilda) — avatar nima deb javob berishini ko'rsatadi</label>
          <div className="adm-row">
            <input id="t-q" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Masalan: Dron olib kirsa bo'ladimi?" />
            <button className="adm-btn primary" disabled={busy || q.trim().length < 2}>{busy ? "Tekshirilmoqda…" : "Sinash"}</button>
          </div>
          {err && <div className="adm-error" role="alert">{err}</div>}
          {res && (
            <div className="adm-test">
              <div className="adm-answer">{res.answer || <i>javob yo'q</i>}</div>
              <div className="adm-meta">
                <span className="adm-badge green">{res.source}</span>
                <span className="adm-badge gray">til: {res.lang}</span>
                <span className="adm-badge gray">{(res.ms / 1000).toFixed(1)} s</span>
              </div>
              {res.hits.length > 0 && (
                <>
                  <div className="adm-hint">Bazadagi eng yaqin savollar (o'xshashlik 0.86 dan yuqori bo'lsa tayyor javob aytiladi):</div>
                  <ul className="adm-hits">
                    {res.hits.map((h) => (
                      <li key={h.uid}>
                        <b>{h.score.toFixed(2)}</b>
                        <button type="button" className="adm-link" onClick={() => onOpen(h.uid)}>№{h.uid}</button>
                        <span>{h.q}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
