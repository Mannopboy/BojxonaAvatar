"""ORM modellar — faq_items, conversation_log, sessions."""
from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class FaqItem(Base):
    __tablename__ = "faq_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(255), default="docx")
    lang: Mapped[str] = mapped_column(String(8), default="uz")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ConversationLog(Base):
    __tablename__ = "conversation_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(String(64), default="")
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(16), default="faq")  # faq | web | redirect
    sources: Mapped[list] = mapped_column(JSON, default=list)
    lang: Mapped[str] = mapped_column(String(8), default="uz")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
