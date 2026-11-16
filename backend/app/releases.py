"""Kiosk ilova (bojxona_gologramma, Flutter Windows) yangilanishi: manifest + o'rnatuvchi fayl + reliz yuklash.

Shartnoma (Obsidian: 09 - Mobile (App)/02 - Ilova yangilanishi (auto-update)):
  GET  /app/windows/latest                 → 200 {version, url, sha256, size, notes} yoki 404 (reliz yo'q — ilova uchun oddiy holat). Host nginx `/api` prefiksini olib tashlaydi:
                                             tashqaridan GET /api/app/windows/latest. Ochiq (token yo'q).
  GET  /downloads/<bojxona_gologramma_setup_X.Y.Z.exe>   → o'rnatuvchi (Content-Length, Range). Tashqaridan /api/downloads/… (yoki frontend nginx orqali /downloads/…).
  POST /app/windows/release?version=X.Y.Z[&notes=…][&force=1]   (X-Admin-Key; tana = .exe baytlari) — xesh va hajmni o'zi hisoblab, avval faylni, KEYIN manifestni yozadi.

Saqlash: `RELEASES_DIR` (Docker'da /app/data/releases — backend_data volume): files/<setup>.exe va latest.json. Qo'lda ham qo'yish mumkin (scp / docker cp): avval .exe, keyin latest.json.
"""
import hashlib
import hmac
import json
import logging
import os
import re
import tempfile

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from .config import get_settings

settings = get_settings()
log = logging.getLogger("uvicorn.error")
router = APIRouter()

VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
FILE_RE = re.compile(r"^bojxona_gologramma_setup_(\d+\.\d+\.\d+)\.exe$")
SHA_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def _files_dir() -> str:
    return os.path.join(settings.releases_dir, "files")


def _manifest_path() -> str:
    return os.path.join(settings.releases_dir, "latest.json")


def vkey(v: str) -> tuple[int, int, int]:
    """'1.0.10' > '1.0.9' — sonlar bo'yicha (satr bo'yicha emas)."""
    m = VERSION_RE.match(v)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else (-1, -1, -1)


def valid_manifest(d: object) -> bool:
    """Ilova rad etadigan manifestni (xato qo'lda yozilgan latest.json) mijozga bermaymiz."""
    if not isinstance(d, dict):
        return False
    url = d.get("url")
    if not (isinstance(d.get("version"), str) and VERSION_RE.match(d["version"])):
        return False
    if not (isinstance(url, str) and url.startswith("https://") and url.split("?")[0].lower().endswith(".exe")):
        return False
    if not (isinstance(d.get("sha256"), str) and SHA_RE.match(d["sha256"])):
        return False
    size = d.get("size")
    return size is None or (isinstance(size, int) and not isinstance(size, bool) and size > 0)


def read_manifest() -> dict | None:
    try:
        with open(_manifest_path(), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    return d if valid_manifest(d) else None


def _public_base(request: Request) -> str:
    """Tashqi manzil (nginx orqasida): X-Forwarded-Proto/Host dan; kiosk faqat https qabul qiladi."""
    if settings.public_base_url:
        return settings.public_base_url.rstrip("/")
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


@router.get("/app/windows/latest")
def latest() -> JSONResponse:
    d = read_manifest()
    if d is None:
        raise HTTPException(status_code=404, detail="reliz yo'q")
    return JSONResponse(d, headers={"Cache-Control": "no-store"})


@router.get("/downloads/{filename}")
def download(filename: str) -> FileResponse:
    if not FILE_RE.match(filename):  # yo'l almashtirish (../) va boshqa fayllar yo'q
        raise HTTPException(status_code=404, detail="fayl yo'q")
    path = os.path.join(_files_dir(), filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="fayl yo'q")
    return FileResponse(path, media_type="application/octet-stream", filename=filename)


def _prune(keep: int) -> None:
    """Eng yangi `keep` ta o'rnatuvchi qoladi (har biri ~68 MB)."""
    try:
        names = [n for n in os.listdir(_files_dir()) if FILE_RE.match(n)]
    except OSError:
        return
    names.sort(key=lambda n: vkey(FILE_RE.match(n).group(1)), reverse=True)  # type: ignore[union-attr]
    for n in names[keep:]:
        try:
            os.remove(os.path.join(_files_dir(), n))
        except OSError:
            pass


@router.post("/app/windows/release", status_code=201)
async def release(request: Request, version: str, notes: str = "", force: bool = False) -> JSONResponse:
    """O'rnatuvchi yuklash: tana = .exe baytlari (application/octet-stream). Xesh/hajmni server hisoblaydi; avval fayl, keyin manifest."""
    key = settings.release_admin_key
    if not key:
        raise HTTPException(status_code=503, detail="reliz yuklash o'chirilgan (RELEASE_ADMIN_KEY sozlanmagan)")
    if not hmac.compare_digest(request.headers.get("x-admin-key", ""), key):
        raise HTTPException(status_code=401, detail="kalit noto'g'ri")
    if not VERSION_RE.match(version):
        raise HTTPException(status_code=422, detail="version X.Y.Z bo'lishi kerak")
    cur = read_manifest()
    if cur and vkey(version) < vkey(cur["version"]) and not force:
        raise HTTPException(status_code=409, detail=f"joriy reliz {cur['version']} dan past versiya (ilova pastga tushmaydi); force=1 bilan majburlash mumkin")

    os.makedirs(_files_dir(), exist_ok=True)
    limit = settings.release_max_mb * 1024 * 1024
    h = hashlib.sha256()
    size = 0
    fd, tmp = tempfile.mkstemp(dir=settings.releases_dir, prefix=".upload-", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f:
            async for chunk in request.stream():
                if not chunk:
                    continue
                if size == 0 and chunk[:2] != b"MZ":
                    raise HTTPException(status_code=422, detail="bu Windows .exe fayli emas (MZ sarlavhasi yo'q)")
                size += len(chunk)
                if size > limit:
                    raise HTTPException(status_code=413, detail=f"fayl {settings.release_max_mb} MB dan katta")
                h.update(chunk)
                f.write(chunk)
        if size == 0:
            raise HTTPException(status_code=422, detail="tana bo'sh")
        name = f"bojxona_gologramma_setup_{version}.exe"
        os.replace(tmp, os.path.join(_files_dir(), name))  # 1) fayl
        tmp = ""
        manifest = {"version": version, "url": f"{_public_base(request)}/api/downloads/{name}", "sha256": h.hexdigest(), "size": size, "notes": notes}
        mtmp = _manifest_path() + ".tmp"
        with open(mtmp, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False)
        os.replace(mtmp, _manifest_path())  # 2) manifest (atomik: kiosk yarim yozilgan JSON ko'rmaydi)
        _prune(max(1, settings.release_keep))
        log.info("reliz yuklandi: %s (%d bayt, sha256 %s…)", version, size, manifest["sha256"][:12])
        return JSONResponse(manifest, status_code=201)
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)
