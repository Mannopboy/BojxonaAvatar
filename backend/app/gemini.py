"""Gemini klient — grounded javob (Google Search) + TTS (ADR-003, ADR-005).

Kalit faqat backendda. Kalit yo'q bo'lsa — grounding o'chadi, xavfsiz fallback qaytadi.
"""
from urllib.parse import urlparse

from .config import get_settings

settings = get_settings()

# System instruction — ADR-004 QOIDA 1-4: xotiradan raqam AYTMA
SYSTEM_INSTRUCTION = (
    "Sen O'zbekiston Respublikasi Davlat bojxona qo'mitasi virtual xodimisan.\n"
    "QOIDA 1: FAQAT Google Search orqali topilgan RASMIY manba (customs.uz, lex.uz, "
    "gov.uz, my.gov.uz) ma'lumotiga asoslanib javob ber.\n"
    "QOIDA 2: O'Z BILIMINGDAN (xotirangdan) raqam, summa, sana yoki tarif AYTMA. "
    "Har doim qidiruv natijasidan ol.\n"
    "QOIDA 3: Agar rasmiy manbadan aniq javob topolmasang — 'Bu savol bo'yicha aniq "
    "ma'lumot uchun bojxona xodimiga yoki customs.uz saytiga murojaat qiling' deb ayt. "
    "O'YLAB TOPMA.\n"
    "QOIDA 4: Javobni hurmatli, rasmiy va qisqa qilib ber. 'Hurmatli yo'lovchi!' bilan boshla.\n"
    "Til: foydalanuvchi savoli tilida (o'zbek yoki rus) javob ber."
)

_NO_SOURCE_MSG = (
    "Hurmatli yo'lovchi! Bu savol bo'yicha rasmiy manbadan aniq ma'lumot topilmadi. "
    "Iltimos, bojxona xodimiga yoki customs.uz saytiga murojaat qiling."
)

_client = None


def _get_client():
    global _client
    if _client is None:
        from google import genai  # lazy import
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _domain(s: str) -> str:
    """Domen chiqaradi. Gemini grounding'da manba domeni `web.title` da bo'ladi
    (masalan 'lex.uz'), `web.uri` esa google redirect — shuning uchun ikkalasini ham qo'llab-quvvatlaymiz."""
    s = (s or "").lower().strip().replace("www.", "")
    if s.startswith("http"):
        try:
            return (urlparse(s).netloc or "").replace("www.", "")
        except Exception:
            return ""
    return s


def _allowed(domain: str) -> bool:
    d = _domain(domain)
    return bool(d) and any(d == s or d.endswith("." + s) for s in settings.allowed_source_list)


def search_official(question: str, lang: str = "uz") -> dict:
    """Gemini + Google Search grounding, faqat rasmiy manba (allowlist).

    Natija: {answer, sources: [{title,url}], grounded: bool}
    """
    if not settings.gemini_ready or not settings.grounding_enabled:
        return {"answer": _NO_SOURCE_MSG, "sources": [], "grounded": False}

    try:
        from google.genai import types
        client = _get_client()
        resp = client.models.generate_content(
            model=settings.gemini_text_model,
            contents=question,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=0.2,
            ),
        )
    except Exception as e:  # noqa: BLE001
        return {"answer": _NO_SOURCE_MSG, "sources": [], "grounded": False, "error": str(e)}

    answer = (resp.text or "").strip()

    # Grounding manbalarini yig'ish + allowlist filtri
    sources: list[dict] = []
    try:
        cand = resp.candidates[0]
        meta = getattr(cand, "grounding_metadata", None)
        chunks = getattr(meta, "grounding_chunks", None) or []
        for ch in chunks:
            web = getattr(ch, "web", None)
            if not web:
                continue
            url = getattr(web, "uri", "") or ""       # google redirect (bosilganda ishlaydi)
            title = getattr(web, "title", "") or ""   # Gemini bu yerga DOMENni beradi (masalan lex.uz)
            domain = _domain(title) or _domain(url)
            if _allowed(domain):
                sources.append({"title": title or domain, "url": url or f"https://{domain}"})
    except Exception:  # noqa: BLE001
        pass

    # dedup
    seen, uniq = set(), []
    for s in sources:
        if s["url"] not in seen:
            seen.add(s["url"])
            uniq.append(s)

    if not uniq:
        # Rasmiy manba topilmadi → o'ylab topmaslik uchun fallback
        return {"answer": _NO_SOURCE_MSG, "sources": [], "grounded": False}

    return {"answer": answer or _NO_SOURCE_MSG, "sources": uniq, "grounded": True}
