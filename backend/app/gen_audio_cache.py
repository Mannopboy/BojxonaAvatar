"""Qat'iy matnlarni ASOSIY TTS ovozi bilan ovozlab `app/assets/audio_cache/<sha1>.pcm` ga yozadi (git'da turadi — kvota sarflanmaydi, ovoz har doim bir xil):
video'siz tayyor javoblar (answers.json, "video": false), qayta so'rash, «eshitmadim», xato matnlari va xayrlashuv (uz/ru/en).

    cd backend && python -m app.gen_audio_cache          # GEMINI_API_KEY kerak; mavjud fayllar qayta ovozlanmaydi
    python -m app.gen_audio_cache --force                # hammasini qayta ovozlash (matn yoki ovoz o'zgarsa)

Faqat asosiy model (gemini-3.8-flash-tts) qabul qilinadi: zaxira (lite-TTS/Live) ovozi bilan yozilsa — to'xtaydi (aks holda tayyor audio boshqa ovozda bo'lib qolardi).
"""
import asyncio
import json
import os
import sys

from . import tts_voice as T


async def main(force: bool) -> int:
    texts = [a["text"] for a in T.ANSWERS if not a.get("video", True)] + [T.REASK_TEXT, T.FALLBACK_TEXT, T.ERROR_TEXT] + list(T.FAREWELL.values())
    os.makedirs(T.AUDIO_CACHE_DIR, exist_ok=True)
    index_path = os.path.join(T.AUDIO_CACHE_DIR, "index.json")
    try:
        index = json.load(open(index_path, encoding="utf-8"))
    except (OSError, ValueError):
        index = {}
    for text in texts:
        name = T._cache_name(text)
        path = os.path.join(T.AUDIO_CACHE_DIR, name)
        if os.path.exists(path) and not force:
            print("bor      ", name, text[:60])
            continue
        buf = bytearray()
        info: dict = {}
        async for ch in T.synth_stream(text, info):
            buf.extend(ch)
        if info.get("voice") != "tts" or not buf:
            print("XATO: asosiy TTS ovozi olinmadi (voice=%s) — kvota? Keyinroq qayta urinib ko'ring." % info.get("voice"))
            return 1
        open(path, "wb").write(bytes(buf))
        index[name] = text
        print("yozildi  ", name, "%.1f s" % (len(buf) / 48000), text[:60])
    json.dump(index, open(index_path, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1, sort_keys=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main("--force" in sys.argv)))
