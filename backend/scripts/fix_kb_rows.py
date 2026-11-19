"""kb.json dagi nuqsonli qatorlarni tuzatadi: (1) savol-javobi RUSCHA bo'lgan qatorlar — "s" o'zbekcha (lotin) qayta yoziladi, savolning o'zbekcha tarjimasi "quz" qo'shiladi va
embedding shu bo'yicha yangilanadi; (2) "s" = NOT FOUND bo'lgan qatorlar — qayta urinib ko'riladi, bo'lmasa "s" olib tashlanadi. So'ng o'zgargan qatorlar kb_i18n da qayta tarjima qilinadi.
Ishlatish: cd backend && python scripts/fix_kb_rows.py"""
import array, asyncio, json, math, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from google import genai
from google.genai import types
from app.config import get_settings
from app.tts_voice import LANG_EN, clean_for_speech, _shorten
from app.kb import EMB_MODEL, DIM

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "assets")
P = os.path.join(ASSETS, "kb.json")
rows = json.load(open(P, encoding="utf-8"))
client = genai.Client(api_key=get_settings().gemini_api_key)
sem = asyncio.Semaphore(10)
RU = re.compile(r"\b(dlya|ili|pri|eto|kotor\w*|yavlya\w*|sootvet\w*|doljn\w*|mojet|mogut|tamojen\w*|tovarov|litsa|v|na|s|po|ne|i|ot|iz|chto|kak|budet|imeyut|yest)\b", re.I)
UZ = re.compile(r"\b(bojxona\w*|uchun|bo'l\w*|va|bilan|kerak|mumkin|hamda|tomonidan|bo'yicha|lozim|shaxs\w*|qilin\w*|etil\w*|beril\w*)\b", re.I)


def is_ru(s: str) -> bool:
    return len(RU.findall(s)) > len(UZ.findall(s))


def is_nf(s: str) -> bool:
    return bool(re.search(r"not[ _]?found", s, re.I))


SYS = (
    "Sen O'zbekiston bojxona qo'mitasining virtual xodimisan. Senga rasmiy savol-javob beriladi (rus yoki o'zbek tilida, kirill yozuvida bo'lishi mumkin). JSON qaytar: "
    "quz — savolning O'ZBEK tilidagi (LOTIN yozuvida) aniq tarjimasi; s — yo'lovchiga OVOZDA aytiladigan O'ZBEKCHA (LOTIN) qisqa javob: 2-3 gap, berilgan javob mazmunidan tashqariga chiqma, "
    "qaror raqami, sanasi va modda raqamini aytma, raqamlarni so'z bilan yoz, belgi/ro'yxat/qavssiz, 'Siz' deb murojaat qil. Rus tilida YOZMA."
)


async def regen(i: int):
    r = rows[i]
    async with sem:
        for attempt in range(4):
            try:
                x = await client.aio.models.generate_content(
                    model="gemini-2.5-flash", contents=f"Savol: {r['q']}\nJavob: {r['a'][:2500]}",
                    config=types.GenerateContentConfig(system_instruction=SYS, temperature=0.2, max_output_tokens=900, response_mime_type="application/json",
                        response_schema={"type": "OBJECT", "properties": {"quz": {"type": "STRING"}, "s": {"type": "STRING"}}, "required": ["quz", "s"]},
                        thinking_config=types.ThinkingConfig(thinking_budget=0)))
                j = json.loads(x.text)
                s = _shorten(clean_for_speech(j["s"]), 3, 320, 460)
                if s and not is_nf(s) and not is_ru(s):
                    return i, clean_for_speech(j["quz"]), s
            except Exception as e:  # noqa: BLE001
                await asyncio.sleep(2 * (attempt + 1))
    return i, "", ""


async def translate(lang: str, texts: list[str]) -> list[str]:
    sys_ = (f"You translate short spoken answers of a customs officer of Uzbekistan from Uzbek into {LANG_EN[lang]}. They are read ALOUD. Natural, formal, polite, standard native script; "
            "keep every fact, amount and condition exactly; numbers spelled out as words; no markdown or lists. Input: JSON array of strings. Output: ONLY a JSON array, same length and order.")
    async with sem:
        for attempt in range(5):
            try:
                x = await client.aio.models.generate_content(model="gemini-2.5-flash", contents=json.dumps(texts, ensure_ascii=False),
                    config=types.GenerateContentConfig(system_instruction=sys_, temperature=0.1, max_output_tokens=8000, response_mime_type="application/json",
                                                       thinking_config=types.ThinkingConfig(thinking_budget=0)))
                arr = json.loads(x.text)
                if isinstance(arr, list) and len(arr) == len(texts) and all(isinstance(t, str) and t.strip() for t in arr):
                    return [clean_for_speech(t) for t in arr]
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(2 * (attempt + 1))
    return [""] * len(texts)


async def main():
    bad = [i for i, r in enumerate(rows) if r.get("s") and (is_ru(r["s"]) or is_nf(r["s"]))]
    print("tuzatiladigan qatorlar:", len(bad))
    res = await asyncio.gather(*[regen(i) for i in bad])
    fixed, dropped = [], []
    for i, quz, s in res:
        if s:
            rows[i]["s"] = s
            if quz:
                rows[i]["quz"] = quz
            fixed.append(i)
        else:
            rows[i].pop("s", None); dropped.append(i)
    print("tuzatildi:", len(fixed), "olib tashlandi:", len(dropped))
    # embedding: o'zbekcha savol bo'yicha
    emb = array.array("f"); emb.frombytes(open(os.path.join(ASSETS, "kb_emb.bin"), "rb").read())
    todo = [i for i in fixed if rows[i].get("quz")]
    for k in range(0, len(todo), 100):
        part = todo[k:k + 100]
        e = client.models.embed_content(model=EMB_MODEL, contents=[rows[i]["quz"] for i in part],
                                        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT", output_dimensionality=DIM))
        for i, v in zip(part, e.embeddings):
            n = math.sqrt(sum(x * x for x in v.values)) or 1.0
            emb[i * DIM:(i + 1) * DIM] = array.array("f", [x / n for x in v.values])
    open(os.path.join(ASSETS, "kb_emb.bin"), "wb").write(emb.tobytes())
    json.dump(rows, open(P, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    # tarjimalar
    for f in sorted(os.listdir(os.path.join(ASSETS, "kb_i18n"))):
        lang = f[:-5]; path = os.path.join(ASSETS, "kb_i18n", f)
        arr = json.load(open(path, encoding="utf-8"))
        for i in dropped:
            arr[i] = ""
        batches = [fixed[k:k + 10] for k in range(0, len(fixed), 10)]
        out = await asyncio.gather(*[translate(lang, [rows[i]["s"] for i in b]) for b in batches])
        for b, o in zip(batches, out):
            for i, t in zip(b, o):
                arr[i] = t
        json.dump(arr, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(lang, "qayta tarjima:", sum(1 for i in fixed if arr[i]), "/", len(fixed), flush=True)

asyncio.run(main())
