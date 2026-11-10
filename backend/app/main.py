"""BojxonaAvatar backend — FastAPI (ADR-001).

Ishga tushirish:
    pip install -r requirements.txt
    python -m app.seed          # 3 FAQ seed
    uvicorn app.main:app --reload
"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .config import get_settings
from .db import Base, engine
from .live import router as live_router
from .tts_voice import warm_up
from .seed import seed

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed()  # 3 asosiy savolni kafolatlaymiz
    warm = asyncio.create_task(warm_up())  # salom ovozi oldindan tayyorlanadi
    yield
    warm.cancel()


app = FastAPI(
    title="BojxonaAvatar API",
    description="Virtual bojxona xodimi — 3 FAQ + Gemini grounding (rasmiy manba)",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(live_router)  # /ws/live — Gemini Live realtime audio


@app.get("/health")
def health():
    return {
        "status": "ok",
        "gemini_ready": settings.gemini_ready,
        "grounding_enabled": settings.grounding_enabled,
        "allowed_sources": settings.allowed_source_list,
    }
