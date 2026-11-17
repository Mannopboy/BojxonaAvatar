"""Ovoz mantig'i testi (GEMINI/tarmoq kerak emas):  cd backend && python -m unittest discover -s tests -v

Tekshiradi: salom/savol/shovqin tasnifi, tayyor javoblar yaxlitligi (har video'siz javobning audiosi git'dagi keshda bor va matni aynan shu), server vaqtlari (turn_complete.timing),
ovoz sozlamalari (ikkala ovoz ham ayol — Kore), kesh nomlari barqarorligi.
"""
import asyncio
import json
import os
import sys
import time
import unittest
from unittest import mock

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


class ParseTurn(unittest.TestCase):
    def test_turn_kinds_include_goodbye(self):
        self.assertEqual(T.parse_wake({"kind": "goodbye", "lang": "ru"}, T.TURN_KINDS), ("goodbye", "ru"))
        self.assertEqual(T.parse_wake({"kind": "question", "lang": "en"}, T.TURN_KINDS), ("question", "en"))

    def test_goodbye_is_not_a_wake_kind(self):
        # birinchi gap (WAKE_KINDS): xayrlashish yo'q — bunday qiymat xavfsiz 'other' (e'tiborsiz) ga tushadi
        self.assertEqual(T.parse_wake({"kind": "goodbye", "lang": "uz"}), ("other", "uz"))
        self.assertEqual(T.parse_wake({"kind": "greeting", "lang": "uz"}, T.TURN_KINDS), ("other", "uz"))

    def test_wake_requires_greeting_word(self):
        # kutish rejimi: LLM `greeted: true` demagan bo'lsa — kind nima bo'lishidan qat'i nazar suhbat boshlanmaydi (salomsiz savol ham)
        for kind in ("greeting", "question"):
            self.assertEqual(T.parse_wake({"kind": kind, "lang": "uz", "greeted": True}, require_greeted=True), (kind, "uz"))
            self.assertEqual(T.parse_wake({"kind": kind, "lang": "uz", "greeted": False}, require_greeted=True), ("other", "uz"))
            self.assertEqual(T.parse_wake({"kind": kind, "lang": "uz"}, require_greeted=True), ("other", "uz"))  # maydon yo'q
            self.assertEqual(T.parse_wake({"kind": kind, "lang": "uz", "greeted": "true"}, require_greeted=True), ("other", "uz"))  # mantiqiy emas
        # suhbat o'rtasida (TURN_KINDS) greeted talab qilinmaydi
        self.assertEqual(T.parse_wake({"kind": "goodbye", "lang": "ru"}, T.TURN_KINDS), ("goodbye", "ru"))

    def test_wake_schema_has_greeted_only_for_first_utterance(self):
        import inspect
        src = inspect.getsource(T._llm_classify)
        self.assertIn('"greeted"', src)
        self.assertIn("require_greeted=wake", src)
        self.assertIn("greeted:", T.WAKE_CLASSIFY)
        self.assertNotIn("greeted", T.TURN_CLASSIFY)

    def test_farewell_texts_cover_all_languages(self):
        self.assertEqual(set(T.FAREWELL), set(T.WAKE_LANGS))
        for lang, text in T.FAREWELL.items():
            self.assertTrue(text.strip(), lang)
            self.assertLess(len(text), 80, lang)  # qisqa: yo'lovchi kutib qolmasin


class _FakeWS:
    def __init__(self):
        self.sent: list = []

    async def send_text(self, t: str) -> None:
        self.sent.append(json.loads(t))

    async def send_bytes(self, b: bytes) -> None:
        self.sent.append(("pcm", len(b)))

    def transcripts(self) -> list:
        return [m["text"] for m in self.sent if isinstance(m, dict) and m.get("type") == "transcript"]


class Goodbye(unittest.IsolatedAsyncioTestCase):
    """respond(): xayrlashish — yo'lovchi tilida tayyor xayrlashuv, javob (LLM) yetkazilmaydi, state['end'] (turn_complete.end)."""

    def _patches(self, cls_result, cls_delay, ans_delay):
        async def fake_classify(part, system=None, kinds=None):
            await asyncio.sleep(cls_delay)
            if isinstance(cls_result, Exception):
                raise cls_result
            return cls_result

        async def fake_answer(contents):
            await asyncio.sleep(ans_delay)
            return None, "LLM javobi"

        async def fake_cached(text):
            return b"\x00\x01" * 400

        delivered: list = []

        async def fake_deliver(ws, clip, text, user_part, history, state):
            delivered.append(text)
            state["spoke"] = True
            await ws.send_text(json.dumps({"type": "transcript", "text": text}))

        return delivered, [
            mock.patch.object(T, "_llm_classify", fake_classify),
            mock.patch.object(T, "_llm_answer", fake_answer),
            mock.patch.object(T, "cached_audio", fake_cached),
            mock.patch.object(T, "_deliver", fake_deliver),
        ]

    async def _run(self, cls_result, cls_delay=0.0, ans_delay=0.3):
        delivered, patches = self._patches(cls_result, cls_delay, ans_delay)
        ws, state = _FakeWS(), {}
        part = T.types.Part.from_bytes(data=b"RIFF....", mime_type="audio/wav")
        for p in patches:
            p.start()
        try:
            await T.respond(ws, part, [], state, time.monotonic())
        finally:
            mock.patch.stopall()
        return ws, state, delivered

    async def test_goodbye_first_gives_farewell_in_passenger_language(self):
        ws, state, delivered = await self._run(("goodbye", "ru"))
        self.assertEqual(ws.transcripts(), [T.FAREWELL["ru"]])
        self.assertTrue(state.get("end"))
        self.assertEqual(state.get("voice"), "cache")
        self.assertEqual(delivered, [])  # LLM javobi yetkazilmadi

    async def test_goodbye_when_answer_was_ready_first(self):
        ws, state, delivered = await self._run(("goodbye", "en"), cls_delay=0.1, ans_delay=0.0)
        self.assertEqual(ws.transcripts(), [T.FAREWELL["en"]])
        self.assertTrue(state.get("end"))
        self.assertEqual(delivered, [])

    async def test_unknown_language_falls_back_to_uzbek(self):
        ws, state, _ = await self._run(("goodbye", "zz"))
        self.assertEqual(ws.transcripts(), [T.FAREWELL["uz"]])

    async def test_late_classification_ends_after_answer(self):
        # tasniflash kech (>CLS_GRACE_S) tugasa ham: javob yetkaziladi, lekin suhbat tugaydi
        ws, state, delivered = await self._run(("goodbye", "uz"), cls_delay=0.55, ans_delay=0.0)
        self.assertEqual(delivered, ["LLM javobi"])
        self.assertTrue(state.get("end"))

    async def test_question_does_not_end_conversation(self):
        ws, state, delivered = await self._run(("question", "uz"), cls_delay=0.0, ans_delay=0.1)
        self.assertEqual(delivered, ["LLM javobi"])
        self.assertFalse(state.get("end"))

    async def test_classification_error_does_not_end_conversation(self):
        ws, state, delivered = await self._run(RuntimeError("tarmoq"), cls_delay=0.0, ans_delay=0.1)
        self.assertEqual(delivered, ["LLM javobi"])
        self.assertFalse(state.get("end"))

    async def test_noise_still_triggers_reask_not_end(self):
        ws, state, delivered = await self._run(("other", "uz"), cls_delay=0.0, ans_delay=0.5)
        self.assertEqual(ws.transcripts(), [T.REASK_TEXT])
        self.assertTrue(state.get("reask"))
        self.assertFalse(state.get("end"))


class WakeOnlyGreeting(unittest.IsolatedAsyncioTestCase):
    """respond_first() (kutish rejimi): suhbat FAQAT salomlashganda boshlanadi; brauzerga greeting/started yuboriladi (yurib kelish shundan boshlanadi), aks holda wake_ignored."""

    async def _run(self, kind_lang):
        async def fake_classify(part, system=None, kinds=None):
            return kind_lang

        async def fake_answer(contents):
            return None, "LLM javobi"

        async def fake_cached(text):
            return b"\x00\x01" * 400

        delivered: list = []

        async def fake_deliver(ws, clip, text, user_part, history, state):
            delivered.append(text)
            state["spoke"] = True

        ws, state = _FakeWS(), {}
        part = T.types.Part.from_bytes(data=b"RIFF....", mime_type="audio/wav")
        with mock.patch.object(T, "_llm_classify", fake_classify), mock.patch.object(T, "_llm_answer", fake_answer), \
                mock.patch.object(T, "cached_audio", fake_cached), mock.patch.object(T, "_deliver", fake_deliver):
            started = await T.respond_first(ws, part, [], state, time.monotonic())
        types_sent = [m["type"] for m in ws.sent if isinstance(m, dict)]
        return started, types_sent, delivered, ws

    async def test_noise_or_other_is_ignored(self):
        started, sent, delivered, _ = await self._run(("other", "uz"))
        self.assertFalse(started)
        self.assertEqual(sent, ["wake_ignored"])
        self.assertEqual(delivered, [])

    async def test_uzbek_greeting_sends_greeting_and_ready_audio(self):
        started, sent, delivered, ws = await self._run(("greeting", "uz"))
        self.assertTrue(started)
        self.assertEqual(sent[0], "greeting")
        self.assertNotIn("started", sent)
        self.assertEqual(ws.transcripts(), [get_settings().greeting_text])

    async def test_other_language_greeting_sends_started_before_reply(self):
        started, sent, delivered, _ = await self._run(("greeting", "ru"))
        self.assertTrue(started)
        self.assertEqual(sent, ["started"])
        self.assertEqual(delivered, [T.GREETING_OTHER["ru"]])

    async def test_greeting_plus_question_starts_and_answers(self):
        started, sent, delivered, _ = await self._run(("question", "uz"))
        self.assertTrue(started)
        self.assertEqual(sent, ["started"])
        self.assertEqual(delivered, ["LLM javobi"])

    def test_prompt_demands_greeting(self):
        # qoida promptda: salomsiz savol ham 'other' (e'tiborsiz), shubhada 'other'
        self.assertIn("SALOMLASHGANDA", T.WAKE_CLASSIFY)
        self.assertIn("salomsiz savol", T.WAKE_CLASSIFY)
        self.assertIn("Shubha bo'lsa 'other'", T.WAKE_CLASSIFY)


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
        texts = [a["text"] for a in T.ANSWERS if not a.get("video", True)] + [T.REASK_TEXT, T.FALLBACK_TEXT, T.ERROR_TEXT] + list(T.FAREWELL.values())
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
