"""Bilim bazasi (Q&A CSV) -> app/assets/kb.json + kb_emb.bin (Gemini embedding).
Ishlatish:  cd backend && python scripts/build_kb.py "<1000 Q&A.csv>"
"""
import array, csv, io, json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from google import genai
from google.genai import types
from app.config import get_settings
from app.translit import to_latin

EMB_MODEL, DIM = "gemini-embedding-001", 256
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "assets")


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


rows = []
for r in csv.reader(io.StringIO(open(sys.argv[1], encoding="utf-8-sig", newline="").read())):
    if len(r) >= 3 and clean(r[1]) and clean(r[2]):
        rows.append({"id": clean(r[0]), "q": clean(r[1]), "a": clean(r[2])})
print("savollar:", len(rows))

client = genai.Client(api_key=get_settings().gemini_api_key)
vecs = []
for i in range(0, len(rows), 100):
    batch = [to_latin(x["q"]) for x in rows[i:i + 100]]
    for attempt in range(5):
        try:
            res = client.models.embed_content(model=EMB_MODEL, contents=batch,
                                              config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT", output_dimensionality=DIM))
            break
        except Exception as e:  # noqa: BLE001
            print("retry", str(e)[:100]); time.sleep(5 * (attempt + 1))
    vecs.extend(e.values for e in res.embeddings)
    print(i + len(batch), "/", len(rows))

import math
buf = array.array("f")
for v in vecs:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    buf.extend(x / n for x in v)
json.dump(rows, open(os.path.join(ASSETS, "kb.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
open(os.path.join(ASSETS, "kb_emb.bin"), "wb").write(buf.tobytes())
print("OK", len(rows), "dim", DIM)
