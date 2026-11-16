"""/ws/live haqiqiy e2e testi (HAQIQIY Gemini; erkin javob 1 ta TTS so'rovi sarflaydi):
    cd backend && python tests/ws_e2e.py [ws://127.0.0.1:8000/ws/live] [noise.wav speech.wav]
Tekshiradi: ready (faqat video klip id lari), turn_complete.timing, video'siz tayyor javob (audio kesh, TTS yo'q), tayyor klip, shovqin → qisqa qayta so'rash,
javobni bo'lish (activity_start → interrupted, eski javob uziladi, yangi javob transcript bilan boshlanadi), wake rejimi.
noise.wav / speech.wav — 16-bit mono WAV (24 kHz yoki 16 kHz); bo'lmasa shovqin sun'iy yaratiladi, nutq testi o'tkazib yuboriladi.
"""
import array
import asyncio
import json
import math
import random
import sys
import time
import wave

import websockets

URL = next((a for a in sys.argv[1:] if a.startswith("ws")), "ws://127.0.0.1:8000/ws/live")
WAVS = [a for a in sys.argv[1:] if a.endswith(".wav")]
failed = 0


def ok(name, cond, extra=""):
    global failed
    if not cond:
        failed += 1
    print(f"  {'O`TDI  ' if cond else 'O`TMADI'} {name}{('  — ' + str(extra)) if extra else ''}")


def noise16k(seconds=1.8):
    random.seed(3)
    n = int(seconds * 16000)
    return array.array("h", (int(max(-1, min(1, random.gauss(0, 0.12) * (0.5 - 0.5 * math.cos(2 * math.pi * i / n)) * 2)) * 32767) for i in range(n))).tobytes()


def wav16k(path, t0=None, t1=None):
    w = wave.open(path)
    r = w.getframerate()
    a = array.array("h")
    a.frombytes(w.readframes(w.getnframes()))
    w.close()
    if t0 is not None:
        a = a[int(t0 * r): int((t1 or len(a) / r) * r)]
    return array.array("h", (a[int(i * r / 16000)] for i in range(int(len(a) * 16000 / r)))).tobytes()


class Conn:
    def __init__(self, ws):
        self.ws = ws
        self.msgs = []  # (t, tur, qiymat)

    async def recv(self, timeout=60):
        m = await asyncio.wait_for(self.ws.recv(), timeout)
        t = time.monotonic()
        if isinstance(m, bytes):
            self.msgs.append((t, "audio", len(m)))
            return "audio", len(m)
        j = json.loads(m)
        self.msgs.append((t, j["type"], j))
        return j["type"], j

    async def turn(self, until=("turn_complete", "wake_ignored", "error", "interrupted"), timeout=90):
        """Hodisalarni tur oxirigacha yig'adi: (xabar turlari ro'yxati, audio bayt, turn_complete.timing, birinchi audiogacha sekund)."""
        t0 = time.monotonic()
        kinds, audio, timing, first = [], 0, None, None
        end = None
        while True:
            k, v = await self.recv(timeout)
            if k == "audio":
                audio += v
                first = first if first is not None else time.monotonic() - t0
                continue
            kinds.append(k)
            if k == "transcript" and v.get("text"):
                kinds[-1] = "transcript"
            if k == "turn_complete":
                timing = v.get("timing")
            if k in until:
                end = k
                break
        return {"kinds": kinds, "audio": audio, "timing": timing, "first": first, "end": end, "dt": time.monotonic() - t0}

    async def speak(self, pcm):
        await self.ws.send(json.dumps({"type": "activity_start"}))
        for i in range(0, len(pcm), 8192):
            await self.ws.send(pcm[i:i + 8192])
        await self.ws.send(json.dumps({"type": "activity_end"}))

    async def say_text(self, text):
        await self.ws.send(json.dumps({"type": "text", "text": text}))


async def main():
    from_dir = None
    try:
        sys.path.insert(0, ".")
        from app import tts_voice as T  # javoblar ro'yxati va qat'iy matnlar

        ans = {a["id"]: a for a in T.ANSWERS}
    except Exception as e:  # noqa: BLE001
        print("app import qilinmadi:", e)
        return 2

    print(f"\n=== oddiy suhbat ({URL})")
    async with websockets.connect(URL, max_size=None) as ws:
        c = Conn(ws)
        k, ready = await c.recv()
        ok("ready: faqat video klip id lari", ready["clips"] == ["airport", "rail"] and ready.get("wake") is False, ready)
        g = await c.turn()
        ok("salom (tayyor fayl) + turn_complete", g["end"] == "turn_complete" and g["audio"] > 200_000, f"{g['audio']/48000:.1f} s")

        await c.say_text("Avtomobil orqali qancha dollarlik tovarni bojsiz olib kirish mumkin?")
        r = await c.turn()
        tr = next((m[2]["text"] for m in c.msgs if m[1] == "transcript" and m[2].get("text") and m[0] > 0), "")
        tm = r["timing"] or {}
        ok("video'siz tayyor javob: matn aynan tasdiqlangan", r["end"] == "turn_complete" and ans["car"]["text"] in [m[2].get("text") for m in c.msgs if m[1] == "transcript"], tr[:70])
        ok("audio diskdan (TTS yo'q): voice = cache, clip xabari yo'q", tm.get("voice") == "cache" and "clip" not in r["kinds"], tm)
        ok("audio uzunligi keshdagi PCM ga teng", abs(r["audio"] - __import__("os").path.getsize(__import__("os").path.join(T.AUDIO_CACHE_DIR, T._cache_name(ans["car"]["text"])))) < 4, f"{r['audio']/48000:.1f} s")
        ok("timing maydonlari (understand_ms, answer_ms, first_ms, tts_first_ms)", all(x in tm for x in ("understand_ms", "answer_ms", "first_ms", "tts_first_ms")), tm)

        await c.say_text("Aeroport orqali qancha dollarlik tovar bojsiz?")
        r = await c.turn()
        ok("tayyor video klip: clip xabari, voice = clip", "clip" in r["kinds"] and (r["timing"] or {}).get("voice") == "clip" and r["audio"] == 0, r["timing"])
        clip = next(m[2]["id"] for m in c.msgs if m[1] == "clip")
        ok("klip id si airport", clip == "airport", clip)

        await c.say_text("Bojxona deklaratsiyasini to'ldirishda qanday hujjatlar kerak bo'ladi?")
        r = await c.turn()
        tm = r["timing"] or {}
        ok("erkin javob: transcript audiodan oldin, turn_complete.timing.voice (tts / tts-lite / live)", r["kinds"][:1] == ["transcript"] and tm.get("voice") in ("tts", "tts-lite", "live") and r["audio"] > 24000, tm)

    print("\n=== shovqin → qisqa qayta so'rash")
    pcm_noise = wav16k(WAVS[0], 2.9, 4.8) if WAVS else noise16k()
    got = []
    for attempt in (1, 2):
        async with websockets.connect(URL, max_size=None) as ws:
            c = Conn(ws)
            await c.recv()
            await c.turn()  # salom
            await c.speak(pcm_noise)
            r = await c.turn()
            texts = [m[2].get("text") for m in c.msgs if m[1] == "transcript" and m[2].get("text")]
            reask = T.REASK_TEXT in texts
            got.append((reask, r["dt"], r["timing"], texts[-1][:50] if texts else ""))
            if reask:
                break
    reask, dt, tm, txt = got[-1]
    ok("tushunarsiz gapga qisqa qayta so'rash (matn: «%s»)" % T.REASK_TEXT, reask, txt)
    ok("qayta so'rash tez (<= 4 s) va audio keshdan", reask and dt <= 4.0 and (tm or {}).get("voice") == "cache", f"{dt:.1f} s, {tm}")

    print("\n=== javobni bo'lish (barge-in)")
    async with websockets.connect(URL, max_size=None) as ws:
        c = Conn(ws)
        await c.recv()
        await c.turn()  # salom
        await c.say_text("Bojxona qoidalarini buzgan yo'lovchiga qanday choralar ko'riladi? Batafsil tushuntirib bering.")
        # birinchi audio bo'lagigacha kutamiz
        t_first = None
        while True:
            k, v = await c.recv(60)
            if k == "audio":
                t_first = time.monotonic()
                break
            if k in ("turn_complete", "error"):
                break
        if t_first is None:
            ok("barge-in: javob audiosi boshlandi", False, "audio kelmadi")
        else:
            await ws.send(json.dumps({"type": "activity_start"}))  # yo'lovchi gapira boshladi
            t_sent = time.monotonic()
            seen_int = None
            audio_after = 0
            while time.monotonic() - t_sent < 6:
                try:
                    k, v = await c.recv(1.5)
                except asyncio.TimeoutError:
                    break
                if k == "interrupted" and seen_int is None:
                    seen_int = time.monotonic() - t_sent
                elif k == "audio" and seen_int is not None:
                    audio_after += v
                elif k == "turn_complete" and seen_int is None:
                    break
            ok("javob uzun edi va audio ketayotganda activity_start → interrupted keldi", seen_int is not None, f"{seen_int and round(seen_int, 2)} s")
            ok("interrupted dan keyin eski javob audiosi kelmadi", audio_after == 0, f"{audio_after} bayt")
            idx = max(i for i, m in enumerate(c.msgs) if m[1] == "interrupted")
            ok("uzilgan javob uchun turn_complete yuborilmadi (interrupted dan keyin hech narsa kelmadi)", not any(m[1] == "turn_complete" for m in c.msgs[idx:]), [m[1] for m in c.msgs[idx:]])
            # yangi savol (matn) — yangi javob transcript/clip bilan boshlanadi
            await ws.send(json.dumps({"type": "activity_end"}))  # bo'sh yig'ma (<0.5 s): turn_complete bilan yopiladi
            k, v = await c.recv(10)
            ok("bo'sh gap oddiy yopiladi (turn_complete)", k == "turn_complete", k)
            await c.say_text("Aeroport orqali qancha dollar bojsiz?")
            r = await c.turn()
            ok("yangi javob: clip + turn_complete (suhbat davom etadi)", "clip" in r["kinds"] and r["end"] == "turn_complete", r["kinds"])

    if len(WAVS) >= 2:
        print("\n=== wake rejimi (salom)")
        speech = wav16k(WAVS[1], 2.6, 5.6)
        async with websockets.connect(URL + ("&" if "?" in URL else "?") + "wake=1", max_size=None) as ws:
            c = Conn(ws)
            k, ready = await c.recv()
            ok("ready.wake = true, salom darrov berilmadi", ready.get("wake") is True)
            await c.speak(speech)
            r = await c.turn()
            ok("o'zbekcha salom: greeting + tayyor audio + timing", "greeting" in r["kinds"] and r["audio"] > 200_000 and (r["timing"] or {}).get("voice") == "cache", r["timing"])

    print(f"\nJAMI: {'hammasi o`tdi' if not failed else str(failed) + ' ta tekshiruv O`TMADI'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
