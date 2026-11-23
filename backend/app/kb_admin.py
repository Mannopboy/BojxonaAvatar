"""Bilim bazasi admin paneli API (frontend: /admin). Hamma yo'l X-Admin-Key (KB_ADMIN_KEY) bilan himoyalangan; kalit sozlanmagan bo'lsa — 503.

  GET    /admin/kb/ping                      kalitni tekshirish + statistika
  GET    /admin/kb?search=&filter=&offset=&limit=   ro'yxat (filter: all | active | inactive | noready)
  GET    /admin/kb/export                    hamma qatorlar (JSON fayl — zaxira nusxa)
  GET    /admin/kb/{uid}                     bitta qator (tarjimalari bilan)
  POST   /admin/kb                           yangi savol-javob
  PUT    /admin/kb/{uid}                     tahrirlash
  DELETE /admin/kb/{uid}                     o'chirish
  POST   /admin/kb/test                      «sinab ko'rish»: avatar shu savolga nima deb javob beradi

Yangi/tahrirlangan qator 1000 talik baza qatorlari bilan BIR XIL tayyorlanadi (`prepare`): savolning o'zbekcha matni (quz) + embedding, ovozda aytiladigan qisqa javob (s),
12 tilga tarjima (t). Shuning uchun saqlash ~5-10 soniya oladi. Tashqaridan (host nginx /api prefiksini olib tashlaydi): /api/admin/kb/..."""
import asyncio
import hmac
import json
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from google.genai import types
from pydantic import BaseModel, Field

from . import kb
from . import tts_voice as tv
from .config import get_settings
from .translit import to_latin

settings = get_settings()
log = logging.getLogger("uvicorn.error")

LANGS = [k for k in tv.LANG_EN if k not in ("uz", "xx")]
_write_lock = asyncio.Lock()  # bir vaqtda bitta o'zgartirish (tayyorlash paytida boshqa saqlash aralashmasin)
_fails: dict[str, list[float]] = {}  # ip -> noto'g'ri kalit urinishlari vaqti (parolni tanlab topishga qarshi)
FAIL_WINDOW_S, FAIL_MAX = 600, 8


def _ip(request: Request) -> str:
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "?")


def require_admin(request: Request) -> None:
    key = settings.kb_admin_key
    if not key:
        raise HTTPException(status_code=503, detail="admin panel o'chirilgan (KB_ADMIN_KEY sozlanmagan)")
    ip, now = _ip(request), time.time()
    recent = [t for t in _fails.get(ip, []) if now - t < FAIL_WINDOW_S]
    if len(recent) >= FAIL_MAX:
        _fails[ip] = recent
        raise HTTPException(status_code=429, detail="juda ko'p noto'g'ri urinish — 10 daqiqadan keyin qayta urinib ko'ring")
    if not hmac.compare_digest(request.headers.get("x-admin-key", "").encode(), key.encode()):
        _fails[ip] = recent + [now]
        raise HTTPException(status_code=401, detail="kalit noto'g'ri")
    _fails.pop(ip, None)


router = APIRouter(prefix="/admin/kb", dependencies=[Depends(require_admin)])


class RowIn(BaseModel):
    q: str = Field(min_length=3, max_length=1500)
    a: str = Field(min_length=3, max_length=12000)
    s: str = Field(default="", max_length=700)
    auto_s: bool = True  # True — qisqa ovozli javobni tizim yozadi; False — `s` dagi matn (admin yozgan) ishlatiladi
    active: bool = True


class TestIn(BaseModel):
    q: str = Field(min_length=2, max_length=500)


def _model() -> str:
    return settings.gemini_chat_model or settings.gemini_text_model


def _cfg(**kw) -> types.GenerateContentConfig:
    if "2.5" in _model():
        kw["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
    return types.GenerateContentConfig(**kw)


SPOKEN_SYS = (
    "Sen O'zbekiston bojxona qo'mitasining virtual xodimisan. Senga rasmiy savol-javob beriladi (o'zbek yoki rus tilida, kirill yozuvida bo'lishi mumkin). JSON qaytar: "
    "quz — savolning O'ZBEK tilidagi (LOTIN yozuvida) aniq matni (savol o'zbekcha bo'lsa lotinga o'gir, ruscha bo'lsa tarjima qil); "
    "s — yo'lovchiga OVOZDA aytiladigan O'ZBEKCHA (LOTIN) qisqa javob: 2-3 gap, berilgan javob mazmunidan tashqariga chiqma, qaror raqami, sanasi va modda raqamini aytma, "
    "raqam va summalarni SO'Z bilan yoz ('bir ming dollar'), belgi/ro'yxat/qavssiz, 'Siz' deb murojaat qil, salomlashma."
)


async def make_spoken(q: str, a: str) -> tuple[str, str]:
    """(quz, s): savolning o'zbekcha matni va ovozli qisqa javob. Xato bo'lsa quz = to_latin(q), s = ""."""
    try:
        r = await tv._gc().aio.models.generate_content(
            model=_model(), contents=f"Savol: {q}\nJavob: {a[:6000]}",
            config=_cfg(system_instruction=SPOKEN_SYS, temperature=0.2, max_output_tokens=900, response_mime_type="application/json",
                        response_schema={"type": "OBJECT", "properties": {"quz": {"type": "STRING"}, "s": {"type": "STRING"}}, "required": ["quz", "s"]}))
        j = json.loads(r.text or "{}")
        quz = tv.clean_for_speech(str(j.get("quz") or "")) or to_latin(q)
        s = tv._shorten(tv.clean_for_speech(str(j.get("s") or "")), 3, 320, 460)
        return quz, s
    except Exception as e:  # noqa: BLE001
        log.warning("admin: qisqa javob yaratilmadi: %s: %s", type(e).__name__, str(e)[:160])
        return to_latin(q), ""


async def translate_all(s: str) -> dict[str, str]:
    """Qisqa javobning 12 tilga tarjimasi {til: matn}. Topilmagan tillar tashlab ketiladi (o'sha tilda javobni runtime'da LLM yozadi)."""
    out: dict[str, str] = {}
    sys_ = ("You translate a short spoken answer of a customs officer of Uzbekistan from Uzbek into several languages. The translations are read ALOUD to a passenger. "
            "Rules: natural, formal and polite, each in its standard native script (never transliterate); keep EVERY fact, amount, limit and condition exactly - add nothing, omit nothing; "
            "numbers and amounts stay spelled out as WORDS (no digits); no markdown, lists, brackets or emoji; no greetings. "
            "Return ONLY a JSON object {language_code: translation} with exactly the requested codes.")
    for _attempt in range(3):
        todo = [k for k in LANGS if k not in out]
        if not todo:
            break
        try:
            r = await tv._gc().aio.models.generate_content(
                model=_model(), contents="Text: " + s + "\nLanguages: " + json.dumps({k: tv.LANG_EN[k] for k in todo}),
                config=_cfg(system_instruction=sys_, temperature=0.1, max_output_tokens=4000, response_mime_type="application/json"))
            j = json.loads(r.text or "{}")
            for k in todo:
                v = tv.clean_for_speech(str(j.get(k) or "")) if isinstance(j, dict) else ""
                if v:
                    out[k] = v
        except Exception as e:  # noqa: BLE001
            log.warning("admin: tarjima xatosi: %s: %s", type(e).__name__, str(e)[:160])
    return out


async def embed_question(quz: str) -> str:
    return kb.pack_vec(await kb.embed(tv._gc(), quz, document=True))


async def prepare(body: RowIn, old: dict | None) -> dict:
    """Saqlanadigan maydonlar. Faqat o'zgargan qismi qayta tayyorlanadi: savol o'zgarsa — quz + embedding; qisqa javob o'zgarsa — tarjimalar."""
    q, a = body.q.strip(), body.a.strip()
    manual = (not body.auto_s) and bool(body.s.strip())
    q_changed = old is None or old.get("q") != q
    a_changed = old is None or old.get("a") != a
    fields: dict = {"q": q, "a": a, "x": 0 if body.active else 1, "ms": 1 if manual else 0}

    quz, s = (old or {}).get("quz") or "", (old or {}).get("s") or ""
    need_llm = q_changed or not quz or (not manual and (a_changed or not s or (old or {}).get("ms")))
    if need_llm:
        new_quz, new_s = await make_spoken(q, a)
        if q_changed or not quz:
            quz = new_quz
        if not manual:
            s = new_s
    if manual:
        s = tv.clean_for_speech(body.s.strip())
    fields["quz"], fields["s"] = quz, s

    if q_changed or not (old or {}).get("e"):
        try:
            fields["e"] = await embed_question(quz or to_latin(q))
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"embedding yaratilmadi (Gemini): {str(e)[:120]}") from e
    if s != (old or {}).get("s") or not (old or {}).get("t"):
        fields["t"] = await translate_all(s) if s else {}
    return fields


def public(row: dict, full: bool = False) -> dict:
    out = {"uid": row["uid"], "id": row.get("id") or "", "q": row.get("q") or "", "quz": row.get("quz") or "", "s": row.get("s") or "",
           "active": not row.get("x"), "manual_s": bool(row.get("ms")), "langs": len(row.get("t") or {}), "has_emb": bool(row.get("e"))}
    if full:
        out["a"] = row.get("a") or ""
        out["t"] = row.get("t") or {}
    else:
        out["a_short"] = (row.get("a") or "")[:220]
    return out


def stats() -> dict:
    rows = kb.rows()
    return {"total": len(rows), "active": sum(1 for r in rows if not r.get("x")), "ready": sum(1 for r in rows if r.get("s") and not r.get("x")),
            "langs": len(LANGS) + 1}


@router.get("/ping")
def ping():
    return {"ok": True, **stats()}


@router.get("")
def list_rows(search: str = "", filter: str = "all", offset: int = 0, limit: int = 50):
    rows = kb.rows()
    if filter == "active":
        rows = [r for r in rows if not r.get("x")]
    elif filter == "inactive":
        rows = [r for r in rows if r.get("x")]
    elif filter == "noready":
        rows = [r for r in rows if not r.get("s")]
    needle = search.strip().lower()
    if needle:
        lat = to_latin(needle).lower()

        def hit(r: dict) -> bool:
            if needle.isdigit() and str(r.get("uid")) == needle:
                return True
            hay = " ".join(str(r.get(k) or "") for k in ("q", "quz", "a", "s")).lower()
            return needle in hay or lat in to_latin(hay)

        rows = [r for r in rows if hit(r)]
    total = len(rows)
    offset, limit = max(0, offset), max(1, min(200, limit))
    page = list(reversed(rows))[offset:offset + limit]  # eng yangi qo'shilganlar tepada
    return {"total": total, "offset": offset, "limit": limit, "items": [public(r) for r in page], "stats": stats()}


@router.get("/export")
def export():
    data = [{k: v for k, v in r.items() if k != "e"} for r in kb.rows()]
    return Response(content=json.dumps(data, ensure_ascii=False, indent=1), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="bilim-bazasi-{time.strftime("%Y%m%d-%H%M")}.json"'})


@router.post("/test")
async def test(body: TestIn):
    """Avatar shu savolga nima deydi: yo'naltirish (til, tayyor javob), bazadagi eng yaqin savollar va yakuniy javob matni (ovozsiz — TTS kvotasi sarflanmaydi)."""
    contents = [types.Content(role="user", parts=[types.Part(text=body.q.strip())])]
    t0 = time.monotonic()
    try:
        clip, lang, quz = await tv._route(contents)
        hits = await kb.search(tv._gc(), quz, 5) if quz else []

        async def ok(_lang: str) -> bool:
            return True

        clip2, text = await tv._llm_answer(contents, ok, None)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Gemini xatosi: {str(e)[:160]}") from e
    top = hits[0] if hits else None
    if clip2 or (clip and clip != tv.CHAT and text in tv.ANSWER_I18N_TEXTS):
        source = "tayyor javob (" + str(clip2 or clip) + ")"
    elif clip == tv.CHAT:
        source = "suhbat javobi"
    elif top and text == kb.spoken(top[1], lang):
        source = f"bilim bazasi — tayyor javob (#{top[1]['uid']})"
    elif top and top[0] >= tv.KB_MIN_SCORE:
        source = "bilim bazasi — model yozgan javob"
    else:
        source = "internet qidiruvi"
    return {"lang": lang, "quz": quz, "answer": text, "source": source, "ms": int((time.monotonic() - t0) * 1000),
            "hits": [{"score": round(s, 3), "uid": r["uid"], "q": r.get("quz") or to_latin(r.get("q") or ""), "ready": bool(kb.spoken(r, lang))} for s, r in hits]}


@router.get("/{uid}")
def get_row(uid: int):
    row = kb.get(uid)
    if not row:
        raise HTTPException(status_code=404, detail="topilmadi")
    return public(row, full=True)


@router.post("", status_code=201)
async def create(body: RowIn):
    async with _write_lock:
        fields = await prepare(body, None)
        row = kb.add(fields)
    log.info("admin: yangi qator #%s q=%s", row["uid"], row["q"][:60])
    return public(row, full=True)


@router.put("/{uid}")
async def update(uid: int, body: RowIn):
    async with _write_lock:
        old = kb.get(uid)
        if not old:
            raise HTTPException(status_code=404, detail="topilmadi")
        fields = await prepare(body, old)
        row = kb.update(uid, fields)
    log.info("admin: qator #%s yangilandi", uid)
    return public(row, full=True)


@router.delete("/{uid}")
async def remove(uid: int):
    async with _write_lock:
        if not kb.delete(uid):
            raise HTTPException(status_code=404, detail="topilmadi")
    log.info("admin: qator #%s o'chirildi", uid)
    return {"ok": True, **stats()}
