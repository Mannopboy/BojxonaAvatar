"""Bilim bazasi admin API testi (Gemini/tarmoq kerak emas — tayyorlash bosqichi almashtirilgan):  cd backend && python -m unittest discover -s tests -v

Tekshiradi: boshlang'ich ma'lumotdan qurilish (uid, tarjima, embedding), kalit (503/401/429), ro'yxat/qidiruv/filtr, yaratish → tahrirlash (faqat o'zgargani qayta tayyorlanadi) →
o'chirib qo'yish → o'chirish, faylga saqlanishi (qayta yuklashdan keyin ham), zaxira nusxa (.bak), qidiruvda o'chirilgan qator chiqmasligi."""
import asyncio
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("GEMINI_API_KEY", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app import kb, kb_admin as A  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402

KEY = "test-kb-key"
H = {"X-Admin-Key": KEY}
Q1 = "Test dron savoli?"
A2 = "Yangi javob matni."
S_MANUAL = "Qo'lda yozilgan javob."


def vec(seed: float) -> list[float]:
    return [seed] + [0.0] * (kb.DIM - 2) + [1.0 - seed]


class KbAdminTests(unittest.TestCase):
    def setUp(self):
        self.s = get_settings()
        self.tmp = tempfile.mkdtemp(prefix="kb-test-")
        self.old = (self.s.kb_dir, self.s.kb_admin_key)
        self.s.kb_dir, self.s.kb_admin_key = self.tmp, KEY
        kb.reload()
        A._fails.clear()
        self.calls = {"spoken": 0, "tr": 0, "emb": 0}
        self.orig = (A.make_spoken, A.translate_all, A.embed_question)

        async def make_spoken(q, a):
            self.calls["spoken"] += 1
            return "uz: " + q, "qisqa: " + a[:30]

        async def translate_all(s):
            self.calls["tr"] += 1
            return {k: f"[{k}] {s}" for k in A.LANGS}

        async def embed_question(quz):
            self.calls["emb"] += 1
            return kb.pack_vec(vec(0.9 if "dron" in quz else 0.1))

        A.make_spoken, A.translate_all, A.embed_question = make_spoken, translate_all, embed_question
        self.c = TestClient(app)

    def tearDown(self):
        A.make_spoken, A.translate_all, A.embed_question = self.orig
        self.s.kb_dir, self.s.kb_admin_key = self.old
        kb.reload()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_seed_from_assets(self):
        rows = kb.rows()
        self.assertGreater(len(rows), 1000)
        self.assertEqual(len({r["uid"] for r in rows}), len(rows))  # uid noyob
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "kb.json")))
        r = next(r for r in rows if r.get("s"))
        self.assertEqual(len(r["t"]), 12)
        self.assertTrue(kb.spoken(r, "ru") and kb.spoken(r, "zh"))
        self.assertEqual(kb.spoken(r, "uz"), r["s"])
        self.assertIn(r["t"]["en"], kb.spoken_texts())

    def test_auth(self):
        self.assertEqual(self.c.get("/admin/kb/ping").status_code, 401)
        self.assertEqual(self.c.get("/admin/kb/ping", headers={"X-Admin-Key": "x"}).status_code, 401)
        self.assertEqual(self.c.get("/admin/kb/ping", headers=H).status_code, 200)
        self.s.kb_admin_key = ""
        self.assertEqual(self.c.get("/admin/kb/ping", headers=H).status_code, 503)  # kalit sozlanmagan — panel o'chiq
        self.s.kb_admin_key = KEY
        for _ in range(A.FAIL_MAX):
            self.c.get("/admin/kb/ping", headers={"X-Admin-Key": "bad"})
        self.assertEqual(self.c.get("/admin/kb/ping", headers={"X-Admin-Key": "bad"}).status_code, 429)
        self.assertEqual(self.c.get("/admin/kb/ping", headers=H).status_code, 429)  # bloklangan paytda to'g'ri kalit ham kutadi

    def test_list_search_filter(self):
        j = self.c.get("/admin/kb", headers=H, params={"limit": 20}).json()
        self.assertEqual(len(j["items"]), 20)
        self.assertEqual(j["total"], j["stats"]["total"])
        self.assertNotIn("e", j["items"][0])
        j2 = self.c.get("/admin/kb", headers=H, params={"search": "broker"}).json()  # kirill bazada lotincha qidiruv
        self.assertGreater(j2["total"], 0)
        self.assertLess(j2["total"], j["total"])
        inactive = self.c.get("/admin/kb", headers=H, params={"filter": "inactive"}).json()
        self.assertEqual(inactive["total"], j["stats"]["total"] - j["stats"]["active"])

    def test_crud(self):
        n0 = len(kb.rows())
        # yaratish
        r = self.c.post("/admin/kb", headers=H, json={"q": Q1, "a": "Test javobi: dron olib kirish mumkin emas."})
        self.assertEqual(r.status_code, 201, r.text)
        row = r.json()
        uid = row["uid"]
        self.assertEqual(uid, n0 + 1)
        self.assertEqual((row["s"], row["langs"], row["has_emb"], row["active"], row["manual_s"]), ("qisqa: Test javobi: dron olib kirish ", 12, True, True, False))
        self.assertEqual(self.calls, {"spoken": 1, "tr": 1, "emb": 1})
        self.assertEqual(len(kb.rows()), n0 + 1)
        orig_embed = kb.embed

        async def fake_embed(client, text, document=False):
            return vec(0.9)

        kb.embed = fake_embed
        try:
            # qidiruvda topiladi (embedding ishlaydi)
            hits = asyncio.run(kb.search(None, "dron", 3))
            self.assertEqual(hits[0][1]["uid"], uid)
            self.assertGreater(hits[0][0], 0.99)
            # faqat javob o'zgardi: qisqa javob + tarjima qayta, embedding qayta EMAS
            r = self.c.put(f"/admin/kb/{uid}", headers=H, json={"q": Q1, "a": A2})
            self.assertEqual(r.json()["s"], "qisqa: " + A2)
            self.assertEqual(self.calls, {"spoken": 2, "tr": 2, "emb": 1})
            # hech narsa o'zgarmadi: hech narsa qayta tayyorlanmaydi
            self.c.put(f"/admin/kb/{uid}", headers=H, json={"q": Q1, "a": A2})
            self.assertEqual(self.calls, {"spoken": 2, "tr": 2, "emb": 1})
            # qo'lda yozilgan qisqa javob: LLM chaqirilmaydi, tarjima qayta
            r = self.c.put(f"/admin/kb/{uid}", headers=H, json={"q": Q1, "a": A2, "s": S_MANUAL, "auto_s": False})
            self.assertEqual((r.json()["s"], r.json()["manual_s"], r.json()["t"]["ru"]), (S_MANUAL, True, "[ru] " + S_MANUAL))
            self.assertEqual(self.calls, {"spoken": 2, "tr": 3, "emb": 1})
            # savol o'zgardi: embedding qayta
            body = {"q": "Boshqa dron savoli?", "a": A2, "s": S_MANUAL, "auto_s": False}
            self.c.put(f"/admin/kb/{uid}", headers=H, json=body)
            self.assertEqual(self.calls["emb"], 2)
            # o'chirib qo'yish: qidiruvda chiqmaydi, bazada qoladi
            r = self.c.put(f"/admin/kb/{uid}", headers=H, json={**body, "active": False})
            self.assertFalse(r.json()["active"])
            self.assertNotEqual(asyncio.run(kb.search(None, "dron", 3))[0][1]["uid"], uid)
        finally:
            kb.embed = orig_embed
        # faylga saqlangan: qayta yuklashdan keyin ham bor; zaxira nusxa mavjud
        kb.reload()
        self.assertEqual(kb.get(uid)["s"], S_MANUAL)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "kb.json.bak")))
        self.assertEqual(self.c.get(f"/admin/kb/{uid}", headers=H).json()["a"], A2)
        # eksport: embedding yo'q, yangi qator bor
        ex = json.loads(self.c.get("/admin/kb/export", headers=H).content)
        self.assertEqual(len(ex), n0 + 1)
        self.assertNotIn("e", ex[-1])
        # o'chirish
        self.assertEqual(self.c.delete(f"/admin/kb/{uid}", headers=H).status_code, 200)
        self.assertEqual(self.c.delete(f"/admin/kb/{uid}", headers=H).status_code, 404)
        self.assertEqual(self.c.get(f"/admin/kb/{uid}", headers=H).status_code, 404)
        kb.reload()
        self.assertEqual(len(kb.rows()), n0)
        # yaroqsiz kiritish
        self.assertEqual(self.c.post("/admin/kb", headers=H, json={"q": "a", "a": "b"}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
