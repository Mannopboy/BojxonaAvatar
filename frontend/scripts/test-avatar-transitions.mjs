// Avatar videolari orasidagi HAR BIR o'tishni brauzerda o'lchaydi (soxta Gemini oqimi, haqiqiy Chrome, yig'ilgan `dist`):
//   salom → kutish, salom → gapirish, kutish → salom, kutish ↔ gapirish, loop chokilari (kutish, gapirish).
// Har o'tish uchun: yangi qatlamning birinchi kadri qancha kechikdi, ko'rinib turgan kadrlar orasida eng uzun to'xtash (qotish),
// ekrandagi sakrash (qo'shni kadrlar farqi: furajka/soch, yuz, tana alohida) va yorqinlik tushishi (qorayish).
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
// Chegaralar (o'lchangan shovqin ustiga zaxira bilan): kadr oralig'i 41.7 ms
const LIMITS = { latencyMs: 90, stallMs: 110, bodyPop: 2.5, capPop: 2.5, dipPct: 6 };

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
  await page.waitForFunction(() => document.querySelectorAll(".avatar-layer").length === 3 && Array.from(document.querySelectorAll(".avatar-layer")).every((v) => v.readyState >= 3), { timeout: 60000 });
  await page.evaluate(() => {
    const names = ["idle", "speaking", "greeting"];
    window.__t = { frames: { idle: [], speaking: [], greeting: [] }, cls: [] };
    Array.from(document.querySelectorAll(".avatar-layer")).forEach((v, i) => {
      const n = names[i];
      const cb = (now, meta) => { window.__t.frames[n].push([performance.timeOrigin + now, meta.mediaTime]); v.requestVideoFrameCallback(cb); };
      v.requestVideoFrameCallback(cb);
      new MutationObserver(() => window.__t.cls.push([performance.timeOrigin + performance.now(), n, v.className])).observe(v, { attributes: true, attributeFilter: ["class"] });
    });
  });

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
  await wait(6); // uzoq kutish: kutish klipi 4 s da loop qiladi
  await page.click(".talk"); await wait(1);
  await cdp.send("Page.stopScreencast");
  const T = await page.evaluate(() => window.__t);

  // --- kadrlar: figura (x 440..840, y 80..660) uch hududda: furajka/soch (tepa), yuz, tana
  const W = 400;
  const REG = { cap: [0, 58], face: [58, 118], body: [124, 580] };
  const dec = [];
  // yozib olishning birinchi ~1 s kadrlari beqaror (masshtab o'zgaradi) — hisobga olinmaydi
  const warm = shots.length ? shots[0].t + 1000 : 0;
  for (const s of shots.filter((x) => x.t >= warm)) {
    const raw = await sharp(Buffer.from(s.data, "base64")).extract({ left: 440, top: 80, width: W, height: 580 }).grayscale().raw().toBuffer();
    dec.push({ t: s.t, raw });
  }
  const diff = (a, b, [r0, r1]) => { let s = 0; for (let i = r0 * W; i < r1 * W; i++) s += Math.abs(a[i] - b[i]); return s / ((r1 - r0) * W); };
  const pops = dec.slice(1).map((f, i) => ({ t: f.t, cap: diff(dec[i].raw, f.raw, REG.cap), face: diff(dec[i].raw, f.raw, REG.face), body: diff(dec[i].raw, f.raw, REG.body) }));
  const bright = dec.map((f) => ({ t: f.t, b: f.raw.reduce((a, v) => a + v, 0) / f.raw.length }));

  // --- o'tishlar: qaysi qatlam "on" bo'ldi (oldingi "on" → yangi "on")
  const trans = [];
  let cur = "idle";
  for (const [t, n, c] of T.cls) {
    if (/\bon\b/.test(c) && n !== cur) { trans.push({ t, from: cur, to: n, type: `${cur} → ${n}` }); cur = n; }
  }
  // --- loop choki: ko'rinib turgan qatlamda mediaTime kamaygan paytlar
  const visible = (n, t) => { let on = false; for (const [tt, nn, c] of T.cls) { if (nn === n && tt <= t + 50) on = /\bon\b|\bprev\b/.test(c); } return on; };
  // hozir EKRANDAGI (on) qatlam: o'tishlar ro'yxatidan
  const onLayer = (t) => { let cur = "idle"; for (const x of trans) { if (x.t <= t) cur = x.to; else break; } return cur; };
  // loop choki — faqat ekrandagi (on) klip boshiga qaytganda; boshqa qatlamni boshiga qaytarish (to'xtatish) ekranda ko'rinmaydi
  const wraps = [];
  for (const n of ["idle", "speaking"]) {
    const fs_ = T.frames[n];
    for (let i = 1; i < fs_.length; i++) if (fs_[i][1] < fs_[i - 1][1] - 0.5 && onLayer(fs_[i][0]) === n && !trans.some((x) => fs_[i][0] - x.t >= -100 && fs_[i][0] - x.t <= 600)) wraps.push({ t: fs_[i][0], type: `${n} loop choki`, to: n });
  }
  const allEvents = [...trans, ...wraps].sort((a, b) => a.t - b.t);
  if (process.env.DUMP_DIR) {
    // nosozlikni ko'zdan kechirish uchun: har o'tish atrofidagi kadrlar (-120..+240 ms) JPEG sifatida
    fs.mkdirSync(process.env.DUMP_DIR, { recursive: true });
    allEvents.forEach((e, k) => shots.filter((s) => s.t - e.t >= -120 && s.t - e.t <= 240).forEach((s, j) =>
      fs.writeFileSync(path.join(process.env.DUMP_DIR, `${String(k).padStart(2, "0")}_${e.type.replace(/\W+/g, "_")}_${String(j).padStart(2, "0")}_${Math.round(s.t - e.t)}ms.jpg`), Buffer.from(s.data, "base64"))));
  }
  const near = (t, lo = -700, hi = 900) => allEvents.some((e) => t - e.t >= lo && t - e.t <= hi);
  const steady = (k) => pops.filter((p) => !near(p.t)).map((p) => p[k]).sort((a, b) => a - b);
  const p95 = (k) => { const s = steady(k); return s[Math.floor(s.length * 0.95)] ?? 0; };
  const medB = bright.filter((b) => !near(b.t)).map((b) => b.b).sort((a, b) => a - b);
  const medBright = medB[Math.floor(medB.length / 2)];

  // ko'rinib turgan kadrlar (ikkala qatlam, on/prev): ketma-ket eng uzun oraliq
  const visFrames = [];
  for (const n of Object.keys(T.frames)) for (const f of T.frames[n]) if (visible(n, f[0])) visFrames.push(f[0]);
  visFrames.sort((a, b) => a - b);

  const rows = {};
  for (const e of allEvents) {
    const win = (lo, hi) => [e.t + lo, e.t + hi];
    const [a, b] = win(-120, 450);
    const g = []; for (let i = 1; i < visFrames.length; i++) if (visFrames[i] >= a && visFrames[i] <= b) g.push(visFrames[i] - visFrames[i - 1]);
    const stall = g.length ? Math.max(...g) : 0;
    const first = e.to && T.frames[e.to]?.find((f) => f[0] >= e.t);
    const latency = e.type.includes("loop") ? 0 : first ? first[0] - e.t : 999;
    const inWin = (arr) => arr.filter((p) => p.t >= a && p.t <= b);
    const mx = (k) => Math.max(0, ...inWin(pops).map((p) => p[k]));
    const dips = inWin(bright).map((p) => ((p.b - medBright) / medBright) * 100);
    const dip = dips.length ? Math.min(0, ...dips) : 0;
    (rows[e.type] ||= []).push({ latency, stall, cap: mx("cap"), face: mx("face"), body: mx("body"), dip });
  }
  const f1 = (x) => x.toFixed(1);
  console.log(`CPU ${THROTTLE}x | kadr yozildi ${shots.length} | oddiy kadrlararo farq p95: furajka/soch ${f1(p95("cap"))}, yuz ${f1(p95("face"))}, tana ${f1(p95("body"))} | yorqinlik mediana ${f1(medBright)}`);
  console.log(`chegaralar: kechikish ≤ ${LIMITS.latencyMs} ms, qotish ≤ ${LIMITS.stallMs} ms, furajka/soch va tana sakrashi ≤ ${LIMITS.capPop}, qorayish ≤ ${LIMITS.dipPct}%\n`);
  console.log("o'tish                    soni  kechikish  qotish  furajka/soch  yuz   tana  qorayish   natija");
  let bad = 0;
  for (const [type, arr] of Object.entries(rows)) {
    const w = (k) => Math.max(...arr.map((r) => r[k]));
    const dipW = Math.min(...arr.map((r) => r.dip));
    const ok = w("latency") <= LIMITS.latencyMs && w("stall") <= LIMITS.stallMs && w("cap") <= LIMITS.capPop && w("body") <= LIMITS.bodyPop && -dipW <= LIMITS.dipPct;
    if (!ok) bad++;
    console.log(`${type.padEnd(25)} ${String(arr.length).padStart(3)}  ${f1(w("latency")).padStart(8)}  ${f1(w("stall")).padStart(6)}  ${f1(w("cap")).padStart(12)}  ${f1(w("face")).padStart(4)}  ${f1(w("body")).padStart(5)}  ${f1(dipW).padStart(7)}%   ${ok ? "O'TDI" : "O'TMADI"}`);
  }
  console.log(`\nJAMI: ${Object.keys(rows).length} tur, ${allEvents.length} o'tish, o'tmagan tur: ${bad}`);
  process.exitCode = bad ? 1 : 0;
} finally {
  await browser.close();
  if (server) await new Promise((r) => server.httpServer.close(r));
}
