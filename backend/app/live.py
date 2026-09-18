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
    "MUHIM: eng BIRINCHI javobingда — 'Assalomu alaykum' deb salomlash, o'zingni qisqa tanishtir "
    "(sen Davlat bojxona qo'mitasi virtual xodimisan), so'ng yo'lovchining savoliga javob ber. "
    "Keyingi javoblarда qayta tanishtirma."
)


def _config() -> types.LiveConnectConfig:
    # ⚠️ Native audio model tool (google_search/function) bilan audio o'rniga TEXT qaytaradi —
    # shuning uchun tabiiy ovoz uchun tool ishlatilmaydi; aniqlik system prompt fakt­lariga tayanadi.
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=SYSTEM_INSTRUCTION,
        output_audio_transcription=types.AudioTranscriptionConfig(),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=settings.gemini_voice)
            )
        ),
        # ⚠️ Native audio + greeting bilan avtomatik VAD ishonchsiz (greeting'dan keyin javob bermaydi).
        # Shuning uchun QO'LDA activity: frontend gapirish boshi/oxirini aniqlab activity_start/end yuboradi.
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(disabled=True)
        ),
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

            async def forward_response():
                """Gemini javobini turn_complete gacha o'qib clientga uzatadi (HALF-DUPLEX).
                ⚠️ send_client_content (greeting) parallel receive bilan mos kelmaydi — shuning uchun
                har turn ketma-ket: yuboramiz → javobni to'liq o'qiymiz → keyingi turn."""
                async for resp in session.receive():
                    sc = resp.server_content
                    if resp.data:
                        await ws.send_bytes(resp.data)  # audio (PCM16 24kHz)
                    if sc:
                        if sc.interrupted:
                            await ws.send_text(json.dumps({"type": "interrupted"}))
                        tr = sc.output_transcription
                        if tr and tr.text:
                            await ws.send_text(json.dumps({"type": "transcript", "text": tr.text}))
                        if sc.turn_complete:
                            await ws.send_text(json.dumps({"type": "turn_complete"}))
                            return

            # ⚠️ Auto-greeting (send_client_content) OLIB TASHLANDI: u audio-turn hosil qilganда
            # keyingi realtime activity turn'ni buzardi (foydalanuvchi gapirsa javob bermasdi).
            # Buning o'rniga model system prompt bo'yicha BIRINCHI javobda o'zini tanishtiradi.

            # Suhbat sikli — half-duplex. Frontend avatar gapirganda mikrofonni yubormaydi (gate).
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                data = msg.get("bytes")
                if data is not None:  # mikrofon audio (activity ichida)
                    await session.send_realtime_input(
                        audio=types.Blob(data=data, mime_type="audio/pcm;rate=16000")
                    )
                    continue
                text = msg.get("text")
                if not text:
                    continue
                ctl = json.loads(text)
                ctype = ctl.get("type")
                if ctype == "activity_start":  # foydalanuvchi gapira boshladi
                    await session.send_realtime_input(activity_start=types.ActivityStart())
                elif ctype == "activity_end":  # gapirib bo'ldi → javobni o'qiymiz
                    await session.send_realtime_input(activity_end=types.ActivityEnd())
                    await forward_response()
                elif ctype == "text":  # test/fallback
                    await session.send_client_content(
                        turns=types.Content(role="user", parts=[types.Part(text=ctl.get("text", ""))]),
                        turn_complete=True,
                    )
                    await forward_response()
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
