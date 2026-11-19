"""Ko'p tilli javoblarni tekshirish (TTS siz — kvota sarflanmaydi): har til uchun tayyor javob, bilim bazasi va «rahmat» yo'li, vaqt bilan.
Ishlatish: cd backend && python scripts/test_langs.py"""
import asyncio, os, sys, time, io
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from google.genai import types
from app import tts_voice as t, kb

Q = {
 "uz": ["Deklaratsiyasiz qancha naqd pul olib kirsa bo'ladi?", "O'zbekistonga dron olib kirsa bo'ladimi?", "Rahmat"],
 "ru": ["Сколько валюты можно ввезти без декларации?", "Можно ли ввозить дрон в Узбекистан?", "Спасибо"],
 "en": ["How much cash can I bring into Uzbekistan without declaring?", "Can I bring a drone into Uzbekistan?", "Thank you"],
 "zh": ["我可以带多少现金入境乌兹别克斯坦而不用申报？", "我可以带无人机进入乌兹别克斯坦吗？", "谢谢"],
 "kk": ["Өзбекстанға декларациясыз қанша қолма-қол ақша әкелуге болады?", "Өзбекстанға дрон алып кіруге бола ма?", "Рақмет сізге"],
 "ky": ["Өзбекстанга декларациясыз канча накталай акча алып кирүүгө болот?", "Өзбекстанга дрон алып кирүүгө болобу?", "Чоң рахмат сизге"],
 "ko": ["우즈베키스탄에 신고 없이 현금을 얼마나 반입할 수 있나요?", "우즈베키스탄에 드론을 가지고 들어갈 수 있나요?", "감사합니다"],
 "fr": ["Combien d'argent liquide puis-je apporter sans déclaration ?", "Puis-je apporter un drone en Ouzbékistan ?", "Merci beaucoup"],
 "tg": ["Бе декларатсия чӣ қадар пули нақд ворид кардан мумкин аст?", "Оё ба Ӯзбекистон дрон овардан мумкин аст?", "Ташаккури зиёд"],
 "ar": ["كم من المال النقدي يمكنني إحضاره دون إقرار جمركي؟", "هل يمكنني إدخال طائرة بدون طيار إلى أوزبكستان؟", "شكرا جزيلا"],
 "tr": ["Beyan etmeden ne kadar nakit getirebilirim?", "Özbekistan'a dron getirebilir miyim?", "Teşekkür ederim"],
 "tk": ["Deklarasiýasyz näçe nagt pul getirip bilerin?", "Özbegistana dron getirip bolýarmy?", "Sag boluň"],
 "az": ["Bəyannamə vermədən nə qədər nağd pul gətirə bilərəm?", "Özbəkistana dron gətirmək olarmı?", "Çox sağ olun"],
}


async def one(lang: str, q: str):
    async def ok(_l): return True
    c = [types.Content(role="user", parts=[types.Part(text=q)])]
    t0 = time.time()
    clip, got, quz = await t._route(c)
    t1 = time.time()
    clip2, text = await t._llm_answer(c, ok, None)
    t2 = time.time()
    ready = text in t.ANSWER_I18N_TEXTS or text in kb.spoken_texts() or clip2 is not None
    return lang, got, clip, round(t2 - t1, 1), "TAYYOR" if ready else "LLM", quz[:45], text[:110]


async def main():
    langs = [a for a in sys.argv[1:]] or list(Q)
    kinds = ["pul ", "dron", "rahm"]
    for lang in langs:
        res = await asyncio.gather(*[one(lang, q) for q in Q[lang]])
        for k, r in zip(kinds, res):
            flag = "" if r[1] == lang else "  <-- TIL XATO"
            print(f"{lang} {k} til={r[1]} clip={r[2]} {r[3]}s {r[4]} | q={r[5]} | {r[6]}{flag}")
        print()

asyncio.run(main())
