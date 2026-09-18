"""Konfiguratsiya — .env dan o'qiladi (ADR-003: kalit faqat backendda)."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    gemini_text_model: str = "gemini-2.5-flash"

    grounding_enabled: bool = True
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
