"""Savol klassifikatsiyasi — faq | web | redirect (ADR-004).

Yengil keyword matcher (Gemini'siz ishlaydi). 3 asosiy savolga mos kelsa — DB'dan
aniq javob (tez, ishonchli). Bojxonaga oid boshqa savol — web grounding. Aloqasiz — redirect.
"""
import re

# Bojxona sohasiga oid keng kalit so'zlar (web grounding uchun trigger)
CUSTOMS_TERMS = [
    "boj", "bojxona", "bojhona", "bojxonaga", "deklaratsiya", "deklarat",
    "valyuta", "valuta", "tovar", "chegara", "import", "eksport", "eksport",
    "olib kir", "olib chiq", "olib o't", "aeroport", "temir yo'l", "poyezd",
    "daryo", "avtomobil", "mashina", "piyoda", "pochta", "kuryer", "jo'natma",
    "posilka", "posilka", "dollar", "so'm", "pul", "naqd", "ruxsatnoma",
    "aksiz", "tamaki", "sigaret", "alkogol", "spirt", "dori", "telefon",
    "texnika", "mahsulot", "yuk", "bagaj", "chamadon", "tamojnya", "limit",
    "soliq", "to'lov", "tolov", "gumruk",
]

REDIRECT_MSG_UZ = (
    "Hurmatli yo'lovchi! Bu savol bo'yicha aniq ma'lumot uchun bojxona xodimiga "
    "yoki customs.uz rasmiy saytiga murojaat qiling."
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().replace("ʻ", "'").replace("`", "'")).strip()


def match_faq(question: str, faq_items) -> tuple[object | None, int]:
    """Eng mos FAQ'ni topadi. (faq, score) qaytaradi. faq_items — FaqItem ro'yxati."""
    q = _norm(question)
    best = None
    best_score = 0
    for faq in faq_items:
        score = 0
        for kw in (faq.keywords or []):
            if _norm(kw) in q:
                score += 1
        if score > best_score:
            best_score = score
            best = faq
    return best, best_score


def is_customs_related(question: str) -> bool:
    q = _norm(question)
    return any(term in q for term in CUSTOMS_TERMS)


def classify(question: str, faq_items) -> dict:
    """Natija: {type, faq, ...}. type ∈ {faq, web, redirect}."""
    faq, score = match_faq(question, faq_items)
    if faq is not None and score >= 2:
        return {"type": "faq", "faq": faq, "score": score}
    if is_customs_related(question):
        # bitta kalit mos kelsa-yu, lekin FAQ emas — baribir bojxona mavzusi → web
        return {"type": "web", "faq": faq, "score": score}
    return {"type": "redirect", "faq": None, "score": score}
