"""Bilim bazasi (1000+ savol-javob, app/assets/kb.json) — embedding bilan tez qidiruv (RAG).
Savol matni (lotin yozuvida) -> eng yaqin savollar (+ javoblari) -> LLM qisqa ovozli javob beradi (internetsiz, ~1 s)."""
import array
import json
import logging
import os

from google.genai import types

log = logging.getLogger("kb")
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
EMB_MODEL, DIM = "gemini-embedding-001", 256

_rows: list[dict] = []
_vecs: array.array | None = None
_spoken: set | None = None


def _load() -> None:
    global _rows, _vecs
    if _rows:
        return
    try:
        _rows = json.load(open(os.path.join(ASSETS, "kb.json"), encoding="utf-8"))
        _vecs = array.array("f")
        _vecs.frombytes(open(os.path.join(ASSETS, "kb_emb.bin"), "rb").read())
        if len(_vecs) != len(_rows) * DIM:
            raise ValueError("kb_emb.bin hajmi kb.json ga mos emas")
        for i, r in enumerate(_rows):
            r["_i"] = i
    except Exception as e:  # noqa: BLE001
        log.warning("bilim bazasi yuklanmadi: %s", e)
        _rows, _vecs = [], None


def available() -> bool:
    _load()
    return bool(_rows)


_i18n: dict[str, list[str]] = {}  # til -> kb.json qatorlari tartibida oldindan tarjima qilingan ovozli javoblar (scripts/build_kb_i18n.py)


def _load_i18n(lang: str) -> list[str]:
    if lang not in _i18n:
        try:
            arr = json.load(open(os.path.join(ASSETS, "kb_i18n", lang + ".json"), encoding="utf-8"))
            _i18n[lang] = arr if isinstance(arr, list) and len(arr) == len(_rows) else []
        except Exception:  # noqa: BLE001
            _i18n[lang] = []
    return _i18n[lang]


def spoken(row: dict, lang: str = "uz") -> str:
    """Qatorning tayyor ovozli javobi yo'lovchi tilida ("" — yo'q: LLM javob beradi)."""
    _load()
    if lang == "uz":
        return row.get("s") or ""
    arr = _load_i18n(lang)
    i = row.get("_i", -1)
    return arr[i] if 0 <= i < len(arr) else ""


def spoken_texts() -> set:
    """Tayyor ovozli javob matnlari (hamma tilda) — audio diskda keshlanadi (birinchi so'rovdan keyin darhol)."""
    _load()
    global _spoken
    if _spoken is None:
        _spoken = {r['s'] for r in _rows if r.get('s')}
        try:
            for f in os.listdir(os.path.join(ASSETS, "kb_i18n")):
                if f.endswith(".json"):
                    _spoken.update(x for x in _load_i18n(f[:-5]) if x)
        except OSError:
            pass
    return _spoken


async def search(client, text: str, k: int = 4) -> list[tuple[float, dict]]:
    """[(o'xshashlik 0..1, {id,q,a})] — kamayish tartibida."""
    _load()
    if not _rows or not text.strip():
        return []
    res = await client.aio.models.embed_content(
        model=EMB_MODEL, contents=[text],
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY", output_dimensionality=DIM),
    )
    q = res.embeddings[0].values
    n = sum(x * x for x in q) ** 0.5 or 1.0
    q = [x / n for x in q]
    scores = []
    for i in range(len(_rows)):
        if _rows[i].get("x"):  # manbada javobi savolga mos kelmaydigan qator — ishlatilmaydi
            continue
        base = i * DIM
        scores.append((sum(a * b for a, b in zip(q, _vecs[base:base + DIM])), i))
    scores.sort(reverse=True)
    return [(s, _rows[i]) for s, i in scores[:k]]
