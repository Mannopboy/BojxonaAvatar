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

Sayt 3D modelni **yuklamaydi** — avatar oldindan tayyorlangan 3 ta video (`frontend/public/avatar/`, ~4 MB mp4 + webm zaxira,
1080×1920 tik, to'liq bo'y, old tomondan). Avatar — haqiqiy xodim: yuz AI videodan, qolgani (tana, furajka, soch) uning rasmidan
(rasmdan foydalanishga yozma rozilik saqlansin). Ovoz — ayol (`GEMINI_VOICE=Kore`, `backend/app/config.py`).

| Video | Qachon | Qanday |
|-------|--------|--------|
| `greeting` (6 s) | suhbat boshlanib, avatar **birinchi marta gapirganda** (ovoz kelmasa 15 s dan keyin) | bir marta: qo'li bilan salom, og'zi harakatda |
| `speaking` (14 s) | **ovoz eshitilayotganda** | uzluksiz gapirish, loop |
| `idle` (4 s) | ovoz yo'q: tinglayotganda, so'zlar/jumlalar orasidagi pauzada, javob tugagach | og'iz yopiq, ko'z qisish, loop |

**Og'iz faqat ovoz bor paytda qimirlaydi.** Brauzer pleyerning haqiqiy ovoz balandligini o'lchaydi (`liveAudio` level, `src/AvatarVideo.tsx`):
ovoz bor → `speaking`, 0.25 s dan ko'p jim → `idle` (Gemini nutqida pauzalar vaqtning ~15–20% ini tashkil etadi).
`idle` va `speaking` **doim birga yuradi** (salom paytida ham: to'xtatilgan klipni qayta boshlash ~100 ms qotish bergan), almashtirish 0.12 s
xira-o'tish bilan. Eski qatlam xira-o'tish tugagach (`transitionend`) olib tashlanadi, taymer faqat zaxira. `speaking` videosidagi lab
harakati oldindan berilgan ovozga moslab chizilgan — jonli Gemini so'zlariga hece-hece sinxron **emas** (faqat ovoz borligiga bog'langan).

**Nega almashish sezilmaydi.** Hamma kliplarda tana, furajka, soch va quloq **asl kadrning o'zi** (piksel-piksel bir xil, o'tkir);
videodan faqat yuz (qosh, ko'z, og'iz, iyak) qo'yiladi, salomda esa ko'tarilgan qo'l ham. AI video bo'lmaganda ham shunday qilish
shart: AI har kadrni qayta chizadi — furajkani qiyshaytiradi, kiyim teksturasini "titratadi", rangni klipdan klipga o'zgartiradi,
qora sochni fon bilan birlashtiradi.

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
4. **Yig'ish** — har kadrning bosh va tana holati start kadrga keltiriladi, rang-yorqinlik unga moslanadi, montaj qilinadi (asl kadr + yuz
   [+ qo'l]), kontur bo'yicha fon sayt foniga (#05070d) almashtiriladi; boshning orqasida yengil yoritilgan fon (`--glow`, aks holda qora soch ko'rinmaydi):
   ```bash
   python scripts/build-avatar-clips.py <xom-papka> <start-kadr.png> <kontur.png> <yig'ilgan-papka>   # xom-papka: idle_raw.mp4, speaking_raw.mp4, greeting_raw.mp4
   ```
5. **Kodlash**: mp4 + webm + `idle-poster.jpg` (loop klipning takroriy oxirgi kadri tashlanadi):
   ```bash
   npm run process:avatar -- <yig'ilgan-papka>      # chiqish: public/avatar/
   ```
   Fon sayt foni bilan **bir xil** bo'lishi shart (`src/styles.css` dagi `--bg`, `build-avatar-clips.py` dagi `BG`), aks holda video chetlari ko'rinadi.
6. **Sinov** — har bir o'tish turi alohida o'lchanadi (kechikish, qotish, ekrandagi sakrash, qorayish):
   ```bash
   npm run build && npm run test:transitions         # THROTTLE=4 — zaif noutbuk; HEADFUL=1 — oyna bilan; DUMP_DIR=… — o'tish kadrlarini saqlash
   ```
   O'lchangan (kutish ↔ gapirish): tana, furajka, soch — farq 0.1–0.4 daraja (siqish shovqini), rang farqi 0, yorqinlik tushishi 0.3% gacha, kadr qotishi ≤ 67 ms (2 kadr).

**Eski usul — 3D modeldan yozib olish.** ⚠️ `npm run record:avatar` `public/avatar/` ni 3D model videolari bilan **almashtirib yuboradi**.
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
