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

Sayt 3D modelni **yuklamaydi**. Avatar — haqiqiy xodim (rasmidan foydalanishga yozma rozilik saqlansin), u **qatlamlardan** yig'iladi
(`frontend/public/avatar/`, jami ~2.3 MB; 1080×1920 tik, to'liq bo'y, old tomondan). Ovoz — ayol (`GEMINI_VOICE=Kore`, `backend/app/config.py`).

| Qatlam | Nima | Qachon |
|--------|------|--------|
| `base.jpg` | tana, boshsiz (qimirlamaydi) | doim |
| `head.webp` | bosh: furajka, soch, yuz, quloq (alfa kanalli, asl rasmdan, o'tkir) | doim; pleyer uni bo'yin tagi atrofida yengil aylantirib siljitadi |
| `idle` (4.6 s) | **yuz qirqimi** (240×176): og'iz yopiq, bitta tabiiy pirpirash, loop | ovoz yo'q: tinglayotganda, so'z/jumla pauzasida, javob tugagach |
| `speaking` (12.8 s) | **yuz qirqimi**: og'iz, qosh, yonoq harakatda, loop | **ovoz eshitilayotganda** |
| `greeting` (6 s) | to'liq kadr: qo'li bilan salom, og'zi harakatda; boshi va oxiri qatlamlarga piksel-piksel teng | suhbat boshlanib, avatar **birinchi marta gapirganda** (ovoz kelmasa 15 s dan keyin) |

**Bosh qotib turmaydi.** Yuz videolari bosh qatlami **ichida** turadi, shuning uchun bosh bilan birga yuradi (`src/avatarRig.ts` — `headPose`):
tinch holatda ≈ ±0.2°, gapirganda ≈ ±0.6° (ovoz balandligiga qarab), salom paytida qotadi, kadrdan kadrga ≤ 0.05°. Amplituda ataylab kichik:
avatar yaqinlashtirib (1:1 va kattaroq) ko'rilganda ham «ortiqcha qimirlash» bo'lmasin (avval ±1.6° edi — haddan tashqari deb topildi).
Furajka va soch AI videodan emas, asl rasmdan, shuning uchun titramaydi va qiyshaymaydi.

**Og'iz faqat ovoz bor paytda qimirlaydi.** Brauzer pleyerning haqiqiy ovoz balandligini o'lchaydi (`liveAudio` level, `src/AvatarVideo.tsx`):
ovoz bor → `speaking`, 0.25 s dan ko'p jim → `idle` (Gemini nutqida pauzalar vaqtning ~15–20% ini tashkil etadi).
`idle` va `speaking` **doim birga yuradi** (to'xtatilgan klipni qayta boshlash ~100 ms qotish bergan), almashtirish 0.12 s xira-o'tish bilan.
Eski qatlam xira-o'tish tugagach (`transitionend`) olib tashlanadi, taymer faqat zaxira. `speaking` videosidagi lab harakati oldindan
berilgan ovozga moslab chizilgan — jonli Gemini so'zlariga hece-hece sinxron **emas** (faqat ovoz borligiga bog'langan).

**Nega almashish sezilmaydi.** Kliplar almashganda faqat kichik yuz qirqimi xira-o'tadi; tana, furajka va soch qatlamlari hech qachon
almashmaydi (o'lchangan: tana kadrlararo farqi 0.0). Salom — to'liq kadr, lekin boshi va oxiri qatlamlarga piksel-piksel teng, shuning
uchun uning xira-o'tishi ham sezilmaydi. Yuz videodan **farq maskasi** bilan olinadi: yuz markazi (qosh, ko'z, burun, og'iz) har doim videodan,
yonoq/jag' chizig'i — faqat video asl rasmdan farq qilgan joyda, sirg'alar — doim asl rasmdan. (Avval asl rasmning mayda tafsiloti
siljigan qosh ustiga qo'yilardi: «ikki qosh», «ikki sirg'a» — bir video ikkinchisining ustiga tushgandek.) Salomda qo'l maskasi faqat qo'l
joylashgan hududda (tana, galstuk, yelka — asl rasm; avval tananing mayda siljishi ham maskaga tushib «ikki galstuk» bergan).
AI ifodasi ortiqcha (lablar cho'chchayadi, keng tabassum): pastki yuzda ifoda optik oqim bilan 50% ga yumshatilgan (ko'z va qosh tegilmaydi —
pirpirash saqlanadi), yuz klipi kadrlari vaqt bo'yicha silliqlangan (AI har kadrni qayta chizadi, teri va lab titraydi); kadrlararo o'zgarish ~28% kam.
AI video bo'lmaganda ham shunday qilish shart: AI har kadrni qayta chizadi — furajkani qiyshaytiradi, kiyim teksturasini "titratadi",
rangni klipdan klipga o'zgartiradi, qora sochni fon bilan birlashtiradi.

**Videolarni qayta tayyorlash** (boshqa xodim, kadr yoki sifat o'zgarsa; kerak: python3, `pip install opencv-python numpy rembg onnxruntime pymatting`, ffmpeg `PATH` yoki `FFMPEG_PATH`):
1. Xodimning 1–2 rasmidan old tomondan, to'liq bo'yli, qora fonli, furajkasi tekis start kadr yaratiladi (rasm modeli). **Furajka va soch shu kadrdan olinadi**, shuning uchun u yerda tekis va to'liq bo'lishi kerak.
2. Shu kadrdan 3 ta klip: `idle` va `speaking` (start kadr = oxirgi kadr), `greeting` (shu kadrga qaytadi; salom qo'li). Hammasi ovozsiz, 9:16, 720p,
   **bir xil modelda** (Seedance 2.0 Mini). `idle` uchun ko'rsatma «butunlay qimirlamay turadi, faqat bir marta ko'z qisadi».
   `speaking` uchun ayol ovozli namuna audio (14 s) lab harakati uchun beriladi.
3. **Kontur** (soch bilan; rangiga qarab fonni qoraytirish qop-qora sochni ham yo'qotadi — bosh "kal" ko'rinadi):
   ```bash
   cd frontend
   python scripts/make-avatar-matte.py <start-kadr.png> <kontur.png>
   ```
4. **Yig'ish** — har kadrning bosh va tana holati start kadrga keltiriladi, rang-yorqinlik unga moslanadi; yuz videodan, qolgani asl kadrdan
   olinadi (farq maskasi); kontur bo'yicha fon sayt foniga (#05070d) almashtiriladi (boshning orqasida yengil yorug'lik: `--glow`, aks holda
   qora soch ko'rinmaydi). Natija: `base.png` (boshsiz tana), `head.png` (alfa kanalli bosh), `rig.json` (joylashuv), `idle_raw.mp4` va
   `speaking_raw.mp4` (yuz qirqimi), `greeting_raw.mp4` (to'liq kadr):
   ```bash
   python scripts/build-avatar-clips.py <xom-papka> <start-kadr.png> <kontur.png> <yig'ilgan-papka> \
     "--seq=idle:0-28,27-1,0-28,29-32,76-96" "--seq=speaking:30-336"      # xom-papka: idle_raw.mp4, speaking_raw.mp4, greeting_raw.mp4
   ```
   `--seq=<klip>:a-b,c-d` — chiqish kadrlari tartibi (a>b bo'lsa teskari). Bu yerda: AI **kutish** klipida ko'zlar 1.7 s yumuq turardi
   (kutayotgan odamga o'xshamaydi) — ochiq kadrlar oldinga-orqaga takrorlanib, bitta tez pirpirash qo'shildi; **gapirish** klipi og'zi yopiq
   kadrdan boshlanadi (loop choki sezilmasin). Raqamlar xom klipga bog'liq: har yangi klipda `--limit=N` bilan yuz qirqimlarini ko'zdan kechiring.
   Qatlam chegaralari (`HEAD_RECT`, `CUT`, `PIVOT`, `FACE_RECT`) skriptda, `src/avatarRig.ts` bilan bir xil bo'lishi shart (`npm test` solishtiradi).
5. **Kodlash**: base.jpg, head.webp, mp4 + webm (loop klipning takroriy oxirgi kadri tashlanadi):
   ```bash
   npm run process:avatar -- <yig'ilgan-papka>      # chiqish: public/avatar/
   ```
   Fon sayt foni bilan **bir xil** bo'lishi shart (`src/styles.css` dagi `--bg`, `build-avatar-clips.py` dagi `BG`), aks holda tana chetlari ko'rinadi.
   Fayllar mazmuni o'zgarsa `src/avatarRig.ts` dagi `ASSET_V` ni oshiring (nginx `/avatar/` ni keshlaydi).
6. **Sinov** — har bir o'tish turi alohida o'lchanadi (kechikish, qotish, tana/furajka sakrashi, qorayish) va bosh harakati tekshiriladi:
   ```bash
   npm run build && npm run test:transitions         # THROTTLE=4 — zaif noutbuk; HEADFUL=1 — oyna bilan; DUMP_DIR=… — o'tish kadrlarini saqlash
   ```
   O'lchangan (CPU 1× va 4×): tana kadrlararo farqi 0.0, furajka/soch — oddiy qimirlashdan ≤ 1.5 ortiq, yorqinlik tushishi ≤ 1.3%, kadr qotishi
   ≤ 67 ms (2 kadr), boshning burilishi tinch holatda 0.21°, gapirganda 0.61°, salomda 0°, kadrdan kadrga ≤ 0.04°.
   Sinov sizning ekraningizga ham mos bo'lishi uchun ekran yozuvini (`Screen Recording …mp4`) kadrma-kadr ko'zdan kechiring: ffmpeg bilan kadrlarga
   ajratib, bosh/tana hududlarining kadrlararo farqini o'lchash «ikki qatlam» va titrashni eng ishonchli ko'rsatadi.

**Eski usul — 3D modeldan yozib olish.** ⚠️ `npm run record:avatar` `public/avatar/` ni 3D model videolari bilan **almashtirib yuboradi** va
qatlamli pleyer (`base.jpg`, `head.webp`, yuz qirqimlari) bilan **mos emas**: u to'liq kadrli kliplar yozadi. Faqat arxiv uchun.
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
- ⏳ Kerak: `GEMINI_API_KEY` (web-grounding + kelajakda Gemini TTS), galogramma apparati
- 🔜 Keyingi: o'zbek TTS sifati, kiosk fullscreen, statistika, ko'p FAQ

## Stack
FastAPI · SQLAlchemy 2.0 · google-genai · React 18 · TypeScript · Vite · (yozib olish uchun, saytda yo'q:) Three.js + R3F + drei · puppeteer-core · WebCodecs
