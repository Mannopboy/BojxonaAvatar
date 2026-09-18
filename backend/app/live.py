"""Gemini Live API — real-time audio suhbat (WebSocket proxy).

Brauzer mikrofoni (PCM16 16kHz) → backend → Gemini Live → audio (PCM16 24kHz) → brauzer.
Kalit faqat backendda. Grounding: system instruction + google_search (ADR-004/005/008).
"""
import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from .config import get_settings

settings = get_settings()
router = APIRouter()

LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025"

SYSTEM_INSTRUCTION = (
    "Sen — O'zbekiston Respublikasi Davlat bojxona qo'mitasi virtual xodimisan. "
    "Yo'lovchilar bilan JONLI, tabiiy, hurmatli suhbat qilasan, xuddi haqiqiy xodim kabi. "
    "Qisqa va aniq gapir, ortiqcha gap yo'q.\n"
    "TIL: yo'lovchi qaysi tilda gapirsa (o'zbek yoki rus), o'sha tilda javob ber. Asosiy til — o'zbekcha.\n"
    "QOIDA (juda muhim): aniq raqam, summa yoki qonunni O'YLAB TOPMA. Quyidagi TASDIQLANGAN "
    "FAKTLARga qat'iy asoslan. Agar savol bu faktlarda bo'lmasa — umumiy tushuntirish ber, lekin "
    "aniq raqam yoki qonun moddasini o'zingdan aytma; 'aniq va yangi ma'lumot uchun customs.uz rasmiy "
    "saytini tekshiring yoki bojxona xodimiga murojaat qiling' deb yo'naltir.\n\n"
    "TASDIQLANGAN FAKTLAR:\n"
    "1) Bojsiz tovar olib kirish limiti: xalqaro aeroport orqali 1000 AQSh dollari; "
    "temir yo'l va daryo o'tkazish punktlari orqali 500 dollar; avtomobil yoki piyoda 300 dollar.\n"
    "2) Xalqaro pochta/kuryer jo'natmalari: yuridik shaxs nomiga 100 dollargacha bojsiz; "
    "jismoniy shaxsga kuryer orqali bir kalendar oyda 200 dollargacha bojsiz.\n"
    "3) Valyuta: naqd xorijiy valyuta olib kirish cheklanmagan, lekin 100 million so'm ekvivalentidan "
    "oshsa deklaratsiya majburiy; olib chiqish 100 million so'mgacha hujjatsiz, ortig'iga ruxsatnoma/deklaratsiya kerak.\n\n"
    "Suhbat boshida o'zingni qisqa tanishtir va yo'lovchiga qanday yordam bera olishingni ayt."
)


def _config() -> types.LiveConnectConfig:
    # ⚠️ Native audio model tool (google_search/function) bilan audio o'rniga TEXT qaytaradi —
    # shuning uchun tabiiy ovoz uchun tool ishlatilmaydi; aniqlik system prompt fakt­lariga tayanadi.
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=SYSTEM_INSTRUCTION,
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )


@router.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    if not settings.gemini_ready:
        await ws.send_text(json.dumps({"type": "error", "msg": "GEMINI_API_KEY sozlanmagan"}))
        await ws.close()
        return

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        async with client.aio.live.connect(model=LIVE_MODEL, config=_config()) as session:
            await ws.send_text(json.dumps({"type": "ready"}))

            async def browser_to_gemini():
                while True:
                    msg = await ws.receive()
                    if msg.get("type") == "websocket.disconnect":
                        raise WebSocketDisconnect()
                    data = msg.get("bytes")
                    if data is not None:
                        # Brauzer mikrofoni — PCM16 16kHz
                        await session.send_realtime_input(
                            audio=types.Blob(data=data, mime_type="audio/pcm;rate=16000")
                        )
                        continue
                    text = msg.get("text")
                    if text:
                        ctl = json.loads(text)
                        if ctl.get("type") == "text":  # test/fallback: matn yuborish
                            await session.send_client_content(
                                turns=types.Content(role="user", parts=[types.Part(text=ctl.get("text", ""))]),
                                turn_complete=True,
                            )

            async def gemini_to_browser():
                async for resp in session.receive():
                    sc = resp.server_content
                    if resp.data:
                        await ws.send_bytes(resp.data)          # audio (PCM16 24kHz)
                    if sc:
                        if sc.interrupted:
                            await ws.send_text(json.dumps({"type": "interrupted"}))
                        tr = sc.output_transcription
                        if tr and tr.text:
                            await ws.send_text(json.dumps({"type": "transcript", "text": tr.text}))
                        if sc.turn_complete:
                            await ws.send_text(json.dumps({"type": "turn_complete"}))

            up = asyncio.create_task(browser_to_gemini())
            down = asyncio.create_task(gemini_to_browser())
            done, pending = await asyncio.wait({up, down}, return_when=asyncio.FIRST_EXCEPTION)
            for t in pending:
                t.cancel()
            for t in done:
                exc = t.exception()
                if exc and not isinstance(exc, WebSocketDisconnect):
                    raise exc
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        try:
            await ws.send_text(json.dumps({"type": "error", "msg": str(e)[:200]}))
        except Exception:  # noqa: BLE001
            pass
    finally:
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass
