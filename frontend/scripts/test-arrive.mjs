// Yurib kelish (arrive.mp4) brauzer testi — yig'ilgan `dist` + soxta WebSocket (backend va Gemini kerak emas), har sahnada alohida Chrome:
//   npm run build && node scripts/test-arrive.mjs          (TARGET=url — tayyor sayt; CHROME_PATH; HEADFUL=1)
//
//  A) yoqilgan (standart): kutishda avatar KO'RINIB TURADI, lekin biroz uzoqroq va xira (.avatar-stage.far: masshtab ~0.79, yorqinlik 0.4); tugma bosilgach yaqinlashish klipi darhol `.on`
//     (avatar oddiy ko'rinishga o'tadi); salom videosi klip TUGAGACH boshlanadi (klip davomiyligiga mos, ~1.4 s); salom OVOZI salom videosidan GREETING_SPEECH_START_S - 0.05 s keyin
//     (video bilan sinxron); tugatilganda avatar yana kutish ko'rinishiga (uzoqroq, xira) qaytadi.
//  B) ?arrive=0: klip DOMda yo'q, avatar kutishda ham oddiy ko'rinishda (far yo'q), salom eski tartibda (birinchi ovozdan keyin darhol).
//  C) klip yuklanmaydi (so'rov bloklanadi): ~1.5 s ichida eski tartibga qaytadi — avatar yaqinlashadi, salom boshlanadi, suhbat qotib qolmaydi.
//  D) tayyor javob klipi yaqinlashish paytida kelsa — klip tugagach boshlanadi.
// Chiqish kodi 0 — hamma tekshiruv o'tdi.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(FRONT, "package.json"));
const puppeteer = require("puppeteer-core");
const { preview } = require("vite");
const CHROME =
  process.env.CHROME_PATH ||
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
const clips = JSON.parse(fs.readFileSync(path.join(FRONT, "src", "avatarClips.json"), "utf8"));
const GREET_DELAY_S = Math.max(0, (clips.greeting?.speechStart ?? 0) - 0.05); // App.tsx: greetDelayS

const server = process.env.TARGET ? null : await preview({ root: FRONT, logLevel: "error", preview: { port: 4178, strictPort: true, host: "127.0.0.1" } });
const BASE = (process.env.TARGET || "http://127.0.0.1:4178/").replace(/\?.*$/, "");

let failed = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) failed++;
  console.log(`  ${cond ? "O'TDI  " : "O'TMADI"} ${name}${extra ? "  — " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scenario(name, query, { blockArrive = false, clip = false } = {}) {
  console.log(`\n=== ${name}  ${query}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.HEADFUL ? false : true,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--ignore-gpu-blocklist"],
  });
  const R = {};
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(m.text()));
    if (blockArrive) {
      await page.setRequestInterception(true);
      page.on("request", (r) => (r.url().includes("/avatar/approach.mp4") ? r.abort("failed") : r.continue()));
    }
    await page.evaluateOnNewDocument(() => {
      class FakeWS {
        constructor(url) { this.url = url; this.readyState = 0; this.binaryType = "blob"; window.__ws = this;
          setTimeout(() => { this.readyState = 1; this.onopen?.({}); this.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); }, 300); }
        send() {}
        close() { this.readyState = 3; this.onclose?.({}); }
      }
      FakeWS.OPEN = 1;
      window.WebSocket = FakeWS;
      // birinchi audio (salom) — qisqa nutq (turn_complete bilan)
      window.__speak = (sec) => {
        const rate = 24000, chunk = rate / 4;
        for (let c = 0; c < sec * 4; c++) {
          const pcm = new Int16Array(chunk);
          for (let i = 0; i < chunk; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 220 * (c * chunk + i)) / rate) * 9000);
          window.__ws.onmessage({ data: pcm.buffer });
        }
        window.__ws.onmessage({ data: JSON.stringify({ type: "turn_complete" }) });
      };
      window.__ev = [];
      const log = (k) => window.__ev.push([k, performance.now()]);
      // audio rejalashtirilgan payt (perf.now): chaqirilgan payt + (when - AudioContext.currentTime)
      const orig = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when, ...r) {
        window.__ev.push(["audio", performance.now() + ((when ?? 0) - this.context.currentTime) * 1000]);
        return orig.call(this, when, ...r);
      };
      const st = { off: null, arrive: null, greet: null, answer: null };
      const tick = () => {
        const rig = document.querySelector(".avatar-rig"), a = document.querySelector(".rig-arrive"), g = document.querySelector(".rig-greeting"), ans = document.querySelector(".rig-answer");
        if (ans) { const v = ans.classList.contains("on"); if (v !== st.answer) { st.answer = v; log(v ? "answer-on" : "answer-off"); } }
        const stg = document.querySelector(".avatar-stage");
        if (stg) { const v = stg.classList.contains("far"); if (v !== st.off) { st.off = v; log(v ? "far-on" : "far-off"); } }
        if (a) { const v = a.classList.contains("on"); if (v !== st.arrive) { st.arrive = v; log(v ? "arrive-on" : "arrive-off"); } }
        if (g) { const v = g.classList.contains("on"); if (v !== st.greet) { st.greet = v; log(v ? "greeting-on" : "greeting-off"); } }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto(BASE + query, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!document.querySelector(".rig-greeting") && document.querySelector(".rig-greeting").readyState >= 3, { timeout: 60000 });
    if (!blockArrive && !/arrive=0/.test(query)) await page.waitForFunction(() => document.querySelector(".rig-arrive")?.readyState >= 3, { timeout: 60000 });
    await sleep(800);

    R.standby = await page.evaluate(() => {
      const stg = document.querySelector(".avatar-stage"), cs = getComputedStyle(stg);
      const m = /matrix\(([^)]+)\)/.exec(cs.transform);
      return { far: stg.classList.contains("far"), scale: m ? parseFloat(m[1].split(",")[0]) : 1, filter: cs.filter, rigOpacity: getComputedStyle(document.querySelector(".avatar-rig")).opacity,
        hasArrive: !!document.querySelector(".rig-arrive"), dur: document.querySelector(".rig-arrive")?.duration ?? 0 };
    });

    R.tClick = await page.evaluate(() => { const t = performance.now(); document.querySelector(".talk").click(); return t; });
    await sleep(clip ? 500 : 1200);
    // salom audiosi (yoki tayyor javob klipi xabari) 1.2 s da keladi — yurib kelish klipi hali o'ynayapti
    if (clip) await page.evaluate(() => window.__ws.onmessage({ data: JSON.stringify({ type: "clip", id: "airport" }) }));
    else await page.evaluate(() => window.__speak(3));
    await sleep(Number(process.env.WAIT_S || 12) * 1000);
    R.beforeStop = await page.evaluate(() => ({ far: document.querySelector(".avatar-stage").classList.contains("far"), arriveOn: !!document.querySelector(".rig-arrive.on") }));
    R.tStop = await page.evaluate(() => { const t = performance.now(); document.querySelector(".talk.stop")?.click(); return t; });
    await sleep(1300);
    R.afterStop = await page.evaluate(() => {
      const stg = document.querySelector(".avatar-stage"), m = /matrix\(([^)]+)\)/.exec(getComputedStyle(stg).transform);
      return { far: stg.classList.contains("far"), scale: m ? parseFloat(m[1].split(",")[0]) : 1, filter: getComputedStyle(stg).filter };
    });
    R.ev = await page.evaluate(() => window.__ev);
    R.errors = errors;
  } finally {
    await browser.close();
  }
  return R;
}

const first = (ev, k, after = -Infinity) => ev.find(([n, t]) => n === k && t >= after)?.[1];
const rel = (t, t0) => (t === undefined ? "yo'q" : ((t - t0) / 1000).toFixed(2) + " s");

try {
  // ---------- A) yoqilgan ----------
  const A = await scenario("A) yaqinlashish YOQILGAN (standart)", "?manual=1");
  const evA = A.ev;
  const arriveOn = first(evA, "arrive-on", A.tClick), greetOn = first(evA, "greeting-on", A.tClick), farOff = first(evA, "far-off", A.tClick), audio1 = first(evA, "audio", A.tClick);
  ok("kutishda avatar KO'RINIB TURADI (yo'q bo'lib qolmaydi)", Number(A.standby.rigOpacity) === 1 && A.standby.far, `rig opacity=${A.standby.rigOpacity}`);
  ok("kutishda biroz uzoqroq (kichikroq) va xira", A.standby.scale > 0.7 && A.standby.scale < 0.9 && /brightness\(0\.4\)/.test(A.standby.filter), `masshtab ${A.standby.scale.toFixed(3)}, ${A.standby.filter}`);
  ok("yaqinlashish klipi yuklangan (davomiylik 1–2.5 s)", A.standby.hasArrive && A.standby.dur > 1 && A.standby.dur < 2.5, `${A.standby.dur.toFixed(2)} s`);
  ok("tugma bosilgach klip 0.8 s ichida ko'rinadi", arriveOn !== undefined && arriveOn - A.tClick < 800, "arrive-on " + rel(arriveOn, A.tClick));
  ok("klip boshlanishi bilan avatar oddiy ko'rinishga o'tadi (far yo'qoladi)", farOff !== undefined && arriveOn !== undefined && Math.abs(farOff - arriveOn) < 150, `far-off ${rel(farOff, A.tClick)}`);
  const dur = A.standby.dur * 1000;
  ok("salom videosi klip TUGAGACH boshlanadi (audio klip paytida kelsa ham)", greetOn !== undefined && arriveOn !== undefined && greetOn - arriveOn >= dur - 150 && greetOn - arriveOn <= dur + 450,
    `klip boshidan ${rel(greetOn, arriveOn)} (kutilgan ~${(dur / 1000).toFixed(2)} s)`);
  ok("salom OVOZI klip tugaguncha chalinmaydi", audio1 !== undefined && arriveOn !== undefined && audio1 - arriveOn >= dur, `audio klip boshidan ${rel(audio1, arriveOn)}`);
  ok(`salom ovozi salom videosidan ~${GREET_DELAY_S.toFixed(2)} s keyin (sinxron)`, greetOn !== undefined && audio1 !== undefined && Math.abs(audio1 - greetOn - GREET_DELAY_S * 1000) <= 180,
    `video→ovoz ${((audio1 - greetOn) / 1000).toFixed(2)} s`);
  ok("salom paytida avatar oddiy ko'rinishda (yaqin va yorug')", A.beforeStop.far === false);
  ok("tugatilgach avatar yana kutish ko'rinishiga qaytadi (uzoqroq, xira; yo'q bo'lmaydi)", A.afterStop.far === true && A.afterStop.scale < 0.9 && /brightness\(0\.4/.test(A.afterStop.filter), `masshtab ${A.afterStop.scale.toFixed(3)}, ${A.afterStop.filter}`);
  ok("JS xato yo'q", A.errors.length === 0, A.errors.join(" | ").slice(0, 200));

  // ---------- B) o'chirilgan ----------
  const B = await scenario("B) ?arrive=0 (eski ko'rinish)", "?manual=1&arrive=0");
  const evB = B.ev;
  const greetB = first(evB, "greeting-on", B.tClick);
  ok("klip DOMda yo'q", B.standby.hasArrive === false);
  ok("avatar kutishda ham oddiy ko'rinishda (far yo'q, masshtab 1)", B.standby.far === false && Math.abs(B.standby.scale - 1) < 0.001 && first(evB, "far-on") === undefined, `masshtab ${B.standby.scale}`);
  ok("salom birinchi ovozdan keyin darhol (<2.3 s)", greetB !== undefined && greetB - B.tClick < 2300, "greeting-on " + rel(greetB, B.tClick));
  ok("tugatilgach ham oddiy ko'rinishda", B.afterStop.far === false);
  ok("JS xato yo'q", B.errors.length === 0, B.errors.join(" | ").slice(0, 200));

  // ---------- C) klip yuklanmaydi ----------
  const C = await scenario("C) klip yuklanmaydi (so'rov bloklangan)", "?manual=1", { blockArrive: true });
  const evC = C.ev;
  const farC = first(evC, "far-off", C.tClick), greetC = first(evC, "greeting-on", C.tClick);
  ok("klip ko'rinmaydi (arrive-on yo'q)", first(evC, "arrive-on") === undefined);
  ok("avatar 2 s ichida CSS bilan yaqinlashadi (eski tartibga qaytdi)", farC !== undefined && farC - C.tClick < 2000, "far-off " + rel(farC, C.tClick));
  ok("salom boshlanadi (suhbat qotib qolmaydi, <3.5 s)", greetC !== undefined && greetC - C.tClick < 3500, "greeting-on " + rel(greetC, C.tClick));
  ok("JS xato yo'q", C.errors.length === 0, C.errors.join(" | ").slice(0, 200));

  // ---------- D) tayyor javob klipi yaqinlashish paytida keladi ----------
  const D = await scenario("D) tayyor javob klipi (o'z ovozi bilan) yaqinlashish davomida keladi (0.5 s da)", "?manual=1", { clip: true });
  const evD = D.ev;
  const arriveD = first(evD, "arrive-on", D.tClick), answerD = first(evD, "answer-on", D.tClick);
  const durD = D.standby.dur * 1000;
  ok("yaqinlashish boshlandi", arriveD !== undefined && arriveD - D.tClick < 800, "arrive-on " + rel(arriveD, D.tClick));
  ok("javob klipi yaqinlashish TUGAGACH boshlanadi (klip davomida emas)", answerD !== undefined && arriveD !== undefined && answerD - arriveD >= durD - 150 && answerD - arriveD <= durD + 900,
    `klip boshidan ${rel(answerD, arriveD)} (kutilgan ~${(durD / 1000).toFixed(2)} s)`);
  ok("JS xato yo'q", D.errors.length === 0, D.errors.join(" | ").slice(0, 200));
} finally {
  await server?.close?.();
}
console.log(failed ? `\n${failed} ta tekshiruv O'TMADI` : "\nhamma tekshiruv o'tdi");
process.exit(failed ? 1 : 0);
