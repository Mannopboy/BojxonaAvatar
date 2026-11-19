"""Tarjima sifatini tanlab tekshirish: har tildan N ta tasodifiy javob, hakam model o'zbekcha manba bilan solishtiradi (fakt/raqam saqlanganmi, til/yozuv to'g'rimi).
Ishlatish: cd backend && python scripts/check_kb_i18n.py [N]"""
import asyncio, json, os, random, sys, io
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from google import genai
from google.genai import types
from app.config import get_settings
from app.tts_voice import LANG_EN

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "assets")
rows = json.load(open(os.path.join(ASSETS, "kb.json"), encoding="utf-8"))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 30
client = genai.Client(api_key=get_settings().gemini_api_key)
random.seed(7)
idx = random.sample([i for i, r in enumerate(rows) if r.get("s")], N)


async def check(lang: str):
    path = os.path.join(ASSETS, "kb_i18n", lang + ".json")
    if not os.path.exists(path):
        return lang, None, None, []
    arr = json.load(open(path, encoding="utf-8"))
    filled = sum(1 for x in arr if x)
    pairs = [{"n": k, "uz": rows[i]["s"], "tr": arr[i]} for k, i in enumerate(idx)]
    sys_ = (f"You are a strict translation reviewer. Each item has an Uzbek source 'uz' and its {LANG_EN[lang]} translation 'tr'. "
            f"For each item decide ok=true only if: the translation is in {LANG_EN[lang]} in its standard script, and ALL facts, numbers, amounts and conditions match the source (nothing added, nothing lost, no changed number). "
            "Minor style differences are fine. Return ONLY a JSON array: [{\"n\": 0, \"ok\": true, \"why\": \"\"}] (why: short English reason when ok=false).")
    r = await client.aio.models.generate_content(model="gemini-2.5-flash", contents=json.dumps(pairs, ensure_ascii=False),
        config=types.GenerateContentConfig(system_instruction=sys_, temperature=0.0, max_output_tokens=30000, response_mime_type="application/json"))
    try:
        res = json.loads(r.text)
    except Exception:
        return lang, filled, 0, []
    bad = [(x["n"], x.get("why", "")) for x in res if not x.get("ok")]
    return lang, filled, len(res), bad


async def main():
    langs = [k for k in LANG_EN if k not in ("uz", "xx")]
    for lang, filled, n, bad in await asyncio.gather(*[check(l) for l in langs]):
        if filled is None:
            print(lang, "fayl yo'q"); continue
        print(f"{lang}: to'ldirilgan {filled}/{sum(1 for r in rows if r.get('s'))}, tekshirildi {n}, xato {len(bad)}")
        for k, why in bad[:6]:
            print("    -", rows[idx[k]]["s"][:70], "|", why[:140])

asyncio.run(main())
