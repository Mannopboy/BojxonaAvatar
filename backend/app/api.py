"""API endpointlar — /faq, /avatar/ask, /search/official, /avatar/tts."""
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import classifier, gemini
from .db import get_db
from .models import ConversationLog, FaqItem
from .schemas import (
    AskRequest,
    AskResponse,
    FaqItemOut,
    FaqListOut,
    SearchRequest,
    Source,
)

router = APIRouter()

_DISCLAIMER = f"Ma'lumot {date.today().isoformat()} holatiga ko'ra. Aniq raqam uchun customs.uz."


def _log(db: Session, req_q: str, session_id: str, ans: str, stype: str, sources: list, lang: str):
    try:
        db.add(ConversationLog(
            session_id=session_id or "", question=req_q, answer=ans,
            source_type=stype, sources=sources, lang=lang,
        ))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()


@router.get("/faq", response_model=FaqListOut)
def get_faq(db: Session = Depends(get_db)):
    """3 asosiy savol-javob (avatar boshlanish ekrani)."""
    items = db.scalars(select(FaqItem).order_by(FaqItem.id)).all()
    return FaqListOut(items=[
        FaqItemOut(id=i.id, question=i.question, answer=i.answer, lang=i.lang) for i in items
    ])


@router.post("/avatar/ask", response_model=AskResponse)
def avatar_ask(req: AskRequest, db: Session = Depends(get_db)):
    """Yo'lovchi savoli → klassifikatsiya → grounded javob (ADR-004)."""
    faq_items = db.scalars(select(FaqItem)).all()
    result = classifier.classify(req.question, faq_items)

    # 1) FAQ — DB'dan aniq javob (Gemini shart emas)
    if result["type"] == "faq":
        faq = result["faq"]
        _log(db, req.question, req.session_id, faq.answer, "faq",
             [{"title": "Bojxona FAQ", "url": "https://customs.uz"}], req.lang)
        return AskResponse(
            answer=faq.answer, source_type="faq", faq_id=faq.id,
            sources=[Source(title="Bojxona FAQ (rasmiy)", url="https://customs.uz")],
            grounded=True, lang=req.lang, disclaimer=_DISCLAIMER,
        )

    # 2) WEB — Gemini + Google Search grounding (rasmiy manba)
    if result["type"] == "web":
        g = gemini.search_official(req.question, req.lang)
        srcs = [Source(**s) for s in g["sources"]]
        _log(db, req.question, req.session_id, g["answer"], "web", g["sources"], req.lang)
        return AskResponse(
            answer=g["answer"], source_type="web", sources=srcs,
            grounded=g["grounded"], lang=req.lang,
            disclaimer=_DISCLAIMER if g["grounded"] else "",
        )

    # 3) REDIRECT — aloqasiz / o'ylab topmaydi
    _log(db, req.question, req.session_id, classifier.REDIRECT_MSG_UZ, "redirect", [], req.lang)
    return AskResponse(
        answer=classifier.REDIRECT_MSG_UZ, source_type="redirect",
        sources=[], grounded=False, lang=req.lang,
    )


@router.post("/search/official", response_model=AskResponse)
def search_official(req: SearchRequest, db: Session = Depends(get_db)):
    """Qo'shimcha savol → to'g'ridan-to'g'ri rasmiy web grounding (ADR-005)."""
    g = gemini.search_official(req.question, req.lang)
    _log(db, req.question, "", g["answer"], "web", g["sources"], req.lang)
    return AskResponse(
        answer=g["answer"], source_type="web",
        sources=[Source(**s) for s in g["sources"]],
        grounded=g["grounded"], lang=req.lang,
        disclaimer=_DISCLAIMER if g["grounded"] else "",
    )
