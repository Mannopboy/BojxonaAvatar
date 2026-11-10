"""Ovoz zanjiri: mikrofon → Gemini matn modeli (audio kirish, matn javob) → Gemini TTS (oqimli) → brauzer.

/ws/live bilan BIR XIL protokol (frontend o'zgarmaydi):
  brauzer → backend: {"type":"activity_start"} + PCM16 16kHz binar kadrlar + {"type":"activity_end"}  (yoki {"type":"text","text":...} — test)
  backend → brauzer: {"type":"ready"}, PCM16 24kHz binar audio, {"type":"transcript","text":...}, {"type":"turn_complete"}, {"type":"error","msg":...}

Nega Live emas: Live modelida o'zbekcha talaffuz xatolari bor; gemini-3.8-flash-tts so'zlarni to'g'ri o'qiydi (foydalanuvchi namunalarni eshitib tanladi).
⚠️ TTS ga ko'rsatma ("... o'qi: matn") qo'shilmaydi: model uni ovoz chiqarib o'qib yuboradi (o'lchangan: 6.6 s o'rniga 15 s). Faqat javob matni yuboriladi.
"""
import asyncio
import io
import json
import logging
import os
import re
import time
import wave

from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from .config import get_settings

settings = get_settings()
log = logging.getLogger("uvicorn.error")

SAMPLE_RATE_IN = 16000
MIN_UTTERANCE_S = 0.5      # bundan qisqa ovoz — shovqin, javob berilmaydi
MAX_UTTERANCE_S = 30.0
HISTORY_TURNS = 4          # oldingi nechta savol-javob eslab qolinadi
FIRST_PIECE_BYTES = 9600   # birinchi audio bo'lagi ~0.2 s (tez boshlash), qolganlari kattaroq
PIECE_BYTES = 24000        # ~0.5 s

TTS_SYSTEM = (
    "Sen — O'zbekiston Respublikasi Davlat bojxona qo'mitasi virtual xodimisan (ayol). Yo'lovchilar bilan JONLI OVOZLI suhbat qilasan: "
    "sening javobing ovoz chiqarib o'qiladi.\n"
    "USLUB: rasmiy, xushmuomala, iliq. Yo'lovchiga doim 'Siz' deb murojaat qil. Adabiy o'zbek tilida, ravon, to'liq gaplar bilan gapir. "
    "Javob 2-4 ta qisqa, aniq gapdan oshmasin. Salomlashma va o'zingni tanishtirma — bu allaqachon aytilgan.\n"
    "TIL: yo'lovchi qaysi tilda gapirsa (o'zbek yoki rus), o'sha tilda javob ber. Asosiy til — o'zbekcha.\n"
    "YOZUV (juda muhim, javob ovozlanadi): faqat oddiy gaplar — markdown, ro'yxat belgisi, qavs, emoji, havola va maxsus belgi ISHLATMA. "
    "Barcha raqam, summa va sonlarni SO'Z bilan yoz (masalan 'bir ming dollar', 'besh yuz dollar', 'yuz million so'm'), raqam (1000) yozma. "
    "'$' o'rniga 'dollar', '%' o'rniga 'foiz' deb yoz.\n"
    "QOIDA (juda muhim): aniq raqam, summa yoki qonunni O'YLAB TOPMA. Quyidagi TASDIQLANGAN FAKTLARga qat'iy asoslan. Agar savol bu faktlarda "
    "bo'lmasa — umumiy tushuntirish ber, lekin aniq raqam yoki qonun moddasini o'zingdan aytma; 'aniq va yangi ma'lumot uchun customs.uz "
    "rasmiy saytini tekshiring yoki bojxona xodimiga murojaat qiling' deb yo'naltir.\n\n"
    "TASDIQLANGAN FAKTLAR:\n"
    "1) Bojsiz tovar olib kirish limiti: xalqaro aeroport orqali bir ming AQSh dollari; temir yo'l va daryo o'tkazish punktlari orqali besh yuz dollar; "
    "avtomobil yoki piyoda uch yuz dollar.\n"
    "2) Xalqaro pochta va kuryer jo'natmalari: yuridik shaxs nomiga yuz dollargacha bojsiz; jismoniy shaxsga kuryer orqali bir kalendar oyda "
    "ikki yuz dollargacha bojsiz.\n"
    "3) Valyuta: naqd xorijiy valyuta olib kirish cheklanmagan, lekin yuz million so'm ekvivalentidan oshsa deklaratsiya majburiy; olib chiqish "
    "yuz million so'mgacha hujjatsiz, ortig'iga ruxsatnoma yoki deklaratsiya kerak."
)
FALLBACK_TEXT = "Kechirasiz, savolingizni aniq eshitmadim. Iltimos, yana bir bor takrorlab bering."
ERROR_TEXT = "Kechirasiz, hozir javob bera olmadim. Iltimos, savolingizni qayta takrorlang."

_client: genai.Client | None = None
_blocked: dict[str, float] = {}  # model -> shu vaqtgacha (time.time()) kunlik kvotasi tugagan
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")


def _load_answers() -> list[dict]:
    """Tayyor javoblar (lab harakati o'z ovoziga mos video klip frontendda: /avatar/answers/<id>.mp4). Savol shulardan biriga mos kelsa TTS chaqirilmaydi."""
    try:
        return json.load(open(os.path.join(ASSETS, "answers.json"), encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return []


ANSWERS = _load_answers()
ANSWER_BY_ID = {a["id"]: a for a in ANSWERS}


def _tts_models() -> list[str]:
    return [m for m in (settings.gemini_tts_model, settings.gemini_tts_fallback_model) if m]


def _model_ok(model: str) -> bool:
    return time.time() >= _blocked.get(model, 0.0)


def tts_available() -> bool:
    """Kamida bitta TTS modelining kunlik kvotasi tugamagan bo'lsa True (gemini-3.8-flash-tts: Tier 1 da kuniga 100 so'rov, loyiha bo'yicha; zaxira model — alohida kvota).
    Hammasi tugasa — False: live.py yangi suhbatni Gemini Live ga o'tkazadi."""
    return settings.tts_live_fallback or any(_model_ok(m) for m in _tts_models())


LIVE_READ_SYSTEM = (
    "Sen — O'zbekiston Respublikasi Davlat bojxona qo'mitasining virtual xodimisan (ayol). Foydalanuvchi bergan matnni AYNAN o'qi: so'z qo'shma, hech narsani o'zgartirma, "
    "tushuntirma va salomlashma. Adabiy o'zbek tilida, so'zlarni to'g'ri talaffuz qilib, tabiiy, iliq, ravon va to'xtamasdan o'qi."
)


async def _live_read(text: str):
    """Oxirgi zaxira: TTS modellarining kunlik kvotasi tugaganda matnni Gemini Live o'qib beradi (PCM16 24 kHz, real vaqtda keladi — brauzer oldindan to'playdi).
    Shunda tayyor javob kliplari va matn mantig'i (tarix, faktlar) ishlashda davom etadi; faqat erkin javob ovozi Live ovozi bo'ladi."""
    model = settings.gemini_live_model
    kwargs: dict = dict(
        response_modalities=["AUDIO"],
        system_instruction=LIVE_READ_SYSTEM,
        speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=settings.gemini_voice))),
    )
    if "extended" in model:
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=settings.gemini_live_thinking)
    manual = model.startswith("gemini-2.5")
    if manual:
        kwargs["realtime_input_config"] = types.RealtimeInputConfig(automatic_activity_detection=types.AutomaticActivityDetection(disabled=True))
    async with _gc().aio.live.connect(model=model, config=types.LiveConnectConfig(**kwargs)) as session:
        if manual:
            await session.send_realtime_input(activity_start=types.ActivityStart())
        await session.send_realtime_input(text="Matn: " + text)
        if manual:
            await session.send_realtime_input(activity_end=types.ActivityEnd())
        async for resp in session.receive():
            if resp.data:
                yield resp.data
            sc = resp.server_content
            if sc and sc.turn_complete:
                break


def _note_quota(model: str, msg: str) -> bool:
    """429 kunlik kvota xatosi bo'lsa — shu modelni retryDelay (yoki 1 soat) gacha o'chiradi. Qaytaradi: kunlik kvota tugadimi."""
    if "429" not in msg and "RESOURCE_EXHAUSTED" not in msg:
        return False
    if "per_day" not in msg.lower() and "perday" not in msg.lower():
        return False
    m = re.search(r"retryDelay['\"]?:\s*['\"]?(\d+)s", msg)
    # retryDelay ~18 soat bo'lishi mumkin, lekin amalda kvota oldinroq ochilgan (o'lchangan) — 10 daqiqadan keyin qayta tekshiriladi (muvaffaqiyatsiz urinish kvota sarflamaydi)
    secs = min(int(m.group(1)), 600) if m else 600
    _blocked[model] = time.time() + secs
    log.warning("TTS kunlik kvotasi tugadi (%s): %d s", model, secs)
    return True


_cache: dict[str, bytes] = {}
_cache_lock = asyncio.Lock()
_bg: set = set()  # fon vazifalariga havola (axlat yig'uvchi o'chirib yubormasin)


def _gc() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _wav(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE_IN)
        w.writeframes(pcm)
    return buf.getvalue()


def clean_for_speech(text: str) -> str:
    """Ovozlashdan oldin tozalash: markdown/belgilar o'qilmasin."""
    t = re.sub(r"[*_#`~>|]+", " ", text)
    t = re.sub(r"^\s*[-•]\s+", "", t, flags=re.M)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


_END = re.compile(r"([.!?…]+[\"')\]]*)(\s+|$)")


def split_ready(buf: str, final: bool = False) -> tuple[list[str], str]:
    """Oqimli matndan tugagan gaplarni ajratadi. Juda qisqa gaplar (<18 belgi) keyingisi bilan birlashadi;
    nuqtasiz uzun (>160) bo'lakni oxirgi vergulda kesadi (birinchi ovoz tez chiqsin)."""
    out: list[str] = []
    pos = 0
    for m in _END.finditer(buf):
        end = m.end()
        piece = buf[pos:end].strip()
        if len(piece) >= 18 or (final and piece):
            out.append(piece)
            pos = end
    rest = buf[pos:]
    if len(rest) > 160:
        cut = max(rest.rfind(", ", 0, 160), rest.rfind("; ", 0, 160))
        if cut > 40:
            out.append(rest[: cut + 1].strip())
            rest = rest[cut + 1:]
    if final and rest.strip():
        out.append(rest.strip())
        rest = ""
    return out, rest


async def synth_stream(text: str):
    """Matnni Gemini TTS bilan ovozlaydi — PCM16 24kHz bo'laklarini oqim sifatida beradi. Past harorat + qat'iy seed: har chaqiruvda bir xil ovoz/tezlik/balandlik.
    Bo'sh/xato bo'lsa qayta uriniladi (kvota 429 da — biroz kutib)."""
    text = clean_for_speech(text)
    if not text:
        return
    cfg = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        temperature=settings.gemini_tts_temperature,
        seed=settings.gemini_tts_seed,
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=settings.gemini_voice))
        ),
    )
    for model in _tts_models():
        if not _model_ok(model):
            continue
        for attempt in (1, 2, 3):
            got = False
            try:
                stream = await _gc().aio.models.generate_content_stream(model=model, contents=text, config=cfg)
                async for ch in stream:
                    for cand in ch.candidates or []:
                        for p in (cand.content.parts if cand.content else None) or []:
                            if p.inline_data and p.inline_data.data:
                                got = True
                                yield p.inline_data.data
                if got:
                    return
            except Exception as e:  # noqa: BLE001
                log.warning("TTS xato (%s, urinish %d): %s: %s", model, attempt, type(e).__name__, str(e)[:200])
                if got:  # yarmida uzildi — qaytadan boshlasak takrorlanadi
                    return
                if _note_quota(model, str(e)):
                    break  # kunlik kvota: keyingi (zaxira) modelga o'tadi
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    await asyncio.sleep(1.5 * attempt)  # daqiqalik kvota: biroz kutib qayta urinadi
    if settings.tts_live_fallback:
        try:
            async for ch in _live_read(text):
                yield ch
        except Exception as e:  # noqa: BLE001
            log.warning("Live o'qish xatosi: %s: %s", type(e).__name__, str(e)[:200])


async def cached_audio(text: str) -> bytes:
    """Qat'iy matnlar (salom, xato xabari) bir marta ovozlanib xotirada saqlanadi — keyingi suhbatlarda darhol chiqadi."""
    async with _cache_lock:
        if text not in _cache:
            # salom: oldindan ovozlangan fayl (asosiy TTS ovozi) — kvota tugaganda ham, qayta ishga tushgandan keyin ham bir xil ovoz
            try:
                if open(os.path.join(ASSETS, "greeting.txt"), encoding="utf-8").read().strip() == text.strip():
                    _cache[text] = open(os.path.join(ASSETS, "greeting.pcm"), "rb").read()
                    return _cache[text]
            except OSError:
                pass
            buf = bytearray()
            async for ch in synth_stream(text):
                buf.extend(ch)
            if buf:
                _cache[text] = bytes(buf)
        return _cache.get(text, b"")


async def warm_up() -> None:
    """Server ishga tushganda salomni oldindan ovozlab qo'yadi (birinchi foydalanuvchi kutmasin)."""
    if settings.gemini_ready and settings.voice_engine == "tts":
        try:
            await cached_audio(settings.greeting_text)
        except Exception:  # noqa: BLE001
            pass


async def _send_pcm(ws: WebSocket, pcm: bytes) -> None:
    for i in range(0, len(pcm), PIECE_BYTES):
        await ws.send_bytes(pcm[i:i + PIECE_BYTES])


async def _say_cached(ws: WebSocket, text: str) -> None:
    pcm = await cached_audio(text)
    if pcm:
        await ws.send_text(json.dumps({"type": "transcript", "text": text}))
        await _send_pcm(ws, pcm)


def _clip_instruction() -> str:
    if not ANSWERS:
        return ""
    lines = "\n".join(f"- {a['id']}: {a['when']}. Javob: «{a['text']}»" for a in ANSWERS)
    return (
        "\n\nTAYYOR JAVOBLAR (videosi oldindan yozilgan). Agar yo'lovchi savoli (o'zbek tilida) quyidagilardan BIRIGA aniq mos kelsa va shu javob savolga to'liq yetarli bo'lsa — "
        "clip maydoniga uning id sini yoz, text maydoniga shu javob matnini AYNAN ko'chir. Boshqa hamma holatda (boshqa mavzu, bir nechta savol, rus tili, aniqlashtirish) clip='none' "
        "va text ga o'z javobingni yoz.\n" + lines
    )


async def _llm_answer(contents: list) -> tuple[str | None, str]:
    """Gemini matn modeli javobi: (tayyor javob id si yoki None, matn). Javob qisqa (2-4 gap), butun javob BITTA TTS chaqiruvida ovozlanadi (gaplarni alohida ovozlash
    ovoz tezligi/balandligini gap sayin o'zgartirardi va kvotani ko'p sarflardi). Tayyor javob bo'lsa TTS umuman chaqirilmaydi."""
    model = settings.gemini_chat_model or settings.gemini_text_model
    kwargs: dict = dict(system_instruction=TTS_SYSTEM + _clip_instruction(), temperature=0.4, max_output_tokens=500)
    if "2.5" in model:
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)  # tez javob: fikrlash o'chirilgan
    if not ANSWERS:
        r = await _gc().aio.models.generate_content(model=model, contents=contents, config=types.GenerateContentConfig(**kwargs))
        return None, clean_for_speech(r.text or "")[:900]
    kwargs["response_mime_type"] = "application/json"
    kwargs["response_schema"] = {
        "type": "OBJECT",
        "properties": {"clip": {"type": "STRING", "enum": ["none"] + [a["id"] for a in ANSWERS]}, "text": {"type": "STRING"}},
        "required": ["clip", "text"],
    }
    r = await _gc().aio.models.generate_content(model=model, contents=contents, config=types.GenerateContentConfig(**kwargs))
    try:
        j = json.loads(r.text or "{}")
    except ValueError:
        return None, clean_for_speech(r.text or "")[:900]
    clip = j.get("clip")
    if clip in ANSWER_BY_ID:
        return clip, ANSWER_BY_ID[clip]["text"]
    return None, clean_for_speech(str(j.get("text") or ""))[:900]


async def respond(ws: WebSocket, user_part: types.Part, history: list) -> None:
    """Bitta javob: LLM matni -> bitta TTS oqimi -> brauzerga (birinchi bo'lak ~0.2 s, qolganlari ~0.5 s)."""
    contents = history[-HISTORY_TURNS * 2:] + [types.Content(role="user", parts=[user_part])]
    spoke = False
    try:
        clip, text = await _llm_answer(contents)
        if clip:
            # tayyor javob: brauzer o'z ovozi bilan yozilgan videoni ijro etadi (lab harakati ovozga mos), TTS chaqirilmaydi
            await ws.send_text(json.dumps({"type": "transcript", "text": text}))
            await ws.send_text(json.dumps({"type": "clip", "id": clip}))
            history.append(types.Content(role="user", parts=[user_part]))
            history.append(types.Content(role="model", parts=[types.Part(text=text)]))
            return
        if text:
            await ws.send_text(json.dumps({"type": "transcript", "text": text}))
            piece = bytearray()
            limit = FIRST_PIECE_BYTES
            async for ch in synth_stream(text):
                piece.extend(ch)
                if len(piece) >= limit:
                    n = len(piece) // 2 * 2
                    await ws.send_bytes(bytes(piece[:n]))
                    spoke = True
                    piece = bytearray(piece[n:])
                    limit = PIECE_BYTES
            if piece:
                await ws.send_bytes(bytes(piece[: len(piece) // 2 * 2]))
                spoke = True
        if not spoke and not tts_available():
            await ws.send_text(json.dumps({"type": "error", "msg": "Ovoz xizmati vaqtincha band. Suhbatni qaytadan boshlang."}))
        elif not spoke:
            await _say_cached(ws, FALLBACK_TEXT)
        else:
            history.append(types.Content(role="user", parts=[user_part]))
            history.append(types.Content(role="model", parts=[types.Part(text=text)]))
    except WebSocketDisconnect:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("javob xatosi: %s: %s", type(e).__name__, str(e)[:200])
        if not spoke:
            try:
                await _say_cached(ws, ERROR_TEXT)
            except Exception:  # noqa: BLE001
                pass


async def handle(ws: WebSocket) -> None:
    """/ws/live (voice_engine=tts): suhbat sikli. Javob vaqtida kelgan mikrofon ma'lumoti tashlanadi (half-duplex)."""
    history: list = []
    pcm = bytearray()
    collecting = False
    task: asyncio.Task | None = None

    async def run(user_part: types.Part) -> None:
        try:
            await respond(ws, user_part, history)
        except WebSocketDisconnect:
            return
        finally:
            try:
                await ws.send_text(json.dumps({"type": "turn_complete"}))
            except Exception:  # noqa: BLE001
                pass

    async def greet() -> None:
        try:
            await _say_cached(ws, settings.greeting_text)
        finally:
            try:
                await ws.send_text(json.dumps({"type": "turn_complete"}))
            except Exception:  # noqa: BLE001
                pass

    await ws.send_text(json.dumps({"type": "ready", "clips": [a["id"] for a in ANSWERS]}))
    if settings.live_greeting:
        task = asyncio.create_task(greet())
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            busy = task is not None and not task.done()
            data = msg.get("bytes")
            if data is not None:
                if collecting and not busy and len(pcm) < MAX_UTTERANCE_S * SAMPLE_RATE_IN * 2:
                    pcm.extend(data)
                continue
            text = msg.get("text")
            if not text:
                continue
            ctl = json.loads(text)
            ctype = ctl.get("type")
            if ctype == "activity_start":
                pcm.clear()
                collecting = not busy
            elif ctype == "activity_end":
                collecting = False
                if busy:
                    pcm.clear()
                    continue
                if len(pcm) < MIN_UTTERANCE_S * SAMPLE_RATE_IN * 2:
                    pcm.clear()
                    await ws.send_text(json.dumps({"type": "turn_complete"}))
                    continue
                part = types.Part.from_bytes(data=_wav(bytes(pcm)), mime_type="audio/wav")
                pcm.clear()
                task = asyncio.create_task(run(part))
            elif ctype == "text" and not busy:
                task = asyncio.create_task(run(types.Part(text=ctl.get("text", ""))))
    finally:
        if task and not task.done():
            task.cancel()
