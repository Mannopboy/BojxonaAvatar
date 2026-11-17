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
import types

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

        async def fake_answer(contents, on_search=None):
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

        async def fake_answer(contents, on_search=None):
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
        # salomdan DARHOL keyin: «Sizga qanday yordam bera olaman?» (tayyor audio)
        self.assertEqual(ws.transcripts(), [get_settings().greeting_text, T.HELP_PROMPT_UZ])

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


class WebSearchAnswer(unittest.IsolatedAsyncioTestCase):
    """_llm_answer(): tayyor javobga mos kelmagan savol INTERNETDAN qidiriladi (to'qimaydi); topilmasa halol «topa olmadim»."""

    def _fake_client(self, text, domains, raise_exc=None):
        chunks = [types.SimpleNamespace(web=types.SimpleNamespace(title=d, uri="https://x/" + d)) for d in domains]
        resp = types.SimpleNamespace(text=text, candidates=[types.SimpleNamespace(grounding_metadata=types.SimpleNamespace(grounding_chunks=chunks))])

        async def generate_content(**kw):
            if raise_exc:
                raise raise_exc
            self.last_kw = kw
            return resp

        return types.SimpleNamespace(aio=types.SimpleNamespace(models=types.SimpleNamespace(generate_content=generate_content)))

    async def test_ready_clip_skips_search(self):
        called: list = []

        async def route(c):
            return "airport", "uz"

        async def search(c, lang="uz"):
            called.append(1)
            return "x"

        with mock.patch.object(T, "_route", route), mock.patch.object(T, "_search_answer", search):
            clip, text = await T._llm_answer([])
        self.assertEqual(clip, "airport")
        self.assertEqual(text, T.ANSWER_BY_ID["airport"]["text"])
        self.assertEqual(called, [])

    async def test_chat_question_gets_direct_answer_without_search_or_filler(self):
        """«Qanday yordam bera olasiz?» kabi gap: internetdan qidirilmaydi, «aniqlashtirib beraman» deyilmaydi, «xodimga murojaat qiling» ham emas."""
        called: list = []

        async def route(c):
            return T.CHAT, "ru"

        async def search(c, lang="uz"):
            called.append("search")
            return "x"

        async def on_search(lang):
            called.append("filler")
            return True

        async def chat(c, lang="uz"):
            called.append("chat")
            return "Я отвечаю на вопросы о таможенных правилах."

        with mock.patch.object(T, "_route", route), mock.patch.object(T, "_search_answer", search), mock.patch.object(T, "_chat_answer", chat):
            self.assertEqual(await T._llm_answer([], on_search), (None, "Я отвечаю на вопросы о таможенных правилах."))
        self.assertEqual(called, ["chat"])

    async def test_chat_answer_uses_chat_prompt_without_search_tool_and_falls_back(self):
        with mock.patch.object(T, "_gc", lambda: self._fake_client("**Men** bojxona savollariga javob beraman. Savolingizni bering.", [])):
            self.assertEqual(await T._chat_answer([]), "Men bojxona savollariga javob beraman. Savolingizni bering.")
        cfg = self.last_kw["config"]
        self.assertTrue(cfg.system_instruction.startswith(T.CHAT_SYSTEM) and "FAQAT o'zbek tilida" in cfg.system_instruction)
        self.assertFalse(cfg.tools)  # qidiruv vositasi ulanmagan
        with mock.patch.object(T, "_gc", lambda: self._fake_client("", [])):
            self.assertEqual(await T._chat_answer([]), T.ANSWER_BY_ID["capabilities"]["text"])
        with mock.patch.object(T, "_gc", lambda: self._fake_client("x", [], raise_exc=RuntimeError("tarmoq"))):
            self.assertEqual(await T._chat_answer([]), T.ANSWER_BY_ID["capabilities"]["text"])  # xatoda ham yo'lovchi foydali javob oladi

    async def test_route_parses_chat_and_ignores_unknown_ids(self):
        for model_clip, expected in (("chat", T.CHAT), ("airport", "airport"), ("capabilities", "capabilities"), ("nomalum", None), ("none", None)):
            with mock.patch.object(T, "_gc", lambda c=model_clip: self._fake_client(json.dumps({"clip": c, "lang": "uz"}), [])):
                self.assertEqual(await T._route([]), (expected, "uz"), model_clip)

    async def test_ready_answers_are_not_used_for_russian_or_english_passengers(self):
        """Tayyor javoblar o'zbekcha: ruscha/inglizcha yo'lovchiga o'zbekcha javob aytilmaydi."""
        for lang in ("ru", "en"):
            for model_clip, expected in (("capabilities", T.CHAT), ("chat", T.CHAT), ("airport", None), ("car", None), ("none", None)):
                with mock.patch.object(T, "_gc", lambda c=model_clip, l=lang: self._fake_client(json.dumps({"clip": c, "lang": l}), [])):
                    self.assertEqual(await T._route([]), (expected, lang), (lang, model_clip))

    def test_route_and_chat_prompts_describe_the_capability_question(self):
        ri = T._route_instruction()
        self.assertIn("chat", ri)
        self.assertIn("capabilities", ri)
        self.assertIn("qanday yordam bera olasiz", ri)
        for banned in ("aniqlashtirib beraman", "xodimga murojaat qiling"):
            self.assertIn(banned, T.CHAT_SYSTEM.lower())  # ... DEMA deb taqiqlangan
        self.assertIn("DEMA", T.CHAT_SYSTEM)
        self.assertIn("capabilities", T.ANSWER_BY_ID)
        self.assertNotIn("capabilities", T.READY_CLIPS)  # videosiz, faqat oldindan ovozlangan audio

    async def test_answer_language_is_stated_explicitly_to_the_model(self):
        """Ruscha savolga o'zbekcha javob berilib qolmasin (prompt o'zbekcha — model tilni o'zi adashtirardi)."""
        self.assertIn("FAQAT rus tilida", T._lang_directive("ru"))
        self.assertIn("FAQAT ingliz tilida", T._lang_directive("en"))
        self.assertIn("FAQAT o'zbek tilida", T._lang_directive("xx"))
        with mock.patch.object(T, "_gc", lambda: self._fake_client("Ответ.", ["customs.uz"])):
            await T._search_answer([], "ru")
        self.assertIn("FAQAT rus tilida", self.last_kw["config"].system_instruction)
        for lang, name in (("ru", "Russian"), ("en", "English")):
            with mock.patch.object(T, "_gc", lambda: self._fake_client("Ответ.", [])):
                await T._chat_answer([], lang)
            si = self.last_kw["config"].system_instruction
            self.assertIn("Reply ONLY in " + name, si)  # chet tili yo'lovchisiga inglizcha prompt (o'zbekcha prompt o'zbekcha javobga undardi)
            self.assertNotIn("TASDIQLANGAN FAKTLAR", si)

    async def test_open_question_is_searched_and_filler_callback_runs(self):
        langs: list = []

        async def route(c):
            return None, "ru"

        async def search(c, lang="uz"):
            return "Найденный ответ."

        async def on_search(lang):
            langs.append(lang)
            return True

        with mock.patch.object(T, "_route", route), mock.patch.object(T, "_search_answer", search):
            clip, text = await T._llm_answer([], on_search)
        self.assertEqual((clip, text), (None, "Найденный ответ."))
        self.assertEqual(langs, ["ru"])

    async def test_not_found_gives_honest_message_in_passenger_language(self):
        async def route(c):
            return None, "en"

        async def search(c, lang="uz"):
            return None

        with mock.patch.object(T, "_route", route), mock.patch.object(T, "_search_answer", search):
            clip, text = await T._llm_answer([])
        self.assertEqual((clip, text), (None, T.NOT_FOUND["en"]))

    async def test_search_error_never_invents_an_answer(self):
        async def route(c):
            return None, "uz"

        async def search(c, lang="uz"):
            raise RuntimeError("tarmoq")

        with mock.patch.object(T, "_route", route), mock.patch.object(T, "_search_answer", search):
            clip, text = await T._llm_answer([])
        self.assertEqual((clip, text), (None, T.NOT_FOUND["uz"]))

    async def test_on_search_false_skips_search(self):
        called: list = []

        async def route(c):
            return None, "uz"

        async def search(c, lang="uz"):
            called.append(1)
            return "x"

        async def on_search(lang):
            return False

        with mock.patch.object(T, "_route", route), mock.patch.object(T, "_search_answer", search):
            clip, text = await T._llm_answer([], on_search)
        self.assertEqual((clip, text), (None, ""))
        self.assertEqual(called, [])

    async def test_switch_off_uses_plain_answer(self):
        async def plain(c):
            return None, "oddiy javob"

        off = types.SimpleNamespace(voice_web_search=False, grounding_enabled=True)
        with mock.patch.object(T, "settings", off), mock.patch.object(T, "_llm_answer_plain", plain):
            self.assertEqual(await T._llm_answer([]), (None, "oddiy javob"))

    async def test_search_answer_requires_grounding_sources(self):
        with mock.patch.object(T, "_gc", lambda: self._fake_client("Aniq javob.", ["customs.uz", "lex.uz"])):
            self.assertEqual(await T._search_answer([]), "Aniq javob.")
        tools = self.last_kw["config"].tools
        self.assertTrue(tools and tools[0].google_search is not None)  # Google Search grounding yoqilgan
        with mock.patch.object(T, "_gc", lambda: self._fake_client("Manbasiz javob.", [])):
            self.assertIsNone(await T._search_answer([]))  # manba yo'q — o'ylab topilgan bo'lishi mumkin: aytilmaydi
        with mock.patch.object(T, "_gc", lambda: self._fake_client("NOT_FOUND", ["customs.uz"])):
            self.assertIsNone(await T._search_answer([]))
        with mock.patch.object(T, "_gc", lambda: self._fake_client("", ["customs.uz"])):
            self.assertIsNone(await T._search_answer([]))

    async def test_non_official_source_gets_verify_hint_in_passenger_language(self):
        with mock.patch.object(T, "_gc", lambda: self._fake_client("Gazeta javobi.", ["gazeta.uz", "bank.uz"])):
            self.assertEqual(await T._search_answer([]), "Gazeta javobi. " + T.VERIFY_HINT["uz"])
            self.assertEqual(await T._search_answer([], "ru"), "Gazeta javobi. " + T.VERIFY_HINT["ru"])
            self.assertEqual(await T._search_answer([], "en"), "Gazeta javobi. " + T.VERIFY_HINT["en"])
        with mock.patch.object(T, "_gc", lambda: self._fake_client("Aralash.", ["gazeta.uz", "www.customs.uz"])):
            self.assertEqual(await T._search_answer([]), "Aralash.")  # kamida bitta rasmiy manba bo'lsa — maslahatsiz

    async def test_official_only_switch_rejects_non_official_sources(self):
        with mock.patch.object(T.settings, "voice_search_official_only", True):
            with mock.patch.object(T, "_gc", lambda: self._fake_client("Gazeta javobi.", ["gazeta.uz"])):
                self.assertIsNone(await T._search_answer([]))  # qat'iy rejim: norasmiy manba aytilmaydi
            with mock.patch.object(T, "_gc", lambda: self._fake_client("Rasmiy javob.", ["customs.uz"])):
                self.assertEqual(await T._search_answer([]), "Rasmiy javob.")

    def test_is_official(self):
        for ok in ("customs.uz", "www.customs.uz", "lex.uz", "my.gov.uz", "xx.gov.uz", "CUSTOMS.UZ"):
            self.assertTrue(T._is_official(ok), ok)
        for bad in ("", "bank.uz", "gazeta.uz", "evilcustoms.uz", "customs.uz.evil.com", "gov.uz.fake.org"):
            self.assertFalse(T._is_official(bad), bad)

    def test_shorten_keeps_voice_answer_short(self):
        self.assertEqual(T._shorten("Bir. Ikki. Uch. To'rt. Besh."), "Bir. Ikki.")
        long_sentence = "Uzun gap " * 60 + "tugadi."
        self.assertEqual(T._shorten("Qisqa. " + long_sentence), "Qisqa.")  # ikkinchi gap 170 belgidan oshadi
        self.assertEqual(T._shorten("Faqat bitta gap"), "Faqat bitta gap")
        self.assertLessEqual(len(T._shorten(long_sentence)), 260)  # bitta juda uzun gap bo'lsa ham kesiladi

    def test_shorten_never_cuts_a_normal_first_sentence_mid_way(self):
        """Birinchi gap (~215 belgi) butun qoladi — ma'no buzilmasin; qo'shimcha gap tashlanadi."""
        first = "Chet eldan olib kirilgan yangi mobil telefon uchun bojxona to'lovi, agar uning qiymati belgilangan bojsiz olib kirish me'yorlaridan oshsa yoki yo'lovchi bojxona deklaratsiyasida ko'rsatilmagan bo'lsa, undiriladi."
        self.assertTrue(170 < len(first) <= 260)
        self.assertEqual(T._shorten(first + " Ikkinchi gap."), first)

    def test_shorten_cuts_overlong_sentence_at_a_clause_boundary(self):
        clause = "birinchi shart bajarilgan bo'lsa"
        sentence = ", ".join([clause] * 12) + " ruxsat beriladi."  # ~400 belgi, bitta gap
        res = T._shorten(sentence)
        self.assertLessEqual(len(res), 260)
        self.assertTrue(res.endswith(clause + "."), res[-40:])  # vergul chegarasida, so'z o'rtasida emas

    def test_leading_greeting_is_stripped_from_search_answer(self):
        self.assertEqual(T._strip_greeting("Assalomu alaykum. Telefon uchun bojxona to'lovi bor."), "Telefon uchun bojxona to'lovi bor.")
        self.assertEqual(T._strip_greeting("Assalomu alaykum, hurmatli yo'lovchi! To'lov bor."), "To'lov bor.")
        self.assertEqual(T._strip_greeting("Здравствуйте! Пошлина есть."), "Пошлина есть.")
        self.assertEqual(T._strip_greeting("Hello! A fee applies."), "A fee applies.")
        self.assertEqual(T._strip_greeting("To'lov bor. Assalomu alaykum."), "To'lov bor. Assalomu alaykum.")  # faqat BOSHIDAGI salom
        self.assertEqual(T._strip_greeting("Salomatlik uchun dori olib kirish mumkin."), "Salomatlik uchun dori olib kirish mumkin.")  # «salom» so'zi boshqa so'zning boshi
        self.assertEqual(T._strip_greeting("Assalomu alaykum."), "Assalomu alaykum.")  # faqat salom bo'lsa — bo'sh javob chiqmasin

    async def test_search_answer_does_not_repeat_the_greeting(self):
        with mock.patch.object(T, "_gc", lambda: self._fake_client("Assalomu alaykum. Aniq javob.", ["customs.uz"])):
            self.assertEqual(await T._search_answer([]), "Aniq javob.")
        with mock.patch.object(T, "_gc", lambda: self._fake_client("Assalomu alaykum. Gazeta javobi.", ["gazeta.uz"])):
            self.assertEqual(await T._search_answer([]), "Gazeta javobi. " + T.VERIFY_HINT["uz"])

    def test_search_prompt_forbids_inventing_and_naming_sources(self):
        self.assertIn("O'YLAB TOPMA", T.SEARCH_SYSTEM)
        self.assertIn("NOT_FOUND", T.SEARCH_SYSTEM)
        self.assertIn("Manba nomini aytma", T.SEARCH_SYSTEM)
        self.assertIn("customs.uz", T.SEARCH_SYSTEM)

    async def test_not_found_is_delivered_from_cached_audio_without_tts(self):
        async def fake_cached(text):
            return b"\x00\x01" * 400

        async def boom(*a, **k):
            raise AssertionError("TTS chaqirilmasligi kerak")
            yield b""  # pragma: no cover

        ws, state, history = _FakeWS(), {"spoke": False}, []
        part = T.types.Part(text="savol")
        with mock.patch.object(T, "cached_audio", fake_cached), mock.patch.object(T, "synth_stream", boom):
            await T._deliver(ws, None, T.NOT_FOUND["ru"], part, history, state)
        self.assertEqual(ws.transcripts(), [T.NOT_FOUND["ru"]])
        self.assertTrue(state["spoke"])
        self.assertEqual(state["voice"], "cache")


class SearchFillerFlow(unittest.IsolatedAsyncioTestCase):
    """respond(): qidirish paytida to'ldiruvchi gap (faqat savol bo'lsa); xayrlashuv/shovqinda qidirilmaydi."""

    async def _run(self, cls_result, route=(None, "uz")):
        async def fake_classify(part, system=None, kinds=None):
            return cls_result

        async def fake_route(c):
            return route

        async def fake_search(c, lang="uz"):
            await asyncio.sleep(0.05)
            return "Topilgan javob."

        async def fake_cached(text):
            return b"\x00\x01" * 400

        delivered: list = []

        async def fake_deliver(ws, clip, text, user_part, history, state):
            delivered.append(text)
            state["spoke"] = True
            await ws.send_text(json.dumps({"type": "transcript", "text": text}))

        ws, state = _FakeWS(), {}
        part = T.types.Part.from_bytes(data=b"RIFF....", mime_type="audio/wav")
        with mock.patch.object(T, "_llm_classify", fake_classify), mock.patch.object(T, "_route", fake_route), mock.patch.object(T, "_search_answer", fake_search), \
                mock.patch.object(T, "cached_audio", fake_cached), mock.patch.object(T, "_deliver", fake_deliver):
            await T.respond(ws, part, [], state, time.monotonic())
        return ws, state, delivered

    async def test_question_gets_filler_then_searched_answer(self):
        ws, state, delivered = await self._run(("question", "uz"))
        self.assertEqual(ws.transcripts()[0], T.SEARCH_FILLER["uz"])  # avval to'ldiruvchi
        self.assertEqual(delivered, ["Topilgan javob."])
        self.assertTrue(state.get("filler"))
        self.assertFalse(state.get("end"))

    async def test_filler_uses_passenger_language(self):
        ws, state, delivered = await self._run(("question", "ru"))
        self.assertEqual(ws.transcripts()[0], T.SEARCH_FILLER["ru"])

    async def test_goodbye_does_not_search(self):
        ws, state, delivered = await self._run(("goodbye", "uz"))
        self.assertEqual(ws.transcripts(), [T.FAREWELL["uz"]])
        self.assertEqual(delivered, [])
        self.assertFalse(state.get("filler"))

    async def test_noise_does_not_search_or_fill(self):
        ws, state, delivered = await self._run(("other", "uz"))
        self.assertEqual(ws.transcripts(), [T.REASK_TEXT])
        self.assertFalse(state.get("filler"))

    async def test_ready_clip_question_has_no_filler(self):
        ws, state, delivered = await self._run(("question", "uz"), route=("airport", "uz"))
        self.assertFalse(state.get("filler"))
        self.assertEqual(delivered, [T.ANSWER_BY_ID["airport"]["text"]])

    async def test_wake_question_filler_comes_after_started(self):
        async def fake_classify(part, system=None, kinds=None):
            return ("question", "uz")

        async def fake_route(c):
            return None, "uz"

        async def fake_search(c, lang="uz"):
            return "Topilgan javob."

        async def fake_cached(text):
            return b"\x00\x01" * 400

        async def fake_deliver(ws, clip, text, user_part, history, state):
            await ws.send_text(json.dumps({"type": "transcript", "text": text}))
            state["spoke"] = True

        ws, state = _FakeWS(), {}
        part = T.types.Part.from_bytes(data=b"RIFF....", mime_type="audio/wav")
        with mock.patch.object(T, "_llm_classify", fake_classify), mock.patch.object(T, "_route", fake_route), mock.patch.object(T, "_search_answer", fake_search), \
                mock.patch.object(T, "cached_audio", fake_cached), mock.patch.object(T, "_deliver", fake_deliver):
            started = await T.respond_first(ws, part, [], state, time.monotonic())
        self.assertTrue(started)
        order = [m["type"] if isinstance(m, dict) else "pcm" for m in ws.sent]
        self.assertEqual(order[0], "started")  # avval started (brauzer yurib kelish to'sig'ini qo'yadi), keyin to'ldiruvchi audio
        self.assertEqual(ws.transcripts(), [T.SEARCH_FILLER["uz"], "Topilgan javob."])

    async def test_wake_greeting_alone_does_not_search(self):
        called: list = []

        async def fake_classify(part, system=None, kinds=None):
            return ("greeting", "uz")

        async def fake_route(c):
            called.append("route")
            return None, "uz"

        async def fake_search(c, lang="uz"):
            called.append("search")
            return "x"

        async def fake_cached(text):
            return b"\x00\x01" * 400

        ws, state = _FakeWS(), {}
        part = T.types.Part.from_bytes(data=b"RIFF....", mime_type="audio/wav")
        with mock.patch.object(T, "_llm_classify", fake_classify), mock.patch.object(T, "_route", fake_route), mock.patch.object(T, "_search_answer", fake_search), \
                mock.patch.object(T, "cached_audio", fake_cached):
            await T.respond_first(ws, part, [], state, time.monotonic())
        self.assertNotIn("search", called)  # faqat salom: internetdan qidirilmaydi (kvota/xarajat tejaladi)
        self.assertEqual(ws.transcripts(), [get_settings().greeting_text, T.HELP_PROMPT_UZ])


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
        texts = [a["text"] for a in T.ANSWERS if not a.get("video", True)] + [T.REASK_TEXT, T.FALLBACK_TEXT, T.ERROR_TEXT] + list(T.FAREWELL.values()) \
            + [T.HELP_PROMPT_UZ] + list(T.SEARCH_FILLER.values()) + list(T.NOT_FOUND.values())
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
