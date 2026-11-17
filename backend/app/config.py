"""Konfiguratsiya — .env dan o'qiladi (ADR-003: kalit faqat backendda)."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    gemini_text_model: str = "gemini-2.5-flash"
    # Gemini Live ovozi (erkak: Orus/Fenrir/Puck; ayol: Kore/Aoede/Leda). Avatar — ayol xodim, shuning uchun ayol ovozi.
    gemini_voice: str = "Kore"
    # Gemini Live modeli. gemini-3.8-live-extended-thinking: o'zbekchada aksentsiz (foydalanuvchi 4 modeldan tanladi, 2026-11-09).
    # gemini-2.5-* modellar ham ishlaydi (qo'lda activity bilan) — kerak bo'lsa .env da GEMINI_LIVE_MODEL bilan qaytarish mumkin.
    gemini_live_model: str = "gemini-3.8-live-extended-thinking"
    gemini_live_thinking: str = "LOW"  # extended-thinking modeli uchun majburiy: MINIMAL | LOW | MEDIUM | HIGH (LOW — tez javob)
    live_greeting: bool = True  # ulanishda avatar o'zi salomlashadi

    # Ovoz zanjiri: "tts" — Gemini matn modeli (ovozli savolni tushunadi) + Gemini TTS (gemini-3.8-flash-tts) ovozlaydi;
    # "live" — Gemini Live (yuqoridagi model). Foydalanuvchi 2026-11-10 da TTS ovozini tanladi (Live ovozida talaffuz xatolari bor edi).
    voice_engine: str = "tts"
    gemini_tts_model: str = "gemini-3.8-flash-tts"
    # Asosiy TTS modelining kunlik kvotasi (Tier 1: kuniga 100 so'rov) tugasa — shu model (alohida kvota). Ikkalasi ham tugasa yangi suhbatlar Gemini Live'ga o'tadi.
    gemini_tts_fallback_model: str = "gemini-3.8-flash-lite-tts"
    tts_live_fallback: bool = True  # ikkala TTS modeli kvotasi tugasa — matnni Gemini Live o'qib beradi (tayyor javob kliplari ishlashda davom etadi)
    # Ovozlar (ikkalasi ham AYOL — avatar ayol xodim; yo'lovchi suhbat o'rtasida ovoz almashganini eshitmasin). `GEMINI_VOICE` faqat sof Gemini Live yo'li (VOICE_ENGINE=live) uchun qoldi:
    # serverdagi eski .env da GEMINI_VOICE=Orus (erkak) turgan bo'lsa ham asosiy TTS va zaxira Live ovozi o'zgarmasin.
    gemini_tts_voice: str = "Kore"  # asosiy TTS (gemini-3.8-flash-tts) ovozi
    gemini_live_fallback_voice: str = "Kore"  # TTS kvotasi tugaganda matnni o'qiydigan Gemini Live ovozi (o'lchangan: F0 185–229 Hz — ayol)
    gemini_chat_model: str = ""  # bo'sh bo'lsa gemini_text_model ishlatiladi
    # TTS barqarorligi: standart haroratda (1.0) bir xil matn har chaqiruvda turlicha o'qiladi (o'lchangan: tezlik ±0.65 s / 7 s, balandlik ±30%, ohang ±4%) — suhbat
    # o'rtasida ovoz "qalinlashib/o'zgarib" qolgandek eshitiladi. Past harorat + qat'iy seed shuni bartaraf etadi (davomiylik ±0.05 s).
    gemini_tts_temperature: float = 0.2
    gemini_tts_seed: int = 7
    # Salom matni app/assets/greeting.txt bilan bir xil bo'lishi kerak: salom videosi (frontend/public/avatar/greeting.mp4) aynan shu audio (assets/greeting.pcm) bilan yaratilgan —
    # lab harakati ovozga mos. Boshqa matn qo'yilsa TTS ovozlaydi va video bilan mos kelmaydi.
    greeting_text: str = "Assalomu alaykum, hurmatli yo'lovchi! Men Davlat bojxona qo'mitasining virtual xodimiman."

    # Kiosk ilova (bojxona_gologramma) reliz fayllari: manifest latest.json + files/bojxona_gologramma_setup_<versiya>.exe. Docker'da /app/data (backend_data volume) ichida — deploy o'chirmaydi.
    releases_dir: str = "data/releases"
    release_admin_key: str = ""  # POST /app/windows/release uchun X-Admin-Key; bo'sh bo'lsa yuklash O'CHIQ (503). Yo'lovchi reliz yuklay olmasin
    public_base_url: str = ""  # manifest `url` uchun tashqi manzil (bo'sh bo'lsa so'rov sarlavhalaridan: https://<host>)
    audio_cache_dir: str = "data/audio_cache"  # runtime audio keshi (Docker'da /app/data/audio_cache — volume)
    release_max_mb: int = 300
    release_keep: int = 3  # eng yangi shuncha o'rnatuvchi saqlanadi (har biri ~68 MB)

    grounding_enabled: bool = True
    # Ovozli suhbat (tts yo'li): tayyor javobga mos kelmagan savol INTERNETDAN qidiriladi (Google Search grounding; to'qimaydi). VOICE_WEB_SEARCH=false — eski usul (faqat tasdiqlangan faktlar)
    voice_web_search: bool = True
    # true — faqat RASMIY manba (allowed_sources) asosidagi javob aytiladi, aks holda «topa olmadim». false (standart) — norasmiy manbadagi javob ham aytiladi, lekin oxirida «bojxona xodimiga aniqlashtiring» deyiladi
    voice_search_official_only: bool = False
    # Rasmiy manba allowlist (vergul bilan) — ADR-005
    allowed_sources: str = "customs.uz,lex.uz,gov.uz,my.gov.uz"

    database_url: str = "sqlite:///./app.db"
    frontend_origin: str = "http://localhost:5173"

    @property
    def allowed_source_list(self) -> list[str]:
        return [s.strip().lower() for s in self.allowed_sources.split(",") if s.strip()]

    @property
    def gemini_ready(self) -> bool:
        return bool(self.gemini_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
