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

Sayt 3D modelni **yuklamaydi** — avatar oldindan tayyorlangan 3 ta video (`frontend/public/avatar/`, ~5 MB mp4 + webm zaxira,
720×1280 tik, to'liq bo'y, old tomondan). Avatar — haqiqiy xodim: videolar uning rasmlaridan AI bilan yaratilgan
(rasmdan foydalanishga yozma rozilik saqlansin). Ovoz — ayol (`GEMINI_VOICE=Kore`, `backend/app/config.py`).

| Video | Qachon | Qanday |
|-------|--------|--------|
| `greeting` (6 s) | suhbat boshlanib, avatar **birinchi marta gapirganda** (ovoz kelmasa 15 s dan keyin) | bir marta: qo'li bilan salom, og'zi harakatda |
| `speaking` (14 s) | **ovoz eshitilayotganda** | uzluksiz gapirish, loop |
| `idle` (4 s) | ovoz yo'q: tinglayotganda, so'zlar/jumlalar orasidagi pauzada, javob tugagach | og'iz yopiq, nafas va ko'z qisish, loop |

**Og'iz faqat ovoz bor paytda qimirlaydi.** Brauzer pleyerning haqiqiy ovoz balandligini o'lchaydi (`liveAudio` level, `src/AvatarVideo.tsx`):
ovoz bor → `speaking`, 0.15 s dan ko'p jim → `idle` (Gemini nutqida pauzalar vaqtning ~15–20% ini tashkil etadi).
`speaking` va `idle` birga yurib turadi, almashtirish 0.12 s xira-o'tish bilan. Salomdan keyin ikkalasi 0 dan birga boshlanadi
(uchala klip ham bir xil start kadrdan boshlanib, shu kadrga qaytadi: salom oxiri = idle boshi). `speaking` videosidagi lab harakati
oldindan berilgan ovozga moslab chizilgan — jonli Gemini so'zlariga hece-hece sinxron **emas** (faqat ovoz borligiga bog'langan).

**Videolarni qayta tayyorlash** (boshqa xodim, kadr yoki sifat o'zgarsa):
1. Xodimning 1–2 rasmidan old tomondan, to'liq bo'yli, qora fonli start kadr yaratiladi (rasm modeli).
2. Shu kadrdan 3 ta klip: `idle` va `speaking` (start kadr = oxirgi kadr), `greeting` (shu kadrga qaytadi; salom qo'li). Hammasi ovozsiz, 9:16, 720p,
   **bir xil modelda** (Seedance 2.0 Mini): boshqa model rangni boshqacha beradi (kutish klipi gapirishdan farq qilib qolgan edi).
   `idle` uchun ko'rsatma «butunlay qimirlamay turadi, faqat bir marta ko'z qisadi» (aks holda AI tana va qo'lni qimirlatadi).
   `speaking` uchun ayol ovozli namuna audio (14 s) lab harakati uchun beriladi.
3. **Qotirish** — kliplar almashganda sakrash va rang o'zgarishi sezilmasin, bitta model kabi ko'rinsin
   (`pip install opencv-python numpy`; ffmpeg `PATH` yoki `FFMPEG_PATH`):
   ```bash
   cd frontend
   python scripts/stabilize-avatar-clips.py <xom-papka> <start-kadr.png> <qotirilgan-papka>
   ```
   Har kadrning bosh va tana holati start kadrga keltiriladi (tana deyarli qotadi, bosh gapirganda biroz harakat qiladi; ko'z qisish va
   og'iz saqlanadi), rang-yorqinlik xaritasi start kadrga moslanadi. O'lchangan: kutish va gapirish orasidagi rang farqi
   (R,G,B) (3.2, 2.3, −2.7) → (0.3, 0.2, 0.3); tana farqi 12 → ~5 daraja.
4. Xom kliplar (`idle_raw.mp4`, `speaking_raw.mp4`, `greeting_raw.mp4` — qotirilgan papkada) saytga tayyorlanadi: fon sayt foniga (#05070d) almashtiriladi,
   loop klipning takroriy oxirgi kadri tashlanadi, mp4 + webm + `idle-poster.jpg` yoziladi:
   ```bash
   FFMPEG_PATH=/yo'l/ffmpeg npm run process:avatar -- <qotirilgan-papka>    # ffmpeg: libx264 + libvpx-vp9; chiqish: public/avatar/
   ```
   Fon sayt foni bilan **bir xil** bo'lishi shart (`src/styles.css` dagi `--bg`, skriptdagi `BG`), aks holda video chetlari ko'rinadi.

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
