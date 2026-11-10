// Avatar qatlamlari orasidagi HAR BIR o'tishni brauzerda o'lchaydi (soxta Gemini oqimi, haqiqiy Chrome, yig'ilgan `dist`):
//   salom ↔ kutish, salom → gapirish, kutish ↔ gapirish, yuz klipi loop chokilari (kutish, gapirish).
// Har o'tish uchun: yangi qatlamning birinchi kadri qancha kechikdi, ko'rinib turgan kadrlar orasida eng uzun to'xtash (qotish),
// ekrandagi sakrash (qo'shni kadrlar farqi: furajka/soch, yuz, tana alohida) va yorqinlik tushishi (qorayish).
// Avatar — 3 ta xom video (idle, speaking, greeting), qatlam va qo'shimcha harakat yo'q.
//
//   npm run build && node scripts/test-avatar-transitions.mjs        (THROTTLE=4 — zaif noutbuk, HEADFUL=1 — oyna bilan, TARGET=url — tayyor sayt)
//
// Chiqish kodi 0 — hamma o'tish chegaradan o'tdi. Chrome: CHROME_PATH yoki standart joylar.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(FRONT, "package.json"));
const puppeteer = require("puppeteer-core");
const sharp = require("sharp");
const { preview } = require("vite");

const CHROME =
  process.env.CHROME_PATH ||
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
const THROTTLE = Number(process.env.THROTTLE || 1);
// REAL=1: soxta Gemini oqimi o'rniga HAQIQIY backend (TARGET — ishlab turgan sayt, masalan dev server) va soxta mikrofon (MIC_WAV — savollar yozilgan WAV); REAL_S — suhbat davomiyligi (s).
// Haqiqiy odamdek sinov: ovozli savol -> backend (LLM, TTS yoki tayyor javob klipi) -> avatar. Har o'tish xuddi shu chegaralar bilan o'lchanadi.
const REAL = !!process.env.REAL;
const REAL_S = Number(process.env.REAL_S || 120);
// Chegaralar (o'lchangan shovqin ustiga zaxira bilan): kadr oralig'i 41.7 ms.
// capPop/bodyPop — o'tish paytidagi eng katta kadrlararo farq, oddiy (o'tishsiz) p95 ustiga qo'shimcha: bosh doim qimirlaydi,
// shuning uchun absolyut emas, nisbiy.
// latencyMs = stallMs: ikkalasi ham "kadr uzilishi"ni o'lchaydi; 24 kadr/s videoda 2.5 kadr (≈ 104 ms) + yozib olish kvantlashi.
// captureGapMs: ekran yozuvi (CDP screencast) ba'zan kadr tashlaydi (o'lchangan: odatda 33 ms, ba'zan 100–230 ms). Shunday oraliqdagi
// ikki kadr farqi video nuqsoni emas, yozuv artefakti (bosh va yuz bir vaqtda "sakraydi") — bunday juftliklar hisobga olinmaydi.
// Haqiqiy uzilishni stallMs (video kadrlari vaqti, rVFC) alohida tekshiradi.
const LIMITS = { latencyMs: 110, stallMs: 110, flashPct: 6, captureGapMs: 100 };

// Kadr koordinatalari (1080x1920 asl kadrda) — hudud: [x0, y0, x1, y1]
const REGIONS = { cap: [450, 80, 640, 212], face: [460, 218, 620, 350], body: [300, 420, 780, 1500], all: [300, 60, 780, 1500] };

const server = process.env.TARGET ? null : await preview({ root: FRONT, logLevel: "error", preview: { port: 4177, strictPort: true, host: "127.0.0.1" } });
const URL0 = process.env.TARGET || "http://127.0.0.1:4177/";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADFUL ? false : true,
  defaultViewport: { width: 1280, height: 800 },
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist", ...(process.env.HEADFUL ? ["--mute-audio", "--window-size=1300,900"] : []),
    ...(REAL ? ["--mute-audio"] : []), ...(process.env.MIC_WAV ? ["--use-file-for-fake-audio-capture=" + process.env.MIC_WAV + "%noloop"] : [])],
});
try {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  if (REAL) await page.evaluateOnNewDocument(() => { window.__avatarDbg = []; });
  else await page.evaluateOnNewDocument(() => {
    class FakeWS {
      constructor(url) { this.url = url; this.readyState = 0; this.binaryType = "blob"; window.__ws = this;
        setTimeout(() => { this.readyState = 1; this.onopen?.({}); this.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); }, 300); }
      send() {}
      close() { this.readyState = 3; this.onclose?.({}); }
    }
    FakeWS.OPEN = 1;
    window.WebSocket = FakeWS;
    // segs: [[gapirish_soniya, pauza_soniya], ...] — pauzada chunk yuborilmaydi → pleyer navbati bo'shab, ovoz jim bo'ladi
    window.__speak = (segs) => {
      let at = 0;
      for (const [talk, gap] of segs) {
        setTimeout(() => {
          const rate = 24000, chunk = rate / 4;
          for (let c = 0; c < talk * 4; c++) {
            const pcm = new Int16Array(chunk);
            for (let i = 0; i < chunk; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 220 * (c * chunk + i)) / rate) * 9000);
            window.__ws.onmessage({ data: pcm.buffer });
          }
        }, at * 1000);
        at += talk + gap;
      }
      setTimeout(() => window.__ws.onmessage({ data: JSON.stringify({ type: "turn_complete" }) }), at * 1000);
    };
  });
  await page.goto(URL0, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.querySelectorAll(".rig-face").length === 3 && !!document.querySelector(".rig-greeting") &&
      [...document.querySelectorAll(".rig-face, .rig-greeting")].every((v) => v.readyState >= 3) &&
      [...document.querySelectorAll(".avatar-rig img")].every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 60000 });
  await page.evaluate(() => {
    // 3 ta yuz klipi: idle va gapirish uchun ikki bufer (a, b)
    const faces = document.querySelectorAll(".rig-face");
    // answer — tayyor javob klipi qatlami (o'z ovozi bilan); eski yig'malarda yo'q
    const els = { idle: faces[0], a: faces[1], b: faces[2], greeting: document.querySelector(".rig-greeting"), answer: document.querySelector(".rig-answer") };
    window.__t = { frames: { idle: [], a: [], b: [], greeting: [], answer: [] }, cls: [] };
    for (const [n, v] of Object.entries(els)) {
      if (!v) continue;
      const cb = (now, meta) => { window.__t.frames[n].push([performance.timeOrigin + now, meta.mediaTime]); v.requestVideoFrameCallback(cb); };
      v.requestVideoFrameCallback(cb);
      new MutationObserver(() => window.__t.cls.push([performance.timeOrigin + performance.now(), n, v.className])).observe(v, { attributes: true, attributeFilter: ["class"] });
    }
  });
  const rig = await page.evaluate(() => { const r = document.querySelector(".avatar-rig").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const sc = rig.w / 1080;

  const shots = [];
  // "Suhbatni boshlash/Tugatish" bosilganda sahifa interfeysi o'zgaradi (tugma, holat yozuvi) va avatar bir necha px siljiydi — bu video emas: shu paytdagi juftliklar hisobga olinmaydi
  const clicks = [];
  const clickTalk = async () => { clicks.push(Date.now()); await page.click(".talk"); };
  cdp.on("Page.screencastFrame", async (f) => { shots.push({ t: f.metadata.timestamp * 1000, data: f.data }); await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await new Promise((r) => setTimeout(r, 1200));
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  if (REAL) {
    // haqiqiy suhbat: salom, so'ng MIC_WAV dagi savollar va backend javoblari
    await clickTalk(); await wait(REAL_S);
    await clickTalk(); await wait(1);
  } else {
    // 1-suhbat: qisqa nutq (3 s) → salom 6 s davom etadi → ovoz yo'q → salom → KUTISH
    await clickTalk(); await wait(1.2);
    await page.evaluate(() => window.__speak([[3, 0]])); await wait(10);
    await clickTalk(); await wait(1.5);
    // 2-suhbat: uzun nutq → salom → GAPIRISH, so'ng pauzalar bilan kutish ↔ gapirish, oxirida uzoq kutish (loop choki)
    await clickTalk(); await wait(1.2);
    await page.evaluate(() => window.__speak([[16, 2.2], [3, 2.0], [4, 2.5], [2.5, 2.1], [3, 2.0], [2, 0]])); await wait(46); // pauzalar > 1.5 s: javob davomidagi ushlab turish (VOICE_HOLD_TURN_MS) dan uzun — kutish <-> gapirish o'tishlari sinaladi
    await wait(6); // uzoq kutish: kutish klipi ~4.6 s da loop qiladi
    await clickTalk(); await wait(1);
  }
  await cdp.send("Page.stopScreencast");
  const T = await page.evaluate(() => window.__t);
  const DBG = REAL ? await page.evaluate(() => window.__avatarDbg || []) : [];
  const ORIGIN = await page.evaluate(() => performance.timeOrigin);
  T.frames.speaking = [...T.frames.a, ...T.frames.b].sort((x, y) => x[0] - y[0]); // gapirish — ikkala bufer kadrlari

  // --- kadrlar: har hudud alohida qirqib olinadi (kulrang)
  const rect = ([x0, y0, x1, y1]) => ({ left: Math.round(rig.x + x0 * sc), top: Math.round(rig.y + y0 * sc), width: Math.max(2, Math.round((x1 - x0) * sc)), height: Math.max(2, Math.round((y1 - y0) * sc)) });
  const dec = [];
  // yozib olishning birinchi ~1 s kadrlari beqaror — hisobga olinmaydi
  const warm = shots.length ? shots[0].t + 1000 : 0;
  for (const s of shots.filter((x) => x.t >= warm)) {
    const buf = Buffer.from(s.data, "base64");
    const f = { t: s.t };
    for (const [k, r] of Object.entries(REGIONS)) f[k] = await sharp(buf).extract(rect(r)).grayscale().raw().toBuffer();
    dec.push(f);
  }
  const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  const allPops = dec.slice(1).map((f, i) => ({ t: f.t, dt: f.t - dec[i].t, cap: mad(dec[i].cap, f.cap), face: mad(dec[i].face, f.face), body: mad(dec[i].body, f.body) }));
  const pops = allPops.filter((p) => p.dt <= LIMITS.captureGapMs && !clicks.some((c) => p.t >= c - 50 && p.t <= c + 700));
  const gapSkipped = allPops.filter((p) => p.dt > LIMITS.captureGapMs).length;
  const bright = dec.map((f) => ({ t: f.t, b: f.all.reduce((a, v) => a + v, 0) / f.all.length }));

  // --- ko'rinadigan holat vaqt chizig'i: salom ("on") hammasi ustida, aks holda "on" yuz klipi
  const cur = { idle: "", a: "", b: "", greeting: "", answer: "" };
  const trans = [];
  let state = "idle";
  const on = (c) => /\bon\b/.test(c);
  const stateOf = () => (on(cur.answer) ? "answer" : on(cur.greeting) ? "greeting" : on(cur.a) || on(cur.b) ? "speaking" : "idle");
  const timeline = []; // [t, {idle, a, b, greeting: class}]
  let lastSl = null; // gapirish buferi (a/b): variantdan variantga ulanishni aniqlash uchun
  for (let ci = 0; ci < T.cls.length; ci++) {
    const [t, n, c] = T.cls[ci];
    cur[n] = c;
    timeline.push([t, { ...cur }]);
    // React bitta commitda ikki qatlam klassini o'zgartiradi (eski: out, yangi: on) — MutationObserver ularni alohida yozadi; oraliq holat ekranda bo'lmaydi
    if (ci + 1 < T.cls.length && T.cls[ci + 1][0] - t <= 4) continue;
    const s = stateOf();
    if (s !== state) { trans.push({ t, from: state, to: s, type: `${state} → ${s}` }); state = s; }
    const sl = on(cur.a) ? "a" : on(cur.b) ? "b" : null;
    if (sl && lastSl && sl !== lastSl && state === "speaking") trans.push({ t, from: "speaking", to: "speaking", type: "speaking → speaking (variant)" });
    if (sl) lastSl = sl;
  }
  const classesAt = (t) => { let c = { idle: "", a: "", b: "", greeting: "", answer: "" }; for (const [tt, cc] of timeline) { if (tt <= t + 50) c = cc; else break; } return c; };
  const visible = (n, t) => { const c = classesAt(t)[n]; return n === "greeting" ? /\bon\b/.test(c) || false : true; /* yuz klipi ichida doim ko'rinadi (on/prev yoki 1% tagida) */ };
  const onLayer = (t) => { let s = "idle"; for (const x of trans) { if (x.t <= t) s = x.to; else break; } return s; };
  // loop choki — faqat ekrandagi klip boshiga qaytganda; o'tishdan 600 ms oldin va 1.2 s keyin emas (o'lchash oynasi +450 ms, boshqa o'tish farqi aralashmasin)
  const wraps = [];
  for (const n of ["idle"]) { // gapirish takrorlanmaydi: variantlar ulanadi ("speaking → speaking (variant)" o'tishi)
    const fs_ = T.frames[n];
    for (let i = 1; i < fs_.length; i++) if (fs_[i][1] < fs_[i - 1][1] - 0.5 && onLayer(fs_[i][0]) === n && !trans.some((x) => fs_[i][0] - x.t >= -600 && fs_[i][0] - x.t <= 1200)) wraps.push({ t: fs_[i][0], type: `${n} loop choki`, to: n });
  }
  const allEvents = [...trans, ...wraps].sort((a, b) => a.t - b.t);
  if (process.env.DUMP_DIR) {
    // nosozlikni ko'zdan kechirish uchun: har o'tish atrofidagi kadrlar (-120..+240 ms) JPEG sifatida
    fs.mkdirSync(process.env.DUMP_DIR, { recursive: true });
    allEvents.forEach((e, k) => shots.filter((s) => s.t - e.t >= -120 && s.t - e.t <= 480).forEach((s, j) =>
      fs.writeFileSync(path.join(process.env.DUMP_DIR, `${String(k).padStart(2, "0")}_${e.type.replace(/\W+/g, "_")}_${String(j).padStart(2, "0")}_${Math.round(s.t - e.t)}ms.jpg`), Buffer.from(s.data, "base64"))));
  }
  const near = (t, lo = -700, hi = 900) => allEvents.some((e) => t - e.t >= lo && t - e.t <= hi);
  // salom ustida (qo'l, tana harakatlanadi) oddiy farq o'lchanmaydi
  const inGreeting = (t) => classesAt(t).greeting.includes("on");
  const steady = (k) => pops.filter((p) => !near(p.t) && !inGreeting(p.t)).map((p) => p[k]).sort((a, b) => a - b);
  const p95 = (k) => { const s = steady(k); return s[Math.floor(s.length * 0.95)] ?? 0; };
  // Sakrash xom videoning O'ZIDAGI eng katta oddiy (o'tishsiz) kadrlararo o'zgarishdan keskinroq bo'lmasligi kerak (xom videoda bosh o'zi qimirlaydi,
  // shuning uchun chegara — qo'shimcha emas, shu videoning o'z eng kattasi ×1.15 + 0.5)
  const steadyMax = { cap: 0, face: 0, body: 0 };
  for (const k of Object.keys(steadyMax)) steadyMax[k] = Math.max(0, ...pops.filter((p) => !near(p.t) && !inGreeting(p.t)).map((p) => p[k]));
  const medB = bright.filter((b) => !near(b.t)).map((b) => b.b).sort((a, b) => a - b);
  const medBright = medB[Math.floor(medB.length / 2)];

  // ko'rinib turgan kadrlar: ekrandagi yuz klipi + (bo'lsa) salom — ketma-ket eng uzun oraliq
  const visFrames = [];
  for (const n of ["idle", "a", "b", "greeting", "answer"]) for (const f of T.frames[n]) if (n === "greeting" || n === "answer" ? classesAt(f[0])[n].includes("on") : true) visFrames.push(f[0]);
  visFrames.sort((a, b) => a - b);

  const f1_ = (x) => x.toFixed(1);
  const rows = {};
  for (const e of allEvents) {
    const [a, b] = [e.t - 120, e.t + 450];
    const g = []; for (let i = 1; i < visFrames.length; i++) if (visFrames[i] >= a && visFrames[i] <= b) g.push(visFrames[i] - visFrames[i - 1]);
    const stall = g.length ? Math.max(...g) : 0;
    const first = e.to && T.frames[e.to]?.find((f) => f[0] >= e.t);
    const latency = e.type.includes("loop") || e.type.includes("variant") ? 0 : first ? first[0] - e.t : 999;
    const inWin = (arr) => arr.filter((p) => p.t >= a && p.t <= b);
    const mx = (k) => Math.max(0, ...inWin(pops).map((p) => p[k]));
    // qorayish chaqnashi: oyna ichidagi eng qorong'i payt, o'tishdan oldingi (-700..-300 ms) va keyingi (+600..+1000 ms) yorqinlikning kichigiga nisbatan
    const meanB = (lo, hi) => { const v = bright.filter((p) => p.t >= e.t + lo && p.t <= e.t + hi).map((p) => p.b); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };
    const ref = Math.min(meanB(-700, -300), meanB(600, 1000));
    const dips = inWin(bright).map((p) => ((p.b - ref) / ref) * 100).filter(Number.isFinite);
    const dip = dips.length ? Math.min(0, ...dips) : 0;
    // VERBOSE + DUMP_DIR: eng katta tana farqi chiqqan juftlik (oldingi/keyingi kadr) alohida saqlanadi — sabab ko'z bilan ko'rilsin
    if (process.env.VERBOSE && process.env.DUMP_DIR) {
      const bp = inWin(pops).reduce((m, q) => (q.body > m.body ? q : m), { body: -1 });
      if (bp.body > 0 && bp.body > steadyMax.body * 1.15 + 0.5) {
        const after = shots.find((x) => x.t === bp.t), before = shots.filter((x) => x.t < bp.t).pop();
        fs.mkdirSync(process.env.DUMP_DIR, { recursive: true });
        if (after && before) { const k = e.type.replace(/\W+/g, "_") + "_" + Math.round(e.t % 100000); fs.writeFileSync(path.join(process.env.DUMP_DIR, `PEAK_${k}_a.jpg`), Buffer.from(before.data, "base64")); fs.writeFileSync(path.join(process.env.DUMP_DIR, `PEAK_${k}_b.jpg`), Buffer.from(after.data, "base64")); console.log(`    PEAK ${e.type}: body ${f1_(bp.body)} dt ${Math.round(bp.dt)} ms at ${Math.round(bp.t - e.t)} ms -> ${k}`); }
      }
    }
    const capPeak = inWin(pops).reduce((m, p) => (p.cap > m.cap ? p : m), { cap: -1, t: e.t });
    (rows[e.type] ||= []).push({ latency, stall, cap: mx("cap"), face: mx("face"), body: mx("body"), dip, capOff: capPeak.t - e.t, capDt: capPeak.dt ?? 0 });
  }
  const f1 = (x) => x.toFixed(1);
  const base = { cap: p95("cap"), face: p95("face"), body: p95("body") };
  console.log(`CPU ${THROTTLE}x | kadr yozildi ${shots.length} | oddiy kadrlararo farq p95: furajka/soch ${f1(base.cap)}, yuz ${f1(base.face)}, tana ${f1(base.body)}; eng katta: ${f1(steadyMax.cap)} / ${f1(steadyMax.face)} / ${f1(steadyMax.body)} | yorqinlik mediana ${f1(medBright)}`);
  console.log(`yozuvda kadr tushgan oraliqlar (> ${LIMITS.captureGapMs} ms) hisobga olinmadi: ${gapSkipped} / ${allPops.length}`);
  console.log(`chegaralar: kechikish ≤ ${LIMITS.latencyMs} ms, qotish ≤ ${LIMITS.stallMs} ms, sakrash (furajka/soch, yuz, tana) ≤ shu videoning eng katta oddiy qadami ×1.15+0.5, qorayish chaqnashi ≤ ${LIMITS.flashPct}%`);
  console.log("o'tish                    soni  kechikish  qotish  furajka/soch  yuz   tana  qorayish   natija");
  let bad = 0;
  for (const [type, arr] of Object.entries(rows)) {
    const w = (k) => Math.max(...arr.map((r) => r[k]));
    const dipW = Math.min(...arr.map((r) => r.dip));
    const isGreet = type.includes("greeting");
    // salom o'tishlarida tananing o'zi harakatlanadi (qo'l ko'tariladi): u yerda tana farqi faqat kuzatiladi
    // tana: kutish klipi nafas olganda jaket ±1.5–1.8 px siljiydi, kirishdagi 200 ms xira-o'tishda bir kadrda ~3 gacha farq beradi (o'lchangan) — taglik 3.5
    const lim = (k) => Math.max(steadyMax[k] * 1.15 + 0.5, k === "body" ? 3.5 : 0);
    // kutish -> salom: qo'l o'tishdan keyingi 0.25-0.75 s da ko'tariladi, yelka/tirsak orqa fonga chiqadi — sahna yorqinligi HAQIQATAN tushadi (xira-o'tishning o'zi
    // qorayish bera olmaydi: yuqori qatlam ostidagi qatlam bilan aralashadi). Shuning uchun bu turda chegara kengroq.
    const flashLim = isGreet && type.startsWith("idle") ? 9 : LIMITS.flashPct;
    const ok = w("latency") <= LIMITS.latencyMs && w("stall") <= LIMITS.stallMs && -dipW <= flashLim &&
      w("cap") <= lim("cap") && w("face") <= lim("face") && (isGreet || w("body") <= lim("body"));
    if (!ok) bad++;
    // VERBOSE=1: har o'tish alohida (furajka/soch farqi eng katta bo'lgan payt o'tishga nisbatan, ms) — nosozlikni o'tishdan oldin/keyin ajratish uchun
    if (process.env.VERBOSE) for (const r of arr) console.log(`    · ${type}: furajka/soch ${f1(r.cap)} (${Math.round(r.capOff)} ms, yozuv oralig'i ${Math.round(r.capDt)} ms), yuz ${f1(r.face)}, tana ${f1(r.body)}`);
    console.log(`${type.padEnd(25)} ${String(arr.length).padStart(3)}  ${f1(w("latency")).padStart(8)}  ${f1(w("stall")).padStart(6)}  ${f1(w("cap")).padStart(12)}  ${f1(w("face")).padStart(4)}  ${f1(w("body")).padStart(5)}  ${f1(dipW).padStart(7)}%   ${ok ? "O'TDI" : "O'TMADI"}`);
  }


  if (REAL) {
    const ex = DBG.filter((e) => e.ev === "exit"), fb = DBG.filter((e) => e.ev === "exit-fallback");
    const errs = DBG.filter((e) => e.ev === "ws-error");
    const rel = (t) => ((t - clicks[0]) / 1000).toFixed(1);
    console.log("ketma-ketlik: " + [...allEvents.filter((e) => !e.type.includes("loop")).map((e) => [e.t, e.type]), ...DBG.filter((e) => ["exit", "exit-fallback", "pausehold"].includes(e.ev)).map((e) => [ORIGIN + e.at, "[" + e.ev + (e.sw ? "+almashdi" : "") + "]"])].sort((x, y) => x[0] - y[0]).map(([t, n]) => rel(t) + " " + n).join("; "));
    console.log(`haqiqiy suhbat: tayyor javob klipi ${allEvents.filter((e) => e.type === "idle → answer").length} ta, erkin javob ${allEvents.filter((e) => e.type === "idle → speaking").length} ta | gap oxiri: ovozga to'g'rilangan ${ex.length}, kutib chiqilgan ${fb.length}${fb.length ? ` (eng uzun kutish ${Math.round(Math.max(...fb.map((e) => e.waited)))} ms, yopiq kadrda ${fb.filter((e) => e.hold).length})` : ""} | pauzada to'xtash ${DBG.filter((e) => e.ev === "pausehold").length} (shundan variant almashdi ${DBG.filter((e) => e.ev === "pausehold" && e.sw).length})${errs.length ? ` | XATO: ${errs.length}` : ""}`);
  }
  console.log(`\nJAMI: ${Object.keys(rows).length} tur, ${allEvents.length} o'tish, o'tmagan tur/tekshiruv: ${bad}`);
  process.exitCode = bad ? 1 : 0;
} finally {
  await browser.close();
  if (server) await new Promise((r) => server.httpServer.close(r));
}
