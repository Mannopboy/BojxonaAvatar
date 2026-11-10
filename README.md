# BojxonaAvatar — Virtual bojxona xodimi (3D avatar)

«Qabulxona» avatariga o'xshash tizim: bojxona zaliga **galogramma 3D odam** qo'yiladi,
Gemini API orqali **gapiradi** va yo'lovchilarga **bojxona hodimi sifatida** javob beradi.

- **3 asosiy savol** (docx bilim bazasi) — kafolatlangan, aniq javoblar.
- **Qo'shimcha savol** → Gemini + Google Search **grounding**, faqat rasmiy saytlardan
  (customs.uz, lex.uz, gov.uz) — 🔴 **xotiradan emas, har doim oxirgi ma'lumot**.

> To'liq hujjat (ADR, API, DB): Obsidian vault `Projects-FinTech/01_Projects/BojxonaAvatar/`.

## Arxitektura

```
Frontend (React)                     Backend (FastAPI)
  Avatar videolari (salom/gapirish)    /faq            → 3 savol (DB)
  Suhbat UI + mikrofon      │          /avatar/ask     → klassifikatsiya:
        │  POST /avatar/ask │             faq → DB javob
        └───────────────────┼──────────►  web → grounding
                            ▼              redirect → xodimga
                     Gemini 2.5 Flash + Google Search (rasmiy manba allowlist)
```

## Ishga tushirish

### 1. Backend (port 8000)
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate           # Windows;  Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env           # GEMINI_API_KEY ni to'ldiring (web-grounding uchun)
python -m app.seed               # 3 FAQ seed
uvicorn app.main:app --reload
```
- `GEMINI_API_KEY` bo'lmasa ham **3 asosiy savol ishlaydi** (DB'dan). Web-grounding uchun kalit kerak.
- Swagger: http://localhost:8000/docs

### 2. Frontend (port 5173)
```bash
cd frontend
npm install
npm run dev            # http://localhost:5173  (/api → backend proxy)
```
- Backend boshqa portda bo'lsa (masalan 8000 band): `frontend/.env.local` (git'ga kirmaydi) ga `BACKEND_ORIGIN=http://127.0.0.1:8010` yozing.
- Windows'da Vite `localhost` (IPv6) da ishlaydi — terminalda chiqqan `localhost:…` manzilini oching (`127.0.0.1` emas).

## Avatar (video)

Sayt 3D modelni **yuklamaydi**. Avatar — haqiqiy xodim (rasmidan foydalanishga yozma rozilik saqlansin), u **xom AI videolar**dan iborat
(`frontend/public/avatar/`, jami ~6 MB; 720×1280 tik, to'liq bo'y, old tomondan). Videolar Higgsfield (Seedance 2.0) da **qora fonli uy kadridan** yaratilgan
(`start_image = end_image`: har klip aynan shu pozada boshlanadi va tugaydi). Bosh/tana uchun qo'shimcha harakat, qatlam, yuz ifodasini yumshatish **yo'q**
(foydalanuvchi «ortiqcha, sun'iy» deb topgan edi) — faqat joylashuv, yorqinlik/tiniqlik tenglash va uzun jim oraliqlarni qisqartirish (quyida).

| Video | Nima | Qachon |
|-------|------|--------|
| `idle.mp4` (~5 s) | tinglayotgan avatar, og'iz yopiq, bitta pirpirash; takrorlanadi | ovoz yo'q: tinglayotganda, javob tugagach |
| `speaking-01..NN.mp4` (6–8 s) | gapirish **variantlari** (turli lab harakati); har klip uy pozasida boshlanib tugaydi | **ovoz eshitilayotganda**: tasodifiy variant, tugayotganda keyingisi (oldingisidan boshqa) ulanadi |
| `greeting.mp4` (8 s) | qo'li bilan salom, bir marta: qo'l ~0.75 s da boshga yetadi (lablar yopiq), og'iz ~1.5 s da ochiladi | birinchi salom audiosi kelishi bilan; **ovoz qo'l boshga yetgach chalinadi** (ovoz kelmasa 15 s dan keyin) |

### Ovoz (backend)
Ayol ovozi (`GEMINI_VOICE=Kore`). `VOICE_ENGINE` (`backend/app/config.py`):
- **`tts`** (standart): mikrofon → **Gemini matn modeli** (`GEMINI_CHAT_MODEL`, bo'sh bo'lsa `GEMINI_TEXT_MODEL`=`gemini-2.5-flash`; ovozli savolni to'g'ridan-to'g'ri
  tushunadi, matn javob beradi, oxirgi 4 savol-javob eslab qolinadi) → **Gemini TTS `gemini-3.8-flash-tts`** (oqimli) → brauzer. Kod: `backend/app/tts_voice.py`.
  Foydalanuvchi Live va TTS namunalarini eshitib TTS ni tanladi: Live modelida o'zbekcha so'zlar noto'g'ri talaffuz qilinardi.
  Protokol `/ws/live` bilan bir xil (`ready`, PCM16 24 kHz binar audio, `transcript`, `turn_complete`) — frontend o'zgarmaydi.
  **Ovoz barqarorligi:** har javob BITTA TTS chaqiruvida ovozlanadi (`temperature=0.2`, `seed=7`: `GEMINI_TTS_TEMPERATURE`, `GEMINI_TTS_SEED`). Standart haroratda (1.0) bir xil matn har
  chaqiruvda turlicha o'qildi (o'lchangan: davomiylik ±0.65 s / 7 s, balandlik ±30%) — suhbat o'rtasida ovoz «qalinlashib/o'zgarib» qolgandek eshitilardi; endi davomiylik ±0.05 s,
  balandlik ±5%. Kvota (429) bo'lsa 1.5 s kutib 3 martagacha qayta uriniladi.
  ⚠️ **Kunlik kvota:** `gemini-3.8-flash-tts` Tier 1 da loyiha bo'yicha KUNIGA 100 so'rov (`generate_requests_per_model_per_day`); har javob 1 so'rov, salom keshlanadi (serverga 1 so'rov).
  Kvota tugasa (`429 … per_day`) shu model retryDelay gacha o'chiriladi va zaxira model `GEMINI_TTS_FALLBACK_MODEL` (`gemini-3.8-flash-lite-tts`, alohida kvota) ishlatiladi; ikkalasi ham
  tugasa matnni **Gemini Live o'qib beradi** (`TTS_LIVE_FALLBACK=true`, `tts_voice._live_read`): tayyor javob kliplari va matn mantig'i ishlashda davom etadi, faqat erkin javob ovozi Live ovozi
  bo'ladi. Kvota bloki 10 daqiqa (retryDelay ~18 soat deyiladi, amalda oldinroq ochilgan) — keyin qayta tekshiriladi. Tayyor javob kliplari TTS ni umuman chaqirmaydi.
  **Live ovozida** audio real vaqtda keladi (oldinda atigi ~0.5 s, o'lchangan) — shuning uchun `liveAudio` ijrodan oldin 2 s audio to'playdi (`LOOKAHEAD_S`): ovoz tugashi va pauzalar
  oldindan ma'lum bo'lsin (aks holda og'iz gap tugagach ham qimirlab turadi). TTS da audio tez keladi, qo'shimcha kechikish ~0.5 s.
  ⚠️ TTS ga «… o'qi: matn» kabi ko'rsatma **qo'shilmaydi**: model uni ovoz chiqarib o'qiydi (o'lchangan: 6.6 s o'rniga 15 s). Javob matni sonlarni so'z bilan
  yozadi (tizim ko'rsatmasi), belgilar ovozlashdan oldin tozalanadi. Salom (`GREETING_TEXT`) server ishga tushganda bir marta ovozlab saqlanadi — darhol chiqadi.
  Kechikish (o'lchangan): savol tugagach birinchi audio ~3.8 s (LLM ~2 s + TTS birinchi bo'lak ~0.9 s) + brauzerning jim-kutishi 1.3 s.
  `gemini-2.5-flash-lite` yangi foydalanuvchilarga yopilgan; `gemini-3.5-flash` ~4 s (fikrlash) — shuning uchun `gemini-2.5-flash`. 2.5 modellari tez orada
  o'chirilishi mumkin — `GEMINI_CHAT_MODEL` bilan almashtiring.
- **`live`**: Gemini Live (`GEMINI_LIVE_MODEL`=`gemini-3.8-live-extended-thinking`, `GEMINI_LIVE_THINKING`). ⚠️ gemini-3.x qo'lda activity ni qabul qilmaydi — avtomatik VAD +
  `audio_stream_end`; gemini-2.5-* da qo'lda activity avtomatik yoqiladi.

### Tayyor javob kliplari (lab harakati ovozga AYNAN mos)
Umumiy gapirish variantlari jonli ovozga hece-hece mos EMAS: og'iz ovozdan mustaqil harakatlanadi, katta ekranda bu ko'rinadi (og'iz gap o'rtasida yopiladi, gap tugagach qimirlaydi, klip
almashinuvi seziladi). Salom yaxshi ko'rinadi, chunki uning videosi O'Z audiosi bilan yaratilgan. Shuning uchun tez-tez beriladigan savollar javobi ham shunday tayyorlanadi:
- `backend/app/assets/answers.json` — tayyor javoblar (`id`, `when` — qachon ishlatiladi, `text`). Gemini matn modeli (JSON rejimi) savol shulardan biriga aniq mos kelsa `clip=<id>` qaytaradi →
  backend `{"type":"clip","id":…}` yuboradi (TTS chaqirilmaydi: kvota sarflanmaydi, kechikish ~1–2 s) → brauzer `/avatar/answers/<id>.mp4` ni OVOZI BILAN ijro etadi (`AvatarVideo` `rig-answer` qatlami):
  kutish ustida 150 ms da paydo bo'ladi, uy kadrida (lablar yopiq) tugab 400 ms da kutishga xiralashadi. Klip davomida mikrofon yopiq (`liveAudio` `clipBusy`).
- Mos kelmasa — erkin javob: matn → TTS → umumiy gapirish variantlari (quyida).
- **Yangi javob qo'shish:** (1) javob matnini asosiy TTS ovozi bilan ovozlash (0.25 s jim + nutq + oxirigacha jim; WAV 24 kHz), (2) Higgsfield: `start_image = end_image` = uy kadri,
  `audio_references` = shu audio, prompt — `tools/avatar-build/GENERATE.md` («javob klipi»), (3) `python build_answers.py idle=… <id>=<video>:<wav>` (moslash, bosh qulflash, yuz moslash, yorqinlik,
  audio qo'shish; lab-ovoz mosligi va siljishi o'lchanadi: `lipMatch` ≥ 0.7, uchlarida lablar yopiq), (4) `out/answers/<id>.mp4` → `frontend/public/avatar/answers/`, `answers.json` ga yozuv.
- Salom audiosi ham fayldan (`backend/app/assets/greeting.pcm`, matni `greeting.txt` — `GREETING_TEXT` bilan bir xil bo'lsa ishlatiladi): TTS kvotasi tugaganda va qayta ishga tushganda ham bir xil ovoz.

### Pleyer (`src/AvatarVideo.tsx`, `src/avatarClips.ts`, `src/avatarClips.json`)
- **Og'iz faqat ovoz bor paytda qimirlaydi**: brauzer ijro etilayotgan audio balandligini o'lchaydi (`liveAudio` level): ovoz bor → `speaking`, 0.17 s dan ko'p jim → chiqish.
  Javob davomida (`turnRef`: audio kelganidan to `turn_complete` va ijro tugaguncha) jumlalar orasidagi pauza 1.5 s gacha gapirishni uzmaydi — TTS jumlalari orasida og'iz yopilib-ochilmasin.
  Lab harakati jonli so'zlarga hece-hece sinxron **emas** — turli variantlar tasodifiy almashib, takrorlanish sezilmaydi.
- **Gap tugashida og'iz ovoz bilan birga yopiladi (farq ~0)**: TTS audiosi hammasi oldindan keladi, shuning uchun oxirgi ESHITILADIGAN tovush qachon tugashi oldindan ma'lum
  (`liveAudio`: har chunkning oxirgi 10 ms blokli RMS ≥ 0.012 → `TurnInfo.audibleRemaining`, chiqish qurilmasi kechikishi `outputLatency` qo'shilgan; oxiridagi jimlik hisobga olinmaydi).
  Tugashiga ≤ 3.5 s qolganda pleyer klipning «ushlab turish kadri»ni (`avatarClips.json` `holds`: lablar ANIQ yopiq kadrlar) tanlab, u oxirgi tovushdan ~50 ms oldin kelishi uchun
  o'ynash tezligini sozlaydi (`planExit`: tanlash 0.7–1.4, kuzatishda 0.4–2.5 — erta yetib qolsa klip TO'XTAMAY sekinlashadi). Kadrga yetgach klip oxirgi tovushgacha (≤ 0.12 s) turadi
  va darhol kutishga (400 ms xira-o'tish) o'tadi. O'lchangan (haqiqiy TTS audiosi, 10 yugurish): yopilish payti eshitilgan tovush tugashidan ~+15…+55 ms (1 kadrdan kam).
  Oldindan ma'lum bo'lmasa (Live yoki mos kadr yo'q) — ovoz tugagach avval 0.7 s ushlab turish kadrini, keyin istalgan yopiq oynani kutadi (eng uzog'i ~1.9 s), klipni o'sha kadrda to'xtatadi.
  **Yopiq og'iz mezoni:** og'iz hududi farqi (`exits.py` `md`) ≤ kutish klipi p99 × 1.26 (~10.0) — oyna; ≤ ×1.26×0.88 (~8.8) — ushlab turish kadri/o'tish nuqtasi. Eski ×1.45 (11.5) chegarada
  tishlari ko'ringan ochiq og'iz ham «yopiq» hisoblanardi (kadrlarga qarab o'lchangan: yopiq lablar 7.8–9.3, tish ko'ringanda 11.2+); shu sabab og'iz ochiq turib to'xtab qolardi.
  Klip qabul qilinishi: ushlab turish kadrlari ≥ 4 va eng uzun oraliq ≲ 2 s (aks holda ovoz tugashiga to'g'rilab bo'lmaydi — speak_03 shu sabab chiqarildi); kadr uy kadriga mos (aks holda — speak_07,
  AI kadrni yaqinlashtirib yuborgan: `align.fit` xato beradi).
- **Og'iz faqat ovozdagi haqiqiy PAUZALARDA yopiladi** (gap oqib turganda yopilmaydi): `liveAudio` kelgan audioda jimlik (>= 0.2 s, RMS < 0.006) ni oldindan topadi (`TurnInfo.pausesAhead`).
  Pleyer keyingi pauzaga ≤ 4 s qolganda klipning ushlab turish kadrini pauza boshiga to'g'rilaydi (tezlik 0.7–1.4), pauzada klip to'xtab turadi (og'iz yopiq), pauza tugagach davom etadi.
  Keyingi variantga ham aynan pauzada o'tiladi (juftlik bo'yicha kadr-mos nuqta, bo'lmasa B ning tasodifiy yopiq kadriga). Ixtiyoriy joyda yopiq oynada almashish O'CHIRILGAN
  (`GRAPH_SWITCH_ANYWHERE`): uzun javobda har ~6 s da og'iz ~0.3 s yopilib qolardi, ovoz esa uzluksiz davom etardi. Pauza bo'lmasa — klip oxirgi yopiq oynasida keyingisiga o'tadi.
- **Keyingi hodisaga qarab klip tanlash** (erkin javoblar): pleyer har doim «keyingi hodisa»gacha (keyingi ovoz pauzasi yoki ovoz oxiri) qancha vaqt qolganini biladi va shu vaqtda
  lablar yopiq kadr keladigan klip/joyni tanlaydi: (1) KIRISHDA ikki tayyor buferdan mos kadri bori boshlanadi (`liveAudio` TTS audiosi to'liq kelishini 1.2 s gacha kutadi — qisqa javobda
  uzunlik kirish paytidayoq ma'lum); (2) PAUZADA keyingi klipning shunday yopiq kadriga (u) o'tiladiki, D soniyadan keyin yana yopiq kadr (h) kelsin; (3) KLIP OXIRIDA ovoz tugashi yaqin
  bo'lsa — keyingi klipga mos (u, h) juftligidan kiriladi, ovoz klip oxiridan ≤ 0.6 s keyin tugasa boshqa klipga o'tilmaydi: joriy klip biroz sekinlab, oxirgi yopiq kadri ovoz tugashiga
  to'g'rilanadi; (4) ovoz tugashi bilan o'ynash tezligi asliga qaytadi, to'xtab turgan klip darhol kutishga o'tadi. Bularsiz sinovda har ~4 erkin javobdan birida og'iz ovozdan keyin
  0.4–0.8 s (bir marta 3 s, sekinlashtirilgan tezlikda) qimirlab turgan.
- **Variantdan variantga FAQAT og'iz YOPIQ paytda va xira-o'tishsiz (bir kadrda) almashadi.** Og'iz ochiq paytda almashsa yoki xira-o'tish bo'lsa lablar «bijirlab» bilinadi (foydalanuvchi
  shikoyati); yopiq paytda ikki yuz deyarli bir xil, shuning uchun bir kadrli almashish ko'rinmaydi. `build_assets.py` (`build_graph`) har (A, B) juftligi uchun A ning yopiq-og'iz oralig'i
  markazi → B ning yopiq-og'iz oralig'i markazi (B da kamida 1.2 s qolsin) juftliklarini yuz hududi farqi bo'yicha saralaydi (`avatarClips.json` `graph.pairs["A-B"] = [[A kadri, B kadri, narx], …]`,
  narx ≤ 3.0; 4.5 da bosh/yuz sakrashi test chegarasidan oshdi). Pleyer zaxira buferni B kadriga oldindan suradi, A shu oynaga yetganda B ijroni davom ettiradi (`pickTransition`);
  zaxira variant shunday nuqtalari bor variantlardan tanlanadi (`pickLinked`). Mos nuqta topilmasa — variant oxirgi yopiq oynasiga yetganda keyingi variantning boshiga (uy kadri) bir kadrda o'tadi.
  **Bosh/yuz bir kadrda, tana 200 ms xira-o'tish bilan:** AI klipning kiyim to'qimasi va nafasi har klipda biroz boshqacha, shuning uchun tana ham bir kadrda almashsa "chaqnaydi" (test: tana sakrashi 4–4.5);
  eski klip yangisi ustida `out bodyfade` qatlami sifatida qoladi va CSS niqobi (`mask-image`, yoqadan yuqori ~27% shaffof) tufayli faqat yoqadan pastda 200 ms xiralashadi (tana sakrashi ~2.0).
- **Salom**: video birinchi salom audiosi kelishi bilan boshlanadi, audio esa `GREETING_SPEECH_START_S` (`avatarClips.json` → `greeting.speechStart`, hozir 1.54 s) dan 0.05 s oldin
  chalinadi (`liveAudio` `greetDelayS`) — qo'l boshga yetib borgandan keyin ovoz boshlanadi. Salom tugagach ovoz davom etsa `speaking` variantiga o'tadi.

### Videolarni qayta tayyorlash (yangi xodim yoki yangi klip)
Skriptlar va Higgsfield promptlari: `tools/avatar-build/` (`GENERATE.md`, `build_assets.py`, `align.py`, `exits.py`; Python + OpenCV + numpy + ffmpeg).
1. Higgsfield: uy kadri (qora fon) + audio ko'rsatma (gap iboralari orasida ~0.5 s jim) → klip (`GENERATE.md`: prompt va qabul mezonlari: ifoda mo'tadil, ko'z qisish/tabassum yo'q,
   boshlanish/tugash pozasi mos). Har klip qo'lda ko'zdan kechiriladi.
2. `python build_assets.py "idle=idle.mp4:24:120" "greeting=greeting.mp4" "speak=s1.mp4" "speak=s2.mp4" …` → `out/` (videolar + `avatarClips.json`). Bosqichlar:
   - **moslash** (`align.py`): klip uchlari kutish klipiga nisbatan 5 hududda (bosh, ko'krak, etak, tizza, poyabzal) o'lchanadi, butun klipga BITTA afin siljish (ko'chirish +
     vertikal masshtab, Lanczos4) qo'llanadi — AI klipni 2–4 px boshqacha joylaydi;
   - **bosh qulflash** (`stabilize`): AI klipda bosh kutish o'rnidan 1–4 px suzadi (o'lchangan: o'rtacha 1.4–2.4 px) — gapirishdan kutishga o'tganda bosh «sakrab», odam o'zgargandek
     ko'rinardi. Furajka hududi siljishi HAR KADRDA o'lchanib, bosh va yoqa (y ≤ 330, 470 gacha so'nadi) kutish klipidagi o'rniga qaytariladi (o'rtacha qoldiq 0.3–0.6 px); tana joyida;
   - **yuz moslash** (`flow_align`): yopiq-og'iz kadrlari o'rtachasi kutish klipining uy kadriga DIS optik oqimi bilan moslanadi, klip bo'yicha BITTA silliq siljish maydoni (qosh, ko'z, burun, lablar,
     furajka qirralari 1–3 px farq qilardi; yuz |ΔLab| ~25% kamayadi); klip boshi/oxirida (uy kadri) tuzatish 0, ~0.5 s ichida to'liq kuchga kiradi;
   - **yorqinlik/tiniqlik** (`tone_match`, `sharp_match`, `ramp_fix`): AI klip kutish klipidan xiraroq/qoraroq chiqadi — Y gistogrammasi va unsharp miqdori kutish klipiga moslanadi;
     boshlanish yorqinlik rampasi tekislanadi;
   - **uzun jim oraliqlarni qisqartirish** (`trim_pauses`): AI klipdagi audio-pauzalarga mos uzun yopiq-og'iz oraliqlari jonli ovozda boshqa joyga tushadi (gap o'rtasida og'iz 1 s yopilib qolardi).
     >0.25 s oraliqlar o'rtasidan qisqartiriladi (tikuv — eng o'xshash ikki kadr + 2 kadr aralashtirish); eski salom klipida (og'iz va qo'l bir vaqtda) boshidagi jim kutish `GREETING_HEAD=cut` bilan kesilardi; yangi salom klipida qo'l avval ko'tariladi (`GREETING_SPEECH=<s>` — og'iz boshlanish payti);
   - **kadr-mos o'tish nuqtalari** (`build_graph`): variantlar juftligi bo'yicha, `avatarClips.json` `graph`;
   - **chiqish oynalari** (`exits.py`): og'iz yopiqligi chegarasi = kutish klipidagi og'iz farqining p99 × 1.05..1.45, bosh o'rni ≤ 2.5..3.5 px;
   - kodlash: x264 `-crf 18 -g 24`, 24 kadr/s, faststart.
3. `out/*.mp4` → `frontend/public/avatar/`, `out/avatarClips.json` → `frontend/src/avatarClips.json`, `src/avatarClips.ts` dagi `ASSET_V` ni oshiring (nginx `/avatar/` ni keshlaydi).

### Sinov
**Haqiqiy odamdek sinov** (haqiqiy backend, ovozli savollar): `REAL=1 REAL_S=138 TARGET=http://127.0.0.1:5173/ MIC_WAV=<savollar.wav> node scripts/test-avatar-transitions.mjs` — Chrome soxta
mikrofonga WAV faylni beradi (salom uchun 14 s jim, so'ng savollar orasida ~21 s), brauzer VAD → backend (LLM, tayyor klip yoki TTS) → avatar. Har o'tish quyidagi chegaralar bilan o'lchanadi,
qo'shimcha: tayyor klip/erkin javoblar soni, gap oxiri ovozga to'g'rilangan/kutib chiqilgan (kutish ms), pauzada to'xtashlar va hodisalar ketma-ketligi. ⚠️ Har erkin javob 1 ta TTS so'rovi
(kuniga 100 ta chegara) — sinovni tejab ishlating. Soxta rejim (standart) backend va kvota talab qilmaydi.

`npm run build && npm run test:transitions` (haqiqiy Chrome, soxta Gemini oqimi): har bir o'tish turi alohida o'lchanadi — kechikish, qotish
(≤ 110 ms), kadrlararo sakrash (furajka/soch, yuz, tana: shu videoning o'zidagi eng katta oddiy qadamdan ×1.15+0.5 dan oshmasin) va qorayish chaqnashi
(≤ 6%; kutish → salom: ≤ 9% — qo'l ko'tarilganda sahna yorqinligi haqiqatan tushadi). Ekran yozuvi (CDP screencast) ba'zan kadr tashlaydi — >100 ms oraliqli juftliklar va «Suhbatni boshlash/Tugatish» bosilgan payt hisobga olinmaydi.
`THROTTLE=4` — zaif noutbuk, `VERBOSE=1` — har o'tish alohida, `DUMP_DIR=…` — o'tish kadrlarini saqlash.

**Eski usul — 3D modeldan yozib olish.** ⚠️ `npm run record:avatar` `public/avatar/` ni 3D model videolari bilan **almashtirib yuboradi** va joriy
videolar bilan **mos emas** (boshqa o'lcham, boshqa o'tish nuqtalari). Faqat arxiv uchun.
Videolar 3D modeldan, brauzerning o'zida (WebCodecs) kadrma-kadr **deterministik** render qilinadi — `ffmpeg` kerak emas, faqat Chrome:
```bash
cd frontend
npm run record:avatar                              # hammasi: greeting/speaking/idle × mp4/webm + idle-poster.jpg
npm run record:avatar -- --clips=speaking          # faqat bittasi
npm run record:avatar -- --preview=../.tmp/prev    # video o'rniga PNG kadrlar (ko'zdan kechirish)
```
- Manba: `frontend/recorder/` — `avatar.web.glb` (49MB, CC4 uniform), `Avatar.tsx`, `timeline.ts` (og'iz, pirpirash, salom vaqt chizig'i), `morphs.ts`. Saytga **kirmaydi** (three.js faqat `devDependencies`).
- Kadr o'lchami 1440×1440 (Salute paytida tirsak sig'ishi uchun kvadrat); boshqasi: `--width=… --height=…`. Chrome topilmasa: `CHROME_PATH=…`.
- Asl model: `frontend/model-src/avatar-original.glb` (CC4, 71MB, gitignore). `recorder/avatar.web.glb` ni qayta yaratish:
  ```bash
  KEEP_MORPHS=1 node scripts/optimize-avatar.mjs ../model-src/avatar-original.glb recorder/avatar.web.glb
  ```
- Testlar: `npm test` (`recorder/timeline.test.ts` — loop chokida og'iz yopiq, kadrlar soni; `recorder/morphs.test.ts` — Salute morphlari).

## Status

- ✅ Backend: `/faq`, `/avatar/ask` (faq/web/redirect klassifikatsiya), `/search/official` (grounding), suhbat log
- ✅ Frontend: avatar videolari (salom / gapirish / kutish; haqiqiy xodim rasmidan AI yaratgan, tik to'liq bo'y), jonli ovozli suhbat UI
- ✅ Ovoz: Gemini matn modeli + Gemini TTS (`gemini-3.8-flash-tts`, o'zbekcha talaffuz Live'dan yaxshi)
- ⏳ Kerak: `GEMINI_API_KEY`, galogramma apparati
- 🔜 Keyingi: 15 tagacha gapirish varianti, ovoz kechikishini kamaytirish, kiosk fullscreen, statistika, ko'p FAQ

## Stack
FastAPI · SQLAlchemy 2.0 · google-genai · React 18 · TypeScript · Vite · (yozib olish uchun, saytda yo'q:) Three.js + R3F + drei · puppeteer-core · WebCodecs
