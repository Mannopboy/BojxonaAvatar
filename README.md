# BojxonaAvatar — Virtual bojxona xodimi (3D avatar)

«Qabulxona» avatariga o'xshash tizim: bojxona zaliga **galogramma 3D odam** qo'yiladi,
Gemini API orqali **gapiradi** va yo'lovchilarga **bojxona hodimi sifatida** javob beradi.

- **3 asosiy savol** (docx bilim bazasi) — kafolatlangan, aniq javoblar.
- **Qo'shimcha savol** → Gemini + Google Search **grounding**, faqat rasmiy saytlardan
  (customs.uz, lex.uz, gov.uz) — 🔴 **xotiradan emas, har doim oxirgi ma'lumot**.

> To'liq hujjat (ADR, API, DB): Obsidian vault `Projects-FinTech/01_Projects/BojxonaAvatar/`.

## Arxitektura

```
Frontend (React + Three.js)          Backend (FastAPI)
  3D avatar (galogramma) ─ TTS ovoz    /faq            → 3 savol (DB)
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

## 3D Avatar modeli

- Manba model: `frontend/model-src/avatar-original.glb` (CC4 uniform, 71MB — **git'da saqlash uchun Git LFS tavsiya etiladi**).
- Web uchun optimallashtirilgan: `frontend/public/avatar.web.glb` (49MB, teksturalar 1024/webp).
  Qayta yaratish:
  ```bash
  cd frontend
  KEEP_MORPHS=1 node scripts/optimize-avatar.mjs ../model-src/avatar-original.glb public/avatar.web.glb
  ```
- Model 400+ morph target'ga ega; kerakli ~7 tasi (viseme + blink) **brauzerda render'dan oldin**
  qoldiriladi (`src/Avatar.tsx`) — GPU xotira tejaladi, WebGL context lost oldini oladi.
- Salomlashuv: modeldagi **'Salute'** animatsiyasi bir marta o'ynaydi.

## Status

- ✅ Backend: `/faq`, `/avatar/ask` (faq/web/redirect klassifikatsiya), `/search/official` (grounding), suhbat log
- ✅ Frontend: 3D avatar (galogramma), lip-sync + ko'z pirpirash, suhbat UI, mikrofon, TTS (brauzer), tillar (uz/ru)
- ⏳ Kerak: `GEMINI_API_KEY` (web-grounding + kelajakda Gemini TTS), galogramma apparati
- 🔜 Keyingi: o'zbek TTS sifati, kiosk fullscreen, statistika, ko'p FAQ

## Stack
FastAPI · SQLAlchemy 2.0 · google-genai · React 18 · TypeScript · Vite · Three.js + R3F · @react-three/drei
