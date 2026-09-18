"""Pydantic sxemalar."""
from pydantic import BaseModel, Field


class Source(BaseModel):
    title: str = ""
    url: str = ""


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    lang: str = "uz"
    session_id: str = ""


class AskResponse(BaseModel):
    answer: str
    source_type: str          # faq | web | redirect
    sources: list[Source] = []
    faq_id: int | None = None
    grounded: bool = False
    lang: str = "uz"
    disclaimer: str = ""


class FaqItemOut(BaseModel):
    id: int
    question: str
    answer: str
    lang: str = "uz"


class FaqListOut(BaseModel):
    items: list[FaqItemOut]


class SearchRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    lang: str = "uz"
