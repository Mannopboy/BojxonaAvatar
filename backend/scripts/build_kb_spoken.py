"""Bilim bazasi javoblaridan OVOZLI qisqa variant (kb.json dagi "s" maydoni): LOTIN, 2-3 gap, raqamlar so'z bilan.
Runtime'da LLM chaqirilmaydi — tayyor matn darhol ovozlanadi. Ishlatish: cd backend && python scripts/build_kb_spoken.py
"""
import asyncio, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from google import genai
from google.genai import types
from app.config import get_settings
from app.tts_voice import clean_for_speech, KB_SYSTEM, _shorten, _strip_greeting
from app.translit import to_latin

P = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "assets", "kb.json")
rows = json.load(open(P, encoding="utf-8"))
client = genai.Client(api_key=get_settings().gemini_api_key)
SYS = KB_SYSTEM.split("\nBazada savolga")[0] + (
    "\nVAZIFA: quyida bir nechta savol-javob (rasmiy). HAR BIRI uchun yo'lovchiga OVOZDA aytiladigan qisqa javob yoz: 2-3 gap, savolning mohiyatiga to'g'ridan-to'g'ri javob, "
    "bazadagi ma'lumotdan tashqariga chiqma. Qaror raqami, sana, modda raqamini aytma. Lotin yozuvida, raqamlar so'z bilan, belgi/ro'yxat/qavssiz. "
    "Faqat JSON massiv qaytar: satrlar massivi, TARTIB va SONI kiritilgan savollar bilan AYNAN bir xil (har savolga bitta satr)."
)
sem = asyncio.Semaphore(6)


async def do(batch):
    ctx = "\n\n".join(f"id: {r['id']}\nSavol: {to_latin(r['q'])}\nJavob: {r['a'][:1800]}" for r in batch)
    async with sem:
        for attempt in range(4):
            try:
                r = await client.aio.models.generate_content(
                    model="gemini-2.5-flash", contents=ctx,
                    config=types.GenerateContentConfig(system_instruction=SYS, temperature=0.2, max_output_tokens=4000,
                                                       response_mime_type="application/json",
                                                       thinking_config=types.ThinkingConfig(thinking_budget=0)))
                arr = json.loads(r.text)
                if not isinstance(arr, list) or len(arr) != len(batch) or not all(isinstance(x, str) for x in arr):
                    raise ValueError("massiv uzunligi mos emas")
                for row, txt in zip(batch, arr):
                    yield_map[row["_i"]] = txt
                return
            except Exception as e:  # noqa: BLE001
                print("retry", str(e)[:100]); await asyncio.sleep(3 * (attempt + 1))


yield_map: dict = {}


async def main():
    for n, r in enumerate(rows):
        r['_i'] = str(n)  # CSV dagi id lar takrorlanadi — indeks bo'yicha bog'lanadi
    batches = [rows[i:i + 6] for i in range(0, len(rows), 6)]
    await asyncio.gather(*[do(b) for b in batches])
    ok = 0
    for r in rows:
        s = clean_for_speech(yield_map.get(r['_i'], ""))
        s = _shorten(_strip_greeting(s), 3, 320, 460) if s else ""
        r.pop('_i', None)
        r.pop('s', None)
        if s:
            r["s"] = s; ok += 1
    json.dump(rows, open(P, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("spoken:", ok, "/", len(rows))

asyncio.run(main())
