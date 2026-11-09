// Avatar qatlamlari orasidagi HAR BIR o'tishni brauzerda o'lchaydi (soxta Gemini oqimi, haqiqiy Chrome, yig'ilgan `dist`):
//   salom ↔ kutish, salom → gapirish, kutish ↔ gapirish, yuz klipi loop chokilari (kutish, gapirish).
// Har o'tish uchun: yangi qatlamning birinchi kadri qancha kechikdi, ko'rinib turgan kadrlar orasida eng uzun to'xtash (qotish),
// ekrandagi sakrash (qo'shni kadrlar farqi: furajka/soch, yuz, tana alohida) va yorqinlik tushishi (qorayish).
// Qo'shimcha: bosh harakati (tinch holatda jonli, gapirganda kattaroq, salomda qotgan, hamma vaqt silliq).
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
// Chegaralar (o'lchangan shovqin ustiga zaxira bilan): kadr oralig'i 41.7 ms.
// capPop/bodyPop — o'tish paytidagi eng katta kadrlararo farq, oddiy (o'tishsiz) p95 ustiga qo'shimcha: bosh doim qimirlaydi,
// shuning uchun absolyut emas, nisbiy.
// latencyMs = stallMs: ikkalasi ham "kadr uzilishi"ni o'lchaydi; 24 kadr/s videoda 2.5 kadr (≈ 104 ms) + yozib olish kvantlashi.
// captureGapMs: ekran yozuvi (CDP screencast) ba'zan kadr tashlaydi (o'lchangan: odatda 33 ms, ba'zan 100–230 ms). Shunday oraliqdagi
// ikki kadr farqi video nuqsoni emas, yozuv artefakti (bosh va yuz bir vaqtda "sakraydi") — bunday juftliklar hisobga olinmaydi.
// Haqiqiy uzilishni stallMs (video kadrlari vaqti, rVFC) alohida tekshiradi.
const LIMITS = { latencyMs: 110, stallMs: 110, capExtra: 1.5, bodyExtra: 1.5, dipPct: 6, captureGapMs: 100 };

// Kadr koordinatalari (1080x1920 asl kadrda) — hudud: [x0, y0, x1, y1]
const REGIONS = { cap: [450, 80, 640, 212], face: [460, 218, 620, 350], body: [300, 420, 780, 1500], all: [300, 60, 780, 1500] };

const server = process.env.TARGET ? null : await preview({ root: FRONT, logLevel: "error", preview: { port: 4177, strictPort: true, host: "127.0.0.1" } });
const URL0 = process.env.TARGET || "http://127.0.0.1:4177/";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADFUL ? false : true,
  defaultViewport: { width: 1280, height: 800 },
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist", ...(process.env.HEADFUL ? ["--mute-audio", "--window-size=1300,900"] : [])],
});
try {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await page.evaluateOnNewDocument(() => {
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
    () => document.querySelectorAll(".rig-face").length === 2 && !!document.querySelector(".rig-greeting") &&
      [...document.querySelectorAll(".rig-face, .rig-greeting")].every((v) => v.readyState >= 3) &&
      [...document.querySelectorAll(".avatar-rig img")].every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 60000 });
  await page.evaluate(() => {
    const els = { idle: document.querySelectorAll(".rig-face")[0], speaking: document.querySelectorAll(".rig-face")[1], greeting: document.querySelector(".rig-greeting") };
    window.__t = { frames: { idle: [], speaking: [], greeting: [] }, cls: [], pose: [] };
    for (const [n, v] of Object.entries(els)) {
      const cb = (now, meta) => { window.__t.frames[n].push([performance.timeOrigin + now, meta.mediaTime]); v.requestVideoFrameCallback(cb); };
      v.requestVideoFrameCallback(cb);
      new MutationObserver(() => window.__t.cls.push([performance.timeOrigin + performance.now(), n, v.className])).observe(v, { attributes: true, attributeFilter: ["class"] });
    }
    // boshning haqiqiy transformi (JS qo'ygan) har animatsiya kadrida
    const head = document.querySelector(".rig-head");
    const sample = () => {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) rotate\(([-\d.]+)deg\)/.exec(head.style.transform || "");
      if (m) window.__t.pose.push([performance.timeOrigin + performance.now(), +m[1], +m[2], +m[3]]);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const rig = await page.evaluate(() => { const r = document.querySelector(".avatar-rig").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const sc = rig.w / 1080;

  const shots = [];
  cdp.on("Page.screencastFrame", async (f) => { shots.push({ t: f.metadata.timestamp * 1000, data: f.data }); await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await new Promise((r) => setTimeout(r, 1200));
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  // 1-suhbat: qisqa nutq (3 s) → salom 6 s davom etadi → ovoz yo'q → salom → KUTISH
  await page.click(".talk"); await wait(1.2);
  await page.evaluate(() => window.__speak([[3, 0]])); await wait(10);
  await page.click(".talk"); await wait(1.5);
  // 2-suhbat: uzun nutq → salom → GAPIRISH, so'ng pauzalar bilan kutish ↔ gapirish, oxirida uzoq kutish (loop choki)
  await page.click(".talk"); await wait(1.2);
  await page.evaluate(() => window.__speak([[10.5, 1.0], [3, 0.9], [4, 1.5], [2.5, 0.8], [3, 0.7], [2, 0]])); await wait(31);
  await wait(6); // uzoq kutish: kutish klipi ~4.6 s da loop qiladi
  await page.click(".talk"); await wait(1);
  await cdp.send("Page.stopScreencast");
  const T = await page.evaluate(() => window.__t);

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
  const pops = allPops.filter((p) => p.dt <= LIMITS.captureGapMs);
  const gapSkipped = allPops.length - pops.length;
  const bright = dec.map((f) => ({ t: f.t, b: f.all.reduce((a, v) => a + v, 0) / f.all.length }));

  // --- ko'rinadigan holat vaqt chizig'i: salom ("on") hammasi ustida, aks holda "on" yuz klipi
  const cur = { idle: "", speaking: "", greeting: "" };
  const trans = [];
  let state = "idle";
  const stateOf = () => (/\bon\b/.test(cur.greeting) ? "greeting" : /\bon\b/.test(cur.speaking) ? "speaking" : "idle");
  const timeline = []; // [t, {idle:cls, speaking:cls, greeting:cls}]
  for (const [t, n, c] of T.cls) {
    cur[n] = c;
    timeline.push([t, { ...cur }]);
    const s = stateOf();
    if (s !== state) { trans.push({ t, from: state, to: s, type: `${state} → ${s}` }); state = s; }
  }
  const classesAt = (t) => { let c = { idle: "", speaking: "", greeting: "" }; for (const [tt, cc] of timeline) { if (tt <= t + 50) c = cc; else break; } return c; };
  const visible = (n, t) => { const c = classesAt(t)[n]; return n === "greeting" ? /\bon\b/.test(c) || false : true; /* yuz klipi ichida doim ko'rinadi (on/prev yoki 1% tagida) */ };
  const onLayer = (t) => { let s = "idle"; for (const x of trans) { if (x.t <= t) s = x.to; else break; } return s; };
  // loop choki — faqat ekrandagi yuz klipi boshiga qaytganda (salom ustida bo'lsa ko'rinmaydi)
  const wraps = [];
  for (const n of ["idle", "speaking"]) {
    const fs_ = T.frames[n];
    for (let i = 1; i < fs_.length; i++) if (fs_[i][1] < fs_[i - 1][1] - 0.5 && onLayer(fs_[i][0]) === n && !trans.some((x) => fs_[i][0] - x.t >= -100 && fs_[i][0] - x.t <= 1200)) wraps.push({ t: fs_[i][0], type: `${n} loop choki`, to: n });
  }
  const allEvents = [...trans, ...wraps].sort((a, b) => a.t - b.t);
  if (process.env.DUMP_DIR) {
    // nosozlikni ko'zdan kechirish uchun: har o'tish atrofidagi kadrlar (-120..+240 ms) JPEG sifatida
    fs.mkdirSync(process.env.DUMP_DIR, { recursive: true });
    allEvents.forEach((e, k) => shots.filter((s) => s.t - e.t >= -120 && s.t - e.t <= 240).forEach((s, j) =>
      fs.writeFileSync(path.join(process.env.DUMP_DIR, `${String(k).padStart(2, "0")}_${e.type.replace(/\W+/g, "_")}_${String(j).padStart(2, "0")}_${Math.round(s.t - e.t)}ms.jpg`), Buffer.from(s.data, "base64"))));
  }
  const near = (t, lo = -700, hi = 900) => allEvents.some((e) => t - e.t >= lo && t - e.t <= hi);
  // salom ustida (qo'l, tana harakatlanadi) oddiy farq o'lchanmaydi
  const inGreeting = (t) => classesAt(t).greeting.includes("on");
  const steady = (k) => pops.filter((p) => !near(p.t) && !inGreeting(p.t)).map((p) => p[k]).sort((a, b) => a - b);
  const p95 = (k) => { const s = steady(k); return s[Math.floor(s.length * 0.95)] ?? 0; };
  // loop choki yuzda oddiy (o'tishsiz) harakatdan keskinroq bo'lmasligi kerak: shu holatdagi eng katta kadrlararo yuz farqi bilan solishtiriladi
  const steadyFaceMax = {};
  for (const s of ["idle", "speaking"]) steadyFaceMax[s] = Math.max(0, ...pops.filter((p) => !near(p.t) && !inGreeting(p.t) && onLayer(p.t) === s).map((p) => p.face));
  const medB = bright.filter((b) => !near(b.t)).map((b) => b.b).sort((a, b) => a - b);
  const medBright = medB[Math.floor(medB.length / 2)];

  // ko'rinib turgan kadrlar: ekrandagi yuz klipi + (bo'lsa) salom — ketma-ket eng uzun oraliq
  const visFrames = [];
  for (const n of Object.keys(T.frames)) for (const f of T.frames[n]) if (n === "greeting" ? classesAt(f[0]).greeting.includes("on") : true) visFrames.push(f[0]);
  visFrames.sort((a, b) => a - b);

  const rows = {};
  for (const e of allEvents) {
    const [a, b] = [e.t - 120, e.t + 450];
    const g = []; for (let i = 1; i < visFrames.length; i++) if (visFrames[i] >= a && visFrames[i] <= b) g.push(visFrames[i] - visFrames[i - 1]);
    const stall = g.length ? Math.max(...g) : 0;
    const first = e.to && T.frames[e.to]?.find((f) => f[0] >= e.t);
    const latency = e.type.includes("loop") ? 0 : first ? first[0] - e.t : 999;
    const inWin = (arr) => arr.filter((p) => p.t >= a && p.t <= b);
    const mx = (k) => Math.max(0, ...inWin(pops).map((p) => p[k]));
    const dips = inWin(bright).map((p) => ((p.b - medBright) / medBright) * 100);
    const dip = dips.length ? Math.min(0, ...dips) : 0;
    const capPeak = inWin(pops).reduce((m, p) => (p.cap > m.cap ? p : m), { cap: -1, t: e.t });
    (rows[e.type] ||= []).push({ latency, stall, cap: mx("cap"), face: mx("face"), body: mx("body"), dip, capOff: capPeak.t - e.t, capDt: capPeak.dt ?? 0 });
  }
  const f1 = (x) => x.toFixed(1);
  const base = { cap: p95("cap"), face: p95("face"), body: p95("body") };
  console.log(`CPU ${THROTTLE}x | kadr yozildi ${shots.length} | oddiy kadrlararo farq p95: furajka/soch ${f1(base.cap)}, yuz ${f1(base.face)}, tana ${f1(base.body)} | yorqinlik mediana ${f1(medBright)}`);
  console.log(`yozuvda kadr tushgan oraliqlar (> ${LIMITS.captureGapMs} ms) hisobga olinmadi: ${gapSkipped} / ${allPops.length}`);
  console.log(`chegaralar: kechikish ≤ ${LIMITS.latencyMs} ms, qotish ≤ ${LIMITS.stallMs} ms, furajka/soch ≤ oddiy+${LIMITS.capExtra}, tana ≤ oddiy+${LIMITS.bodyExtra}, qorayish ≤ ${LIMITS.dipPct}%`);
  console.log(`loop choki yuz farqi ≤ shu holatdagi oddiy eng katta farq ×1.15: kutish ${f1(steadyFaceMax.idle)}, gapirish ${f1(steadyFaceMax.speaking)}\n`);
  console.log("o'tish                    soni  kechikish  qotish  furajka/soch  yuz   tana  qorayish   natija");
  let bad = 0;
  for (const [type, arr] of Object.entries(rows)) {
    const w = (k) => Math.max(...arr.map((r) => r[k]));
    const dipW = Math.min(...arr.map((r) => r.dip));
    const isGreet = type.includes("greeting");
    // salom o'tishlarida tananing o'zi harakatlanadi (qo'l ko'tariladi): u yerda tana/furajka farqi faqat kuzatiladi
    const ok = w("latency") <= LIMITS.latencyMs && w("stall") <= LIMITS.stallMs && -dipW <= LIMITS.dipPct &&
      (isGreet || (w("cap") <= base.cap + LIMITS.capExtra && w("body") <= base.body + LIMITS.bodyExtra)) &&
      (!type.includes("loop") || w("face") <= steadyFaceMax[type.split(" ")[0]] * 1.15 + 0.5);
    if (!ok) bad++;
    // VERBOSE=1: har o'tish alohida (furajka/soch farqi eng katta bo'lgan payt o'tishga nisbatan, ms) — nosozlikni o'tishdan oldin/keyin ajratish uchun
    if (process.env.VERBOSE) for (const r of arr) console.log(`    · ${type}: furajka/soch ${f1(r.cap)} (${Math.round(r.capOff)} ms, yozuv oralig'i ${Math.round(r.capDt)} ms), yuz ${f1(r.face)}, tana ${f1(r.body)}`);
    console.log(`${type.padEnd(25)} ${String(arr.length).padStart(3)}  ${f1(w("latency")).padStart(8)}  ${f1(w("stall")).padStart(6)}  ${f1(w("cap")).padStart(12)}  ${f1(w("face")).padStart(4)}  ${f1(w("body")).padStart(5)}  ${f1(dipW).padStart(7)}%   ${ok ? "O'TDI" : "O'TMADI"}`);
  }

  // --- bosh harakati: tinch holatda jonli, gapirganda kattaroq, salomda qotgan, doim silliq
  const P = T.pose.filter((p) => p[0] >= warm);
  const rangeOf = (arr) => (arr.length ? Math.max(...arr.map((p) => Math.abs(p[3]))) : 0);
  const stateAt = (t) => (inGreeting(t) ? "greeting" : onLayer(t));
  // Salom tugaganda pleyer boshni qaytarishni (0.25 s silliq) oxirgi kadrlardan boshlaydi — sinov sinfi ozgina keyin o'zgaradi: oxirgi 200 ms hisobga olinmaydi
  const during = (s, margin = 600) => P.filter((p) => stateAt(p[0]) === s && stateAt(p[0] - margin) === s && stateAt(p[0] + 200) === s);
  const poseRows = [
    ["tinch (kutish)", rangeOf(during("idle")), (v) => v > 0.06 && v < 0.3, "0.06–0.3°"],
    ["gapirish", rangeOf(during("speaking")), (v) => v > 0.2 && v < 0.8, "0.2–0.8°"],
    ["salom (qotgan)", rangeOf(during("greeting", 700)), (v) => v < 0.02, "< 0.02°"],
  ];
  let jump = 0;
  for (let i = 1; i < P.length; i++) { const dt = Math.max(1, P[i][0] - P[i - 1][0]); jump = Math.max(jump, (Math.abs(P[i][3] - P[i - 1][3]) / dt) * 16.7); }
  poseRows.push(["silliqlik (eng katta sakrash/kadr)", jump, (v) => v < 0.06, "< 0.06°/kadr"]);
  console.log("\nbosh harakati                              o'lchandi   chegara      natija");
  for (const [name, v, test, lim] of poseRows) {
    const ok = test(v);
    if (!ok) bad++;
    console.log(`${name.padEnd(42)} ${v.toFixed(2).padStart(7)}°   ${lim.padEnd(11)}  ${ok ? "O'TDI" : "O'TMADI"}`);
  }

  console.log(`\nJAMI: ${Object.keys(rows).length} tur, ${allEvents.length} o'tish, o'tmagan tur/tekshiruv: ${bad}`);
  process.exitCode = bad ? 1 : 0;
} finally {
  await browser.close();
  if (server) await new Promise((r) => server.httpServer.close(r));
}
