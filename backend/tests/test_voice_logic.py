"""Ovoz mantig'i testi (GEMINI/tarmoq kerak emas):  cd backend && python -m unittest discover -s tests -v

Tekshiradi: salom/savol/shovqin tasnifi, tayyor javoblar yaxlitligi (har video'siz javobning audiosi git'dagi keshda bor va matni aynan shu), server vaqtlari (turn_complete.timing),
ovoz sozlamalari (ikkala ovoz ham ayol — Kore), kesh nomlari barqarorligi.
"""
import json
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("GEMINI_API_KEY", "test")

from app import tts_voice as T  # noqa: E402
from app.config import get_settings  # noqa: E402


class ParseWake(unittest.TestCase):
    def test_kinds_and_languages(self):
        self.assertEqual(T.parse_wake({"kind": "greeting", "lang": "ru"}), ("greeting", "ru"))
        self.assertEqual(T.parse_wake({"kind": "question", "lang": "uz"}), ("question", "uz"))
        self.assertEqual(T.parse_wake({"kind": "other", "lang": "en"}), ("other", "en"))

    def test_unknown_or_broken_is_ignored_safely(self):
        for bad in [None, {}, [], "x", {"kind": "???", "lang": "zz"}, {"kind": 5}]:
            self.assertEqual(T.parse_wake(bad), ("other", "uz"))


class ReadyAnswers(unittest.TestCase):
    def test_ids_unique_and_have_text_and_when(self):
        ids = [a["id"] for a in T.ANSWERS]
        self.assertEqual(len(ids), len(set(ids)))
        for a in T.ANSWERS:
            self.assertTrue(a["text"].strip() and a["when"].strip(), a["id"])

    def test_only_video_answers_are_listed_for_browser_prefetch(self):
        self.assertEqual(T.READY_CLIPS, [a["id"] for a in T.ANSWERS if a.get("video", True)])
        self.assertIn("airport", T.READY_CLIPS)
        self.assertIn("rail", T.READY_CLIPS)
        for audio_only in ("limits", "car", "post_courier", "currency"):
            self.assertIn(audio_only, T.ANSWER_BY_ID)
            self.assertNotIn(audio_only, T.READY_CLIPS)  # /avatar/answers/<id>.mp4 yo'q — oldindan yuklanmasin

    def test_video_answers_have_clip_files(self):
        root = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend", "public", "avatar", "answers")
        for cid in T.READY_CLIPS:
            self.assertTrue(os.path.exists(os.path.join(root, cid + ".mp4")), cid)

    def test_audio_only_answers_and_fixed_phrases_have_committed_audio(self):
        """Tayyor audio git'da turadi: ovoz kvotasi tugagan bo'lsa ham tayyor javoblar va qayta so'rash ishlaydi (zaxira ovozga tushmaydi)."""
        index = json.load(open(os.path.join(T.AUDIO_CACHE_DIR, "index.json"), encoding="utf-8"))
        texts = [a["text"] for a in T.ANSWERS if not a.get("video", True)] + [T.REASK_TEXT, T.FALLBACK_TEXT, T.ERROR_TEXT]
        for t in texts:
            name = T._cache_name(t)
            path = os.path.join(T.AUDIO_CACHE_DIR, name)
            self.assertTrue(os.path.exists(path), "audio yo'q: " + t[:50])
            self.assertEqual(index.get(name), t, "index matni mos emas (matn o'zgargan bo'lsa: python -m app.gen_audio_cache --force)")
            n = os.path.getsize(path)
            self.assertTrue(n % 2 == 0 and 24000 < n < 24000 * 2 * 40, f"PCM hajmi g'alati: {n}")  # 0.5–40 s, PCM16 24 kHz

    def test_cache_name_is_stable_and_trimmed(self):
        self.assertEqual(T._cache_name("Salom."), T._cache_name("  Salom.  "))
        self.assertNotEqual(T._cache_name("Salom."), T._cache_name("Salom!"))
        self.assertTrue(T._cache_name("x").endswith(".pcm") and len(T._cache_name("x")) == 20)

    def test_ready_answer_texts_match_confirmed_facts(self):
        """Matnlar TTS_SYSTEM dagi TASDIQLANGAN FAKTLAR bilan mos (raqamlar so'z bilan)."""
        t = {a["id"]: a["text"] for a in T.ANSWERS}
        self.assertIn("bir ming", t["airport"])
        self.assertIn("besh yuz", t["rail"])
        self.assertIn("uch yuz", t["car"])
        self.assertTrue("bir ming" in t["limits"] and "besh yuz" in t["limits"] and "uch yuz" in t["limits"])
        self.assertTrue("yuz dollar" in t["post_courier"] and "ikki yuz dollar" in t["post_courier"])
        self.assertTrue("yuz million so'm" in t["currency"])
        for text in t.values():
            self.assertFalse(any(ch.isdigit() for ch in text), "raqam so'z bilan yozilishi kerak: " + text[:40])


class Timing(unittest.TestCase):
    def test_finish_timing_fields(self):
        t_end = time.monotonic() - 2.0
        state = {"understand_ms": 900, "answer_ms": 1500, "tts_first_ms": 300, "voice": "tts", "t_first": t_end + 1.8, "spoke": True, "delivering": True}
        t = T._finish_timing(state, t_end)
        self.assertEqual({k: t[k] for k in ("understand_ms", "answer_ms", "tts_first_ms", "voice")}, {"understand_ms": 900, "answer_ms": 1500, "tts_first_ms": 300, "voice": "tts"})
        self.assertAlmostEqual(t["first_ms"], 1800, delta=5)
        self.assertNotIn("spoke", t)  # ichki maydonlar chiqmaydi

    def test_finish_timing_skips_unknown(self):
        self.assertEqual(T._finish_timing({}, time.monotonic()), {})
        self.assertEqual(T._finish_timing({"voice": "clip", "clip": "airport"}, time.monotonic()), {"voice": "clip", "clip": "airport"})


class Voices(unittest.TestCase):
    def test_both_voices_default_to_female_kore(self):
        s = get_settings()
        self.assertEqual(s.gemini_tts_voice, "Kore")
        self.assertEqual(s.gemini_live_fallback_voice, "Kore")

    def test_reask_is_short(self):
        self.assertLess(len(T.REASK_TEXT), 60)
        self.assertIn("takrorlang", T.REASK_TEXT)


if __name__ == "__main__":
    unittest.main()
