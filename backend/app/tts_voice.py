"""Ovoz zanjiri: mikrofon → Gemini matn modeli (audio kirish, matn javob) → Gemini TTS (oqimli) → brauzer.

/ws/live bilan BIR XIL protokol (frontend o'zgarmaydi):
  brauzer → backend: {"type":"activity_start"} + PCM16 16kHz binar kadrlar + {"type":"activity_end"}  (yoki {"type":"text","text":...} — test)
  backend → brauzer: {"type":"ready"}, PCM16 24kHz binar audio, {"type":"transcript","text":...}, {"type":"turn_complete"[, "end": true — yo'lovchi xayrlashdi, ovoz tugagach suhbat tugaydi]}, {"type":"error","msg":...}
  wake (/ws/live?wake=1): suhbat FAQAT salomlashganda boshlanadi — {"type":"greeting"} (tayyor o'zbekcha salom) yoki {"type":"started"} (boshqa tilda salom / salom + savol); aks holda {"type":"wake_ignored"}

Nega Live emas: Live modelida o'zbekcha talaffuz xatolari bor; gemini-3.8-flash-tts so'zlarni to'g'ri o'qiydi (foydalanuvchi namunalarni eshitib tanladi).
⚠️ TTS ga ko'rsatma ("... o'qi: matn") qo'shilmaydi: model uni ovoz chiqarib o'qib yuboradi (o'lchangan: 6.6 s o'rniga 15 s). Faqat javob matni yuboriladi.
"""
import asyncio
import hashlib
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
REASK_TEXT = "Kechirasiz, savolingizni takrorlang."  # savol tushunilmasa (shovqin, uzilgan gap) — uzoq o'ylamasdan qisqa qayta so'rash
# Yo'lovchi xayrlashdi (ovozli gap): yo'lovchi tilida qisqa xayrlashuv (oldindan ovozlangan — kvota sarflanmaydi), so'ng suhbat o'zi tugaydi: turn_complete {"end": true}
FAREWELL = {
    "uz": "Xayr, hurmatli yo'lovchi! Sizga yaxshi yo'l tilayman.",
    "ru": "До свидания, уважаемый пассажир! Счастливого пути!",
    "en": "Goodbye, dear passenger! Have a safe journey.",
}
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
# Video klipi bor tayyor javoblar (brauzer /avatar/answers/<id>.mp4 ni oldindan yuklaydi); "video": false — faqat oldindan ovozlangan audio (diskda, TTS kvotasi sarflanmaydi)
READY_CLIPS = [a["id"] for a in ANSWERS if a.get("video", True)]


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
        speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=settings.gemini_live_fallback_voice))),
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


async def synth_stream(text: str, info: dict | None = None):
    """Matnni Gemini TTS bilan ovozlaydi — PCM16 24kHz bo'laklarini oqim sifatida beradi. Past harorat + qat'iy seed: har chaqiruvda bir xil ovoz/tezlik/balandlik.
    Bo'sh/xato bo'lsa qayta uriniladi (kvota 429 da — biroz kutib). info['voice'] — qaysi ovoz berdi: 'tts' (asosiy), 'tts-lite' (zaxira TTS), 'live' (Gemini Live o'qidi)."""
    text = clean_for_speech(text)
    if not text:
        return
    cfg = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        temperature=settings.gemini_tts_temperature,
        seed=settings.gemini_tts_seed,
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=settings.gemini_tts_voice))
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
                                if not got and info is not None:
                                    info["voice"] = "tts" if model == settings.gemini_tts_model else "tts-lite"
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
        if info is not None:
            info["voice"] = "live"
        try:
            async for ch in _live_read(text):
                yield ch
        except Exception as e:  # noqa: BLE001
            log.warning("Live o'qish xatosi: %s: %s", type(e).__name__, str(e)[:200])


AUDIO_CACHE_DIR = os.path.join(ASSETS, "audio_cache")  # git'da: oldindan ovozlangan qat'iy matnlar (tayyor javoblar, qayta so'rash, xato matnlari) — kvota sarflanmaydi


def _cache_name(text: str) -> str:
    return hashlib.sha1(text.strip().encode("utf-8")).hexdigest()[:16] + ".pcm"


def _read_cached(text: str) -> bytes:
    for d in (AUDIO_CACHE_DIR, settings.audio_cache_dir):
        try:
            with open(os.path.join(d, _cache_name(text)), "rb") as f:
                return f.read()
        except OSError:
            continue
    return b""


async def cached_audio(text: str) -> bytes:
    """Qat'iy matnlar (salom, tayyor javoblar, qayta so'rash, xato matni): xotira → git'dagi audio_cache → ASOSIY TTS (bir marta) — natija diskka (data/audio_cache) va xotiraga yoziladi.
    Faqat ASOSIY ovoz keshlanadi: zaxira ovozi (lite-TTS/Live) shu javob uchun beriladi, lekin kvota tiklangach ham qolib ketmasin."""
    async with _cache_lock:
        if text in _cache:
            return _cache[text]
        # salom: oldindan ovozlangan fayl (asosiy TTS ovozi) — kvota tugaganda ham, qayta ishga tushgandan keyin ham bir xil ovoz
        try:
            if open(os.path.join(ASSETS, "greeting.txt"), encoding="utf-8").read().strip() == text.strip():
                _cache[text] = open(os.path.join(ASSETS, "greeting.pcm"), "rb").read()
                return _cache[text]
        except OSError:
            pass
        pcm = _read_cached(text)
        if pcm:
            _cache[text] = pcm
            return pcm
        buf = bytearray()
        info: dict = {}
        async for ch in synth_stream(text, info):
            buf.extend(ch)
        if buf and info.get("voice") == "tts":
            _cache[text] = bytes(buf)
            try:
                os.makedirs(settings.audio_cache_dir, exist_ok=True)
                with open(os.path.join(settings.audio_cache_dir, _cache_name(text)), "wb") as f:
                    f.write(buf)
            except OSError:
                pass
            return _cache[text]
        return bytes(buf)


_last_warm = 0.0


async def _warm_llm() -> None:
    """Matn modelini isitadi (ulanish, model): sessiyadagi BIRINCHI savol keyingilaridek tez bo'lsin. Har 5 daqiqada ko'pi bilan bir marta; xatosi e'tiborsiz."""
    global _last_warm
    if not settings.gemini_ready or time.time() - _last_warm < 300:
        return
    _last_warm = time.time()
    model = settings.gemini_chat_model or settings.gemini_text_model
    kwargs: dict = dict(max_output_tokens=1, temperature=0.0)
    if "2.5" in model:
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
    try:
        await _gc().aio.models.generate_content(model=model, contents="ping", config=types.GenerateContentConfig(**kwargs))
    except Exception:  # noqa: BLE001
        pass


async def warm_up() -> None:
    """Server ishga tushganda salomni oldindan ovozlab qo'yadi va matn modelini isitadi (birinchi foydalanuvchi kutmasin)."""
    await _warm_llm()
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
        "\n\nTAYYOR JAVOBLAR (video yoki audiosi oldindan yozilgan). Agar yo'lovchi savoli (o'zbek tilida) quyidagilardan BIRIGA aniq mos kelsa va shu javob savolga to'liq yetarli bo'lsa — "
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


WAKE_KINDS = ("greeting", "question", "other")
TURN_KINDS = ("question", "goodbye", "other")  # suhbat o'rtasidagi gap: savol / xayrlashish (suhbat tugaydi) / e'tiborsiz
WAKE_LANGS = ("uz", "ru", "en")
# Birinchi gapni tez tasniflash uchun KICHIK prompt (to'liq TTS_SYSTEM + faktlar bilan chaqiruv 4-9 s, bu — ~2 s; o'lchangan)
WAKE_CLASSIFY = (
    "Sen bojxona kioskidagi virtual xodimning eshitish moduli san. Yo'lovchi avatar oldiga kelib BIRINCHI marta gapirdi. Faqat JSON qaytar. "
    "Suhbat FAQAT yo'lovchi SALOMLASHGANDA boshlanadi — salomsiz hech narsa suhbatni boshlamaydi. "
    "kind: 'greeting' — yo'lovchi salomlashdi va ANIQ SAVOL yoki SO'ROV bermadi (masalan 'Assalomu alaykum', 'Salom', 'Hayrli kun', 'Здравствуйте', 'Привет', 'Добрый день', 'Hello', 'Hi'; "
    "'qalaysiz' yoki o'zini tanishtirish kabi qo'shimcha gap ham bo'lishi mumkin); 'question' — yo'lovchi salomlashdi VA ANIQ savol yoki so'rov berdi; "
    "'other' — salomlashish ANIQ eshitilmagan HAMMA narsa: shovqin, yo'tal, musiqa, jimlik, salomsiz savol yoki gap, boshqa odam bilan suhbat, telefon, noaniq yoki uzilgan gap. "
    "Shubha bo'lsa 'other'. lang: yo'lovchi tili — 'uz' (o'zbek), 'ru' (rus) yoki 'en' (ingliz)."
)
# Suhbat o'rtasidagi har bir ovozli savol: tushunarlimi? (shubha bo'lsa 'question' — keraksiz qayta so'ramaslik uchun)
TURN_CLASSIFY = (
    "Sen bojxona kioskidagi virtual xodimning eshitish moduli san. Yo'lovchi avatar bilan suhbat davomida gapirdi. Faqat JSON qaytar. "
    "kind: 'question' — yo'lovchi kioskka qaratib gapirdi: savol, so'rov, aniqlashtirish, javobga munosabat (rahmat, tushunmadim, yana ayting) yoki salom; "
    "'goodbye' — yo'lovchi XAYRLASHDI va suhbatni tugatmoqda (masalan 'Xayr', 'Ko'rishguncha', 'Sog' bo'ling', 'Rahmat, xayr', 'Yaxshi qoling', 'До свидания', 'Пока', 'Всего доброго', "
    "'Спасибо, до свидания', 'Goodbye', 'Bye');faqat xayrlashuv so'zi XAYRLASHISH ma'nosida bo'lsa (o'zbekcha 'hayr' = 'yo'q' ma'nosida yoki gap davomida bo'lsa — 'question'); "
    "xayrlashib turib yana savol bersa — 'question'; faqat 'rahmat' (xayrlashmasdan) — 'question'; "
    "'other' — gapirish emas (shovqin, yo'tal, musiqa, jimlik) yoki mazmuni UMUMAN tushunarsiz/uzilgan yoki kioskka aloqasi yo'q (telefonda yoki boshqa odam bilan gaplashyapti). "
    "Shubha bo'lsa 'question'. lang: 'uz' (o'zbek), 'ru' (rus) yoki 'en' (ingliz)."
)
GREETING_OTHER = {
    "ru": "Здравствуйте! Я виртуальный сотрудник Государственного таможенного комитета. Чем могу вам помочь?",
    "en": "Hello! I am the virtual officer of the State Customs Committee. How can I help you?",
}


def parse_wake(j: object, kinds: tuple[str, ...] = WAKE_KINDS) -> tuple[str, str]:
    """LLM JSON javobini (kind, lang) ga keltiradi. Noma'lum/buzuq qiymat xavfsiz tomonga: kind aniq bo'lmasa — 'other' (e'tiborsiz), til — 'uz'."""
    d = j if isinstance(j, dict) else {}
    kind = d.get("kind") if d.get("kind") in kinds else "other"
    lang = d.get("lang") if d.get("lang") in WAKE_LANGS else "uz"
    return kind, lang


async def _llm_classify(user_part: types.Part, system: str = WAKE_CLASSIFY, kinds: tuple[str, ...] = WAKE_KINDS) -> tuple[str, str]:
    """Gap: (kind, lang). Kichik prompt va 2 maydonli javob — tez (~2 s). kinds: birinchi gap uchun WAKE_KINDS, suhbat o'rtasi uchun TURN_KINDS."""
    model = settings.gemini_chat_model or settings.gemini_text_model
    kwargs: dict = dict(system_instruction=system, temperature=0.0, max_output_tokens=60, response_mime_type="application/json")
    kwargs["response_schema"] = {
        "type": "OBJECT",
        "properties": {"kind": {"type": "STRING", "enum": list(kinds)}, "lang": {"type": "STRING", "enum": list(WAKE_LANGS)}},
        "required": ["kind", "lang"],
    }
    if "2.5" in model:
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
    r = await _gc().aio.models.generate_content(model=model, contents=[types.Content(role="user", parts=[user_part])], config=types.GenerateContentConfig(**kwargs))
    try:
        return parse_wake(json.loads(r.text or "{}"), kinds)
    except ValueError:
        return parse_wake({}, kinds)


def _finish_timing(state: dict, t_end: float) -> dict:
    """turn_complete.timing: kechikish qaysi bosqichda ekani (kiosk turn_timing.log ga yoziladi). understand_ms — gap tushunilguncha (tasniflash yoki javob), answer_ms — matn javobi,
    tts_first_ms — javob matnidan birinchi audio/klipgacha, first_ms — activity_end dan birinchi audio/klipgacha (yo'lovchi kutgan vaqt), voice — clip|cache|tts|tts-lite|live."""
    t: dict = {k: state[k] for k in ("understand_ms", "answer_ms", "tts_first_ms", "voice", "clip") if state.get(k) is not None}
    if state.get("t_first") is not None:
        t["first_ms"] = int((state["t_first"] - t_end) * 1000)
    return t


async def _timed(coro):
    t = time.monotonic()
    r = await coro
    return r, int((time.monotonic() - t) * 1000)


async def _deliver(ws: WebSocket, clip: str | None, text: str, user_part: types.Part, history: list, state: dict) -> None:
    """Javobni brauzerga yetkazadi: tayyor klip (video o'z ovozi bilan, TTS yo'q), oldindan ovozlangan tayyor javob (audio diskdan) yoki matnni bitta TTS oqimi bilan
    (birinchi bo'lak ~0.2 s, qolganlari ~0.5 s). state: spoke (audio yuborildi), delivering/t_first (birinchi audio/klip ketdi — shundan keyin yo'lovchi javobni bo'la oladi), voice, tts_first_ms."""
    t0 = time.monotonic()

    def mark() -> None:
        if state.get("t_first") is None:
            state["t_first"] = time.monotonic()
            state["tts_first_ms"] = int((state["t_first"] - t0) * 1000)
        state["delivering"] = True

    ready = ANSWER_BY_ID.get(clip) if clip else None
    if ready and ready.get("video", True):
        # tayyor javob: brauzer o'z ovozi bilan yozilgan videoni ijro etadi (lab harakati ovozga mos), TTS chaqirilmaydi
        await ws.send_text(json.dumps({"type": "transcript", "text": text}))
        await ws.send_text(json.dumps({"type": "clip", "id": clip}))
        mark()
        state["voice"] = "clip"
        state["clip"] = clip
        history.append(types.Content(role="user", parts=[user_part]))
        history.append(types.Content(role="model", parts=[types.Part(text=text)]))
        state["spoke"] = True
        return
    if ready:
        # video yo'q tayyor javob: matn ANIQ (tasdiqlangan fakt), audio oldindan ovozlangan (diskda) — darhol chiqadi va TTS kvotasi sarflanmaydi
        text = ready["text"]
        pcm = await cached_audio(text)
        if pcm:
            await ws.send_text(json.dumps({"type": "transcript", "text": text}))
            await _send_pcm(ws, pcm)
            mark()
            state["voice"] = "cache"
            state["clip"] = clip
            history.append(types.Content(role="user", parts=[user_part]))
            history.append(types.Content(role="model", parts=[types.Part(text=text)]))
            state["spoke"] = True
            return
    if text:
        await ws.send_text(json.dumps({"type": "transcript", "text": text}))
        piece = bytearray()
        limit = FIRST_PIECE_BYTES
        info: dict = {}
        async for ch in synth_stream(text, info):
            piece.extend(ch)
            if len(piece) >= limit:
                n = len(piece) // 2 * 2
                await ws.send_bytes(bytes(piece[:n]))
                mark()
                state["spoke"] = True
                state["voice"] = info.get("voice")
                piece = bytearray(piece[n:])
                limit = PIECE_BYTES
        if piece:
            await ws.send_bytes(bytes(piece[: len(piece) // 2 * 2]))
            mark()
            state["spoke"] = True
            state["voice"] = info.get("voice")
    if not state["spoke"] and not tts_available():
        await ws.send_text(json.dumps({"type": "error", "msg": "Ovoz xizmati vaqtincha band. Suhbatni qaytadan boshlang."}))
    elif not state["spoke"]:
        await _say_cached(ws, FALLBACK_TEXT)
        state["voice"] = "cache"
    else:
        history.append(types.Content(role="user", parts=[user_part]))
        history.append(types.Content(role="model", parts=[types.Part(text=text)]))


CLS_GRACE_S = 0.4  # javob tasniflashdan oldin tayyor bo'lsa: xayrlashishni aniqlash uchun tasniflashni shuncha kutamiz
CLS_LATE_S = 0.3  # javob yetkazilgach tasniflash natijasini shuncha kutamiz (turn_complete kechikmasin)


async def _cls_result(cls: asyncio.Task, timeout: float) -> tuple[str, str] | None:
    """Tasniflash vazifasi (_timed(...)) natijasi: (kind, lang) yoki None (tugamadi/xato). Vazifa bekor qilinmaydi (shield)."""
    try:
        (kind, lang), _ms = await asyncio.wait_for(asyncio.shield(cls), timeout)
        return kind, lang
    except Exception:  # noqa: BLE001
        return None


async def _farewell(ws: WebSocket, lang: str, state: dict) -> None:
    """Xayrlashuv: yo'lovchi tilida oldindan ovozlangan qisqa matn; turn_complete {"end": true} — brauzer/ilova ovoz tugagach suhbatni o'zi tugatadi."""
    state["t_first"] = time.monotonic()
    state["delivering"] = True
    await _say_cached(ws, FAREWELL.get(lang, FAREWELL["uz"]))
    state["voice"] = "cache"
    state["end"] = True


async def respond(ws: WebSocket, user_part: types.Part, history: list, state: dict, t_end: float) -> None:
    """Bitta javob: LLM matni -> bitta TTS oqimi -> brauzerga. Ovozli savolda javob chaqiruvi bilan PARALLEL kichik tasniflash ishlaydi: gap tushunarsiz (shovqin, uzilgan) bo'lsa
    uzoq o'ylamasdan qisqa qayta so'raladi (aks holda eng uzoq kutish aynan shu holatda edi: 3.3–6.9 s), tushunarli bo'lsa javob allaqachon yo'lda (kechikish qo'shilmaydi)."""
    contents = history[-HISTORY_TURNS * 2:] + [types.Content(role="user", parts=[user_part])]
    state.setdefault("spoke", False)
    ans = asyncio.create_task(_timed(_llm_answer(contents)))
    cls = asyncio.create_task(_timed(_llm_classify(user_part, TURN_CLASSIFY, TURN_KINDS))) if user_part.inline_data is not None else None
    try:
        if cls is not None:
            done, _ = await asyncio.wait({ans, cls}, return_when=asyncio.FIRST_COMPLETED)
            if cls in done:  # tasniflash birinchi (yoki javob bilan birga) tugadi
                kind, lang, cms = "question", "uz", None
                try:
                    (kind, lang), cms = cls.result()
                except Exception as e:  # noqa: BLE001
                    log.warning("tasniflash xatosi: %s: %s", type(e).__name__, str(e)[:160])
                if ans not in done:
                    state["understand_ms"] = cms
                if kind == "goodbye":
                    ans.cancel()
                    log.info("xayrlashish (%s): suhbat tugaydi (%s ms)", lang, cms)
                    await _farewell(ws, lang, state)
                    return
                if kind == "other" and ans not in done:
                    ans.cancel()
                    log.info("savol tushunarsiz: qisqa qayta so'rash (%s ms)", cms)
                    state["t_first"] = time.monotonic()
                    state["delivering"] = True
                    await _say_cached(ws, REASK_TEXT)
                    state["voice"] = "cache"
                    state["reask"] = True
                    return
            else:  # javob tasniflashdan oldin tayyor bo'ldi: xayrlashishni o'tkazib yubormaslik uchun tasniflashni biroz kutamiz (<= CLS_GRACE_S)
                res = await _cls_result(cls, CLS_GRACE_S)
                if res and res[0] == "goodbye":
                    log.info("xayrlashish (%s): javob tayyor edi, xayrlashuv beriladi", res[1])
                    await _farewell(ws, res[1], state)
                    return
        (clip, text), ams = await ans
        state["answer_ms"] = ams
        state.setdefault("understand_ms", ams)  # javob tasniflashdan oldin tayyor bo'ldi — tushunish shu vaqtga teng
        await _deliver(ws, clip, text, user_part, history, state)
        if cls is not None and not state.get("end"):
            res = await _cls_result(cls, CLS_LATE_S)  # tasniflash kech tugagan bo'lsa ham: yo'lovchi xayrlashgan edi — javobdan keyin suhbat tugaydi
            if res and res[0] == "goodbye":
                state["end"] = True
    except WebSocketDisconnect:
        raise
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("javob xatosi: %s: %s", type(e).__name__, str(e)[:200])
        if not state["spoke"]:
            try:
                await _say_cached(ws, ERROR_TEXT)
            except Exception:  # noqa: BLE001
                pass
    finally:
        for t in (ans, cls):
            if t is not None and not t.done():
                t.cancel()


async def respond_first(ws: WebSocket, user_part: types.Part, history: list, state: dict, t_end: float) -> bool:
    """WAKE rejimi: birinchi gap. Suhbat FAQAT SALOMLASHGANDA boshlanadi: salom (o'zbekcha — tayyor salom videosi/audio, {"type":"greeting"}; boshqa tilda — shu tilda TTS), salom + savol (javob),
    hamma boshqa narsa (shovqin, salomsiz savol/gap, boshqa odam bilan suhbat) — e'tiborsiz (wake_ignored). Suhbat boshlanganini brauzerga {"type":"greeting"} yoki {"type":"started"} bildiradi
    (yurib kelish shundan boshlanadi: shovqinda avatar ko'rinmasin).
    Tasniflash (kichik prompt, ~2 s) va odatdagi javob (to'liq prompt) PARALLEL boshlanadi: salom/shovqin bo'lsa javob bekor qilinadi, savol bo'lsa javob allaqachon yo'lda
    (savolga javob kechikmaydi). Qaytaradi: True — suhbat boshlandi, False — e'tiborsiz qoldirildi (brauzerga wake_ignored yuborildi)."""
    contents = [types.Content(role="user", parts=[user_part])]
    state.setdefault("spoke", False)
    answer = asyncio.create_task(_timed(_llm_answer(contents)))
    try:
        try:
            (kind, lang), cms = await _timed(_llm_classify(user_part))
            state["understand_ms"] = cms
        except WebSocketDisconnect:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("wake tasniflash xatosi: %s: %s", type(e).__name__, str(e)[:200])
            kind, lang = "other", "uz"
        log.info("wake: kind=%s lang=%s", kind, lang)
        if kind == "other":
            answer.cancel()
            await ws.send_text(json.dumps({"type": "wake_ignored"}))
            return False
        if kind == "greeting":
            answer.cancel()
            if lang == "uz":
                # tayyor salom: salom videosi aynan shu audio bilan yaratilgan; brauzer 'greeting' belgisini ko'rgach salom videosini kutadi
                await ws.send_text(json.dumps({"type": "greeting"}))
                state["t_first"] = time.monotonic()
                state["delivering"] = True
                await _say_cached(ws, settings.greeting_text)
                state["voice"] = "cache"
                greet_text = settings.greeting_text
            else:
                await ws.send_text(json.dumps({"type": "started"}))  # suhbat boshlandi (salom tasdiqlandi, tayyor salom videosi yo'q): avatar yurib keladi
                greet_text = GREETING_OTHER[lang]
                await _deliver(ws, None, greet_text, types.Part(text="(yo'lovchi salomlashdi)"), history, state)
                return True  # tarix _deliver ichida yangilandi
            history.append(types.Content(role="user", parts=[types.Part(text="(yo'lovchi salomlashdi)")]))
            history.append(types.Content(role="model", parts=[types.Part(text=greet_text)]))
            return True
        await ws.send_text(json.dumps({"type": "started"}))  # salomlashib savol berdi: suhbat boshlandi (avatar yurib keladi), javob parallel tayyorlanayotgan edi
        (clip, text), ams = await answer
        state["answer_ms"] = ams
        await _deliver(ws, clip, text, user_part, history, state)
        return True
    except WebSocketDisconnect:
        raise
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("wake javob xatosi: %s: %s", type(e).__name__, str(e)[:200])
        if not state["spoke"]:
            try:
                await _say_cached(ws, ERROR_TEXT)
            except Exception:  # noqa: BLE001
                pass
        return True
    finally:
        if not answer.done():
            answer.cancel()


async def handle(ws: WebSocket, wake: bool = False) -> None:
    """/ws/live (voice_engine=tts): suhbat sikli.
    wake=True (/ws/live?wake=1): salom darrov berilmaydi — yo'lovchining BIRINCHI gapi (brauzer mahalliy VAD bilan ushlab yuboradi) tinglanadi: salom bo'lsa avatar suhbatni
    boshlaydi, savol bo'lsa javob beradi, shovqin bo'lsa {"type":"wake_ignored"} (brauzer kutish rejimiga qaytadi).
    JAVOBNI BO'LISH (barge-in): javob audiosi/klipi allaqachon ketayotgan paytda activity_start kelsa — joriy javob TO'XTATILADI (TTS oqimi uziladi: kvota va vaqt tejaladi),
    {"type":"interrupted"} yuboriladi va yangi gap qabul qilinadi. Javob hali tayyorlanayotgan bo'lsa (audio ketmagan) — oldingidek yangi gap tashlanadi (shovqin javobni uzmasin).
    turn_complete ga server vaqtlari qo'shiladi: {"type":"turn_complete","timing":{understand_ms, answer_ms, tts_first_ms, first_ms, voice}}."""
    history: list = []
    pcm = bytearray()
    collecting = False
    task: asyncio.Task | None = None
    awaiting_wake = wake  # birinchi gap hali qabul qilinmagan
    cur: dict = {"state": None}  # joriy javobning holati (barge-in: audio ketayotganini bilish uchun)

    t_warm = asyncio.create_task(_warm_llm())  # sessiya ochilganda model isitiladi — birinchi savol ham tez bo'lsin
    _bg.add(t_warm)
    t_warm.add_done_callback(_bg.discard)

    async def run(user_part: types.Part, t_end: float) -> None:
        nonlocal awaiting_wake
        state: dict = {"spoke": False}
        cur["state"] = state
        started = True
        cancelled = False
        try:
            if awaiting_wake:
                started = await respond_first(ws, user_part, history, state, t_end)
                if started:
                    awaiting_wake = False
            else:
                await respond(ws, user_part, history, state, t_end)
        except WebSocketDisconnect:
            return
        except asyncio.CancelledError:
            cancelled = True  # bo'lingan javob: turn_complete yuborilmaydi (interrupted yuboriladi)
            raise
        finally:
            if started and not cancelled:
                msg: dict = {"type": "turn_complete"}
                if state.get("end"):
                    msg["end"] = True  # yo'lovchi xayrlashdi: ovoz tugagach brauzer/ilova suhbatni o'zi tugatadi
                timing = _finish_timing(state, t_end)
                if timing:
                    msg["timing"] = timing
                    log.info("turn timing: %s", timing)
                try:
                    await ws.send_text(json.dumps(msg))
                except Exception:  # noqa: BLE001
                    pass

    async def greet() -> None:
        cur["state"] = {"spoke": True, "delivering": True}
        try:
            await _say_cached(ws, settings.greeting_text)
        finally:
            try:
                await ws.send_text(json.dumps({"type": "turn_complete"}))
            except Exception:  # noqa: BLE001
                pass

    async def interrupt() -> None:
        if task is not None and not task.done():
            task.cancel()
            await asyncio.wait({task})
        try:
            await ws.send_text(json.dumps({"type": "interrupted"}))
        except Exception:  # noqa: BLE001
            pass

    await ws.send_text(json.dumps({"type": "ready", "clips": READY_CLIPS, "wake": wake}))
    if settings.live_greeting and not wake:
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
                st = cur["state"] or {}
                if busy and st.get("delivering"):  # javob audiosi/klipi ketyapti — yo'lovchi javobni bo'ldi
                    await interrupt()
                    busy = False
                pcm.clear()
                collecting = not busy
            elif ctype == "activity_end":
                collecting = False
                if busy:
                    pcm.clear()
                    continue
                if len(pcm) < MIN_UTTERANCE_S * SAMPLE_RATE_IN * 2:
                    pcm.clear()
                    await ws.send_text(json.dumps({"type": "wake_ignored" if awaiting_wake else "turn_complete"}))
                    continue
                part = types.Part.from_bytes(data=_wav(bytes(pcm)), mime_type="audio/wav")
                pcm.clear()
                task = asyncio.create_task(run(part, time.monotonic()))
            elif ctype == "text" and not busy:
                task = asyncio.create_task(run(types.Part(text=ctl.get("text", "")), time.monotonic()))
    finally:
        if task and not task.done():
            task.cancel()
