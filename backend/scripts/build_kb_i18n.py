"""Tayyor ovozli javoblarni (kb.json "s" + answers.json "text") boshqa tillarga OLDINDAN tarjima qiladi — runtime'da LLM chaqirilmaydi.
Natija: app/assets/kb_i18n/<til>.json (kb.json qatorlari tartibida satrlar massivi) va app/assets/answers_i18n.json ({id: {til: matn}}).
Ishlatish: cd backend && python scripts/build_kb_i18n.py [til ...]   (mavjud fayllar qayta qilinmaydi; --force bilan qayta)
"""
import asyncio, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from google import genai
from google.genai import types
from app.config import get_settings
from app.tts_voice import LANG_EN, clean_for_speech

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "assets")
OUT = os.path.join(ASSETS, "kb_i18n")
os.makedirs(OUT, exist_ok=True)
rows = json.load(open(os.path.join(ASSETS, "kb.json"), encoding="utf-8"))
answers = json.load(open(os.path.join(ASSETS, "answers.json"), encoding="utf-8"))
client = genai.Client(api_key=get_settings().gemini_api_key)
sem = asyncio.Semaphore(12)
force = "--force" in sys.argv
langs = [a for a in sys.argv[1:] if not a.startswith("--")] or [k for k in LANG_EN if k not in ("uz", "xx")]


def system(lang: str) -> str:
    return (
        f"You translate short spoken answers of a customs officer of Uzbekistan from Uzbek into {LANG_EN[lang]}. The translations are read ALOUD to a passenger. "
        f"Rules: natural, formal and polite {LANG_EN[lang]} in its standard native script (never transliterate); keep EVERY fact, amount, limit and condition exactly - add nothing, omit nothing; "
        "numbers and amounts stay spelled out as WORDS in the target language (no digits); write 'dollar'/'percent' as words; no markdown, lists, brackets or emoji; do not add greetings. "
        "Input: a JSON array of Uzbek strings. Output: ONLY a JSON array of translated strings, SAME length and SAME order."
    )


async def translate(lang: str, texts: list[str]) -> list[str]:
    async with sem:
        for attempt in range(5):
            try:
                r = await client.aio.models.generate_content(
                    model="gemini-2.5-flash", contents=json.dumps(texts, ensure_ascii=False),
                    config=types.GenerateContentConfig(system_instruction=system(lang), temperature=0.1, max_output_tokens=8000,
                                                       response_mime_type="application/json", thinking_config=types.ThinkingConfig(thinking_budget=0)))
                arr = json.loads(r.text)
                if isinstance(arr, list) and len(arr) == len(texts) and all(isinstance(x, str) and x.strip() for x in arr):
                    return [clean_for_speech(x) for x in arr]
                raise ValueError("uzunlik mos emas")
            except Exception as e:  # noqa: BLE001
                await asyncio.sleep(2 * (attempt + 1))
        if len(texts) > 1:  # bo'lib qayta urinish
            out = []
            for t in texts:
                out.extend(await translate_one(lang, t))
            return out
        return [""]


async def translate_one(lang: str, text: str) -> list[str]:
    return await translate(lang, [text])


async def do_lang(lang: str) -> None:
    path = os.path.join(OUT, lang + ".json")
    if os.path.exists(path) and not force:
        print(lang, "bor — o'tkazib yuborildi"); return
    idx = [i for i, r in enumerate(rows) if r.get("s")]
    batches = [idx[i:i + 10] for i in range(0, len(idx), 10)]
    res = await asyncio.gather(*[translate(lang, [rows[i]["s"] for i in b]) for b in batches])
    out = [""] * len(rows)
    for b, arr in zip(batches, res):
        for i, t in zip(b, arr):
            out[i] = t
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(lang, "kb:", sum(1 for x in out if x), "/", len(idx), flush=True)


async def do_answers() -> None:
    path = os.path.join(ASSETS, "answers_i18n.json")
    cur = json.load(open(path, encoding="utf-8")) if os.path.exists(path) and not force else {}
    texts = [a["text"] for a in answers]
    for lang in langs:
        if all(lang in cur.get(a["id"], {}) for a in answers):
            continue
        arr = await translate(lang, texts)
        for a, t in zip(answers, arr):
            if t:
                cur.setdefault(a["id"], {})[lang] = t
        print(lang, "answers ok", flush=True)
    json.dump(cur, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


async def main():
    await do_answers()
    await asyncio.gather(*[do_lang(l) for l in langs])

asyncio.run(main())
