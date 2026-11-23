"""Bilim bazasi (1000+ savol-javob) — embedding bilan tez qidiruv (RAG) + admin panel uchun saqlash (CRUD).

Saqlash: BITTA fayl `KB_DIR/kb.json` (Docker'da /app/data/kb — backend_data volume: deploy o'chirmaydi). Har qator:
  uid   — o'zgarmas noyob raqam (admin panel shu bo'yicha ishlaydi; CSV dagi `id` takrorlanadi — ishonib bo'lmaydi)
  q, a  — savol va rasmiy to'liq javob (manba; kirill/rus bo'lishi mumkin)
  quz   — savolning o'zbekcha (lotin) matni: embedding shu bo'yicha (bo'lmasa to_latin(q))
  s     — ovozda aytiladigan qisqa o'zbekcha javob (bo'sh bo'lsa javobni LLM yozadi); ms=1 — admin qo'lda yozgan
  t     — {til: s ning tarjimasi} (oldindan tarjima qilingan — runtime'da LLM chaqirilmaydi)
  e     — savol embeddingi (float32, normallashtirilgan, base64); x=1 — qator o'chirib qo'yilgan (qidiruvda ishlatilmaydi)

Birinchi ishga tushishda fayl yo'q bo'lsa — git'dagi boshlang'ich ma'lumotdan (app/assets: kb.json + kb_emb.bin + kb_i18n/*.json) quriladi. Shundan keyin HAQIQAT MANBAI — KB_DIR
(admin panel o'zgartirishlari shu yerda). Har yozishda avvalgi nusxa `kb.json.bak` da qoladi."""
import array
import base64
import json
import logging
import os
import shutil
import tempfile
import threading

from google.genai import types

from .config import get_settings

log = logging.getLogger("uvicorn.error")
settings = get_settings()
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
EMB_MODEL, DIM = "gemini-embedding-001", 256

_lock = threading.RLock()
_loaded = False
_rows: list[dict] = []
_vecs: array.array = array.array("f")
_spoken: set | None = None


def _store_path() -> str:
    return os.path.join(settings.kb_dir, "kb.json")


def pack_vec(values) -> str:
    """Embedding -> normallashtirilgan float32 base64."""
    n = sum(x * x for x in values) ** 0.5 or 1.0
    return base64.b64encode(array.array("f", [x / n for x in values]).tobytes()).decode("ascii")


def _seed_from_assets() -> list[dict]:
    rows = json.load(open(os.path.join(ASSETS, "kb.json"), encoding="utf-8"))
    vecs = array.array("f")
    vecs.frombytes(open(os.path.join(ASSETS, "kb_emb.bin"), "rb").read())
    if len(vecs) != len(rows) * DIM:
        raise ValueError("kb_emb.bin hajmi kb.json ga mos emas")
    i18n: dict[str, list] = {}
    d = os.path.join(ASSETS, "kb_i18n")
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if f.endswith(".json"):
            arr = json.load(open(os.path.join(d, f), encoding="utf-8"))
            if isinstance(arr, list) and len(arr) == len(rows):
                i18n[f[:-5]] = arr
    for i, r in enumerate(rows):
        r.pop("_i", None)
        r["uid"] = i + 1
        r["e"] = base64.b64encode(vecs[i * DIM:(i + 1) * DIM].tobytes()).decode("ascii")
        t = {lang: arr[i] for lang, arr in i18n.items() if arr[i]}
        if t:
            r["t"] = t
    return rows


def _write(rows: list[dict]) -> None:
    path = _store_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix="kb-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
        if os.path.exists(path):
            shutil.copy2(path, path + ".bak")
        os.replace(tmp, path)
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _set(rows: list[dict]) -> None:
    """Xotiradagi holatni ALMASHTIRADI (joyida o'zgartirmaydi): qidiruv o'z nusxasi bilan ishlab turgan bo'lsa buzilmaydi."""
    global _rows, _vecs, _spoken
    vecs = array.array("f")
    zero = array.array("f", [0.0] * DIM)
    for r in rows:
        v = array.array("f")
        try:
            v.frombytes(base64.b64decode(r.get("e") or ""))
        except Exception:  # noqa: BLE001
            v = array.array("f")
        vecs.extend(v if len(v) == DIM else zero)  # embeddingi yo'q qator — nol vektor (qidiruvda chiqmaydi)
    _rows, _vecs, _spoken = rows, vecs, None


def _load() -> None:
    global _loaded
    if _loaded:
        return
    with _lock:
        if _loaded:
            return
        try:
            if os.path.exists(_store_path()):
                rows = json.load(open(_store_path(), encoding="utf-8"))
            else:
                rows = _seed_from_assets()
                try:
                    _write(rows)
                    log.info("bilim bazasi boshlang'ich ma'lumotdan qurildi: %d qator -> %s", len(rows), _store_path())
                except OSError as e:
                    log.warning("bilim bazasi faylga yozilmadi (faqat xotirada): %s", e)
            _set(rows)
        except Exception as e:  # noqa: BLE001
            log.warning("bilim bazasi yuklanmadi: %s", e)
            _set([])
        _loaded = True


def reload() -> None:
    """Testlar / KB_DIR o'zgarganda: fayldan qayta o'qiydi."""
    global _loaded
    with _lock:
        _loaded = False
    _load()


def available() -> bool:
    _load()
    return bool(_rows)


def rows() -> list[dict]:
    """Hamma qatorlar (faqat O'QISH uchun — o'zgartirish add/update/delete orqali)."""
    _load()
    return _rows


def get(uid: int) -> dict | None:
    _load()
    for r in _rows:
        if r.get("uid") == uid:
            return r
    return None


def add(fields: dict) -> dict:
    """Yangi qator (uid beriladi). fields: q, a, quz, s, t, e, x, ms."""
    _load()
    with _lock:
        row = {k: v for k, v in fields.items() if v not in (None, "", {}, False)}
        row["uid"] = max((r.get("uid", 0) for r in _rows), default=0) + 1
        new = _rows + [row]
        _write(new)
        _set(new)
        return row


def update(uid: int, fields: dict) -> dict | None:
    """Qatorni yangilaydi: fields dagi kalitlar almashtiriladi; qiymati None/""/{}/False bo'lsa kalit olib tashlanadi."""
    _load()
    with _lock:
        new, out = [], None
        for r in _rows:
            if r.get("uid") == uid:
                r = dict(r)
                for k, v in fields.items():
                    if v in (None, "", {}, False):
                        r.pop(k, None)
                    else:
                        r[k] = v
                out = r
            new.append(r)
        if out is None:
            return None
        _write(new)
        _set(new)
        return out


def delete(uid: int) -> bool:
    _load()
    with _lock:
        new = [r for r in _rows if r.get("uid") != uid]
        if len(new) == len(_rows):
            return False
        _write(new)
        _set(new)
        return True


def spoken(row: dict, lang: str = "uz") -> str:
    """Qatorning tayyor ovozli javobi yo'lovchi tilida ("" — yo'q: javobni LLM yozadi)."""
    if lang == "uz":
        return row.get("s") or ""
    return (row.get("t") or {}).get(lang) or ""


def spoken_texts() -> set:
    """Tayyor ovozli javob matnlari (hamma tilda) — audio diskda keshlanadi (birinchi so'rovdan keyin darhol)."""
    _load()
    global _spoken
    if _spoken is None:
        out = set()
        for r in _rows:
            if r.get("s"):
                out.add(r["s"])
            out.update(v for v in (r.get("t") or {}).values() if v)
        _spoken = out
    return _spoken


async def embed(client, text: str, document: bool = False) -> list[float]:
    res = await client.aio.models.embed_content(
        model=EMB_MODEL, contents=[text],
        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT" if document else "RETRIEVAL_QUERY", output_dimensionality=DIM),
    )
    return list(res.embeddings[0].values)


async def search(client, text: str, k: int = 4) -> list[tuple[float, dict]]:
    """[(o'xshashlik 0..1, qator)] — kamayish tartibida. O'chirib qo'yilgan (x) qatorlar chiqmaydi."""
    _load()
    rows_, vecs = _rows, _vecs  # shu paytdagi nusxa (admin o'zgartirsa ham izchil)
    if not rows_ or not text.strip():
        return []
    q = await embed(client, text)
    n = sum(x * x for x in q) ** 0.5 or 1.0
    q = [x / n for x in q]
    scores = []
    for i, r in enumerate(rows_):
        if r.get("x"):
            continue
        base = i * DIM
        scores.append((sum(a * b for a, b in zip(q, vecs[base:base + DIM])), i))
    scores.sort(reverse=True)
    return [(s, rows_[i]) for s, i in scores[:k]]
