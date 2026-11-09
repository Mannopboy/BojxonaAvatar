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

Sayt 3D modelni **yuklamaydi**. Avatar — haqiqiy xodim (rasmidan foydalanishga yozma rozilik saqlansin), u **3 ta AI video**dan iborat
(`frontend/public/avatar/`, jami ~3 MB; 720×1280 tik, to'liq bo'y, old tomondan). Videolarga **hech qanday ishlov berilmagan**: faqat qirqilgan
va orqa foni qora (quyida). Bosh/tana uchun qo'shimcha harakat, qatlam, yuz ifodasini yumshatish **yo'q** (avval bor edi — foydalanuvchi «ortiqcha,
sun'iy» deb topdi, olib tashlandi). Ovoz — ayol (`GEMINI_VOICE=Kore`), model `gemini-3.8-live-extended-thinking` (`GEMINI_LIVE_MODEL`, `GEMINI_LIVE_THINKING`; `backend/app/config.py`). ⚠️ gemini-3.x modellar qo'lda activity (`activity_start/end`) ni qabul qilmaydi — backend avtomatik VAD ishlatadi va foydalanuvchi gapirib bo'lgach `audio_stream_end` yuboradi; gemini-2.5-* ga qaytilsa qo'lda activity avtomatik yoqiladi.

| Video | Nima | Qachon |
|-------|------|--------|
| `idle.mp4` (4.7 s) | tinglayotgan avatar, og'iz yopiq, har ~4.7 s da bitta pirpirash; kadrlar oldinga-orqaga (takrorlanish choki yo'q) | ovoz yo'q: tinglayotganda, javob tugagach |
| `speaking.mp4` (6.7 s) | gapirish, takrorlanadi | **ovoz eshitilayotganda** |
| `greeting.mp4` (4.6 s) | qo'li bilan salom, bir marta | suhbat boshlanib, avatar **birinchi marta gapirganda** (ovoz kelmasa 15 s dan keyin) |

**Og'iz faqat ovoz bor paytda qimirlaydi.** Brauzer pleyerning haqiqiy ovoz balandligini o'lchaydi (`liveAudio` level, `src/AvatarVideo.tsx`):
ovoz bor → `speaking`, 0.25 s dan ko'p jim → `idle`. `speaking` videosidagi lab harakati jonli so'zlarga hece-hece sinxron **emas**.

**Klipdan klipga sezilmay o'tish.** Xom AI klipda bosh o'zi 3–14 px (xom piksel) siljiydi, shuning uchun ikki klip xira-o'tishida «ikki bosh» chiqmasligi
uchun: (1) `speaking` va `greeting` **doim boshidan** boshlanadi (ularning birinchi kadrida bosh kutish holatidagi o'rnida, ≤ 1.9 px);
(2) `greeting` shunday qirqilganki, oxirida bosh yana kutish o'rniga qaytadi (≤ 1 px); (3) `speaking` dan `idle` ga esa pleyer boshning o'rni kutish
holatiga mos kelgan oraliqni kutadi (`src/avatarClips.json`, ≤ 0.9 s; `nextExitDelay` — `src/avatarClips.ts`); (4) xira-o'tish 400 ms.
Takrorlanish nuqtalari klip kadrlari o'lchab tanlangan: chok oddiy kadrlararo o'zgarishdan keskin emas.
**Xom klipning birinchi ~12 kadri qorong'iroq** (AI asl rasm yorqinligidan o'z yorqinligiga o'tadi: jaket ~9%) — shu kadrlar kesib tashlangan,
aks holda kutish aylanishi har bir necha soniyada yorqinlik «puls»ini berardi.

**Videolarni qayta tayyorlash** (boshqa xodim yoki yangi AI klip; kerak: ffmpeg). Xom klip — `<nom>_raw.mp4` (720×1280, 24 kadr/s, ovozsiz).
Kadr raqamlari **har yangi klip uchun qayta o'lchanadi**: (a) takrorlanish chokini kadrlar farqi bo'yicha (bosh+yelka hududi, kichik farq) — `speaking` uchun
37–197, (b) kirish kadrida bosh o'rni kutish holatiga mos (≤ 2 px), (c) `speaking` ichida kutish holatiga yaqin (≤ 3 px) kadrlar oralig'i (`avatarClips.json`),
(d) boshlang'ich yorqinlik «rampasi» tugagan kadr (kutish — 12, salom — 14). Joriy qiymatlar bilan, har klip uchun (`speaking` va `greeting` — oddiy qirqim;
`idle` — 12–36 kadrlar: ochiq ko'z oralig'i 12–28 ikki marta oldinga-orqaga, keyin 12–36 pirpirash bilan oldinga-orqaga; 112 kadr):
```bash
ENC="-an -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -g 24 -movflags +faststart -r 24"
ffmpeg -i speaking_raw.mp4 -/filter_complex speaking.graph -map "[v]" $ENC speaking.mp4
ffmpeg -i greeting_raw.mp4 -/filter_complex greeting.graph -map "[v]" $ENC greeting.mp4
ffmpeg -i idle_raw.mp4     -/filter_complex idle.graph     -map "[v]" $ENC idle.mp4
```
Filtr grafiklari (`<P>` — pastdagi qator, har uch kanalda bir xil; `KEY` — qora fon filtri):
```
KEY = format=gbrp,geq=r='<P>ld(0)*ld(7)':g='<P>ld(1)*ld(7)':b='<P>ld(2)*ld(7)',format=yuv420p
<P> = st(0,r(X,Y));st(1,g(X,Y));st(2,b(X,Y));st(3,(ld(0)+ld(1)+ld(2))/3);st(4,clip((ld(3)-30)/14,0,1));st(4,ld(4)*ld(4)*(3-2*ld(4)));st(5,clip((max(ld(0),max(ld(1),ld(2)))-min(ld(0),min(ld(1),ld(2)))-7)/6,0,1));st(5,ld(5)*ld(5)*(3-2*ld(5)));st(6,clip((ld(1)-max(ld(0),ld(2))-2)/4,0,1));st(6,ld(6)*ld(6)*(3-2*ld(6)));st(7,max(ld(4),max(ld(5),ld(6))));
speaking.graph:  [0:v]select='between(n,37,197)',setpts=N/24/TB,KEY[v]
greeting.graph:  [0:v]select='between(n,14,123)',setpts=N/24/TB,KEY[v]
idle.graph:      [0:v]select='between(n,12,36)',setpts=N/24/TB,split=2[all][allb];[all]select='between(n,0,16)',setpts=N/24/TB,split=2[o1][o2];[o2]reverse,select='between(n,1,15)',setpts=N/24/TB[or];[o1][or]concat=n=2:v=1:a=0,setpts=N/24/TB,split=2[A1][A2];[allb]split=2[f1][f2];[f2]reverse,select='between(n,1,23)',setpts=N/24/TB[fr];[f1][fr]concat=n=2:v=1:a=0,setpts=N/24/TB[B];[A1][A2][B]concat=n=3:v=1:a=0,setpts=N/24/TB,KEY[v]
```
**Orqa fon qora.** AI klipning foni to'q kulrang-ko'kimtir (yorqinligi 15–27, rangsiz), kiyim esa rangli. Har pikselda belgi `k = max(smooth(yorqinlik, 30→44),
smooth(rang farqi max−min, 7→13), smooth(G − max(R,B), 2→6))`, natija = piksel × `k`: to'q va rangsiz/ko'kimtir piksel (fon, qora soch, poyabzal) qora bo'ladi,
yuz, kiyim, jez tugma, oq yoqa qoladi. ffmpeg'da `geq` filtri (`format=gbrp`, har kanalda `st()/ld()` registrlari bilan bir xil ifoda); filtr grafigi
uzun bo'lgani uchun faylga yozib `-/filter_complex fayl.graph` bilan beriladi. Sahna foni ham qora (`src/styles.css` — `.scene`, `.avatar-video`).
Fayllar mazmuni o'zgarsa `src/avatarClips.ts` dagi `ASSET_V` ni oshiring (nginx `/avatar/` ni keshlaydi).

**Sinov** — `npm run build && npm run test:transitions` (haqiqiy Chrome, soxta Gemini oqimi): har bir o'tish turi alohida o'lchanadi — kechikish, qotish
(≤ 110 ms), kadrlararo sakrash (furajka/soch, yuz, tana: shu videoning o'zidagi eng katta oddiy qadamdan ×1.15+0.5 dan oshmasin) va qorayish chaqnashi
(oldingi/keyingi holatga nisbatan ≤ 4%). Ekran yozuvi (CDP screencast) ba'zan kadr tashlaydi (33 ms o'rniga 100–230 ms) — >100 ms oraliqli juftliklar va
«Suhbatni boshlash/Tugatish» bosilgan payt (sahifa interfeysi o'zgaradi) hisobga olinmaydi. `THROTTLE=4` — zaif noutbuk, `VERBOSE=1` — har o'tish alohida,
`DUMP_DIR=…` — o'tish kadrlarini saqlash.

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
- ⏳ Kerak: `GEMINI_API_KEY` (web-grounding + kelajakda Gemini TTS), galogramma apparati
- 🔜 Keyingi: o'zbek TTS sifati, kiosk fullscreen, statistika, ko'p FAQ

## Stack
FastAPI · SQLAlchemy 2.0 · google-genai · React 18 · TypeScript · Vite · (yozib olish uchun, saytda yo'q:) Three.js + R3F + drei · puppeteer-core · WebCodecs
