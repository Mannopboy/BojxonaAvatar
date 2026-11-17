// Yurib kelish (arrive.mp4) brauzer testi — yig'ilgan `dist` + soxta WebSocket (backend va Gemini kerak emas), har sahnada alohida Chrome:
//   npm run build && node scripts/test-arrive.mjs          (TARGET=url — tayyor sayt; CHROME_PATH; HEADFUL=1)
//
//  A) yoqilgan (standart): kutishda avatar ko'rinmaydi (rig `.off`, qora); tugma bosilgach klip darhol `.on`; salom videosi klip TUGAGACH boshlanadi
//     (klip davomiyligiga mos); salom OVOZI salom videosidan GREETING_SPEECH_START_S - 0.05 s keyin (video bilan sinxron); tugatilganda rig yana `.off`.
//  B) ?arrive=0: klip DOMda yo'q, avatar kutishda ham ko'rinadi, salom eski tartibda (birinchi ovozdan keyin darhol).
//  C) klip yuklanmaydi (so'rov bloklanadi): ~1.5 s ichida eski tartibga qaytadi — avatar ko'rinadi, salom boshlanadi, suhbat qotib qolmaydi.
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
      page.on("request", (r) => (r.url().includes("/avatar/arrive.mp4") ? r.abort("failed") : r.continue()));
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
        if (rig) { const v = rig.classList.contains("off"); if (v !== st.off) { st.off = v; log(v ? "rig-off" : "rig-on"); } }
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
      const rig = document.querySelector(".avatar-rig");
      return { off: rig.classList.contains("off"), opacity: getComputedStyle(rig).opacity, hasArrive: !!document.querySelector(".rig-arrive"), dur: document.querySelector(".rig-arrive")?.duration ?? 0 };
    });

    R.tClick = await page.evaluate(() => { const t = performance.now(); document.querySelector(".talk").click(); return t; });
    await sleep(1200);
    // salom audiosi (yoki tayyor javob klipi xabari) 1.2 s da keladi — yurib kelish klipi hali o'ynayapti
    if (clip) await page.evaluate(() => window.__ws.onmessage({ data: JSON.stringify({ type: "clip", id: "airport" }) }));
    else await page.evaluate(() => window.__speak(3));
    await sleep(Number(process.env.WAIT_S || 12) * 1000);
    R.beforeStop = await page.evaluate(() => ({ off: document.querySelector(".avatar-rig").classList.contains("off"), arriveOn: !!document.querySelector(".rig-arrive.on") }));
    R.tStop = await page.evaluate(() => { const t = performance.now(); document.querySelector(".talk.stop")?.click(); return t; });
    await sleep(1300);
    R.afterStop = await page.evaluate(() => ({ off: document.querySelector(".avatar-rig").classList.contains("off"), opacity: getComputedStyle(document.querySelector(".avatar-rig")).opacity }));
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
  const A = await scenario("A) yurib kelish YOQILGAN (standart)", "?manual=1");
  const evA = A.ev;
  const arriveOn = first(evA, "arrive-on", A.tClick), greetOn = first(evA, "greeting-on", A.tClick), rigOn = first(evA, "rig-on", A.tClick), audio1 = first(evA, "audio", A.tClick);
  ok("kutishda avatar ko'rinmaydi (rig .off, opacity 0)", A.standby.off && A.standby.opacity === "0", `off=${A.standby.off} opacity=${A.standby.opacity}`);
  ok("klip yuklangan (davomiylik ~3.9 s)", A.standby.hasArrive && A.standby.dur > 3 && A.standby.dur < 4.5, `${A.standby.dur.toFixed(2)} s`);
  ok("tugma bosilgach klip 0.8 s ichida ko'rinadi", arriveOn !== undefined && arriveOn - A.tClick < 800, "arrive-on " + rel(arriveOn, A.tClick));
  ok("avatar (rig) klip bilan birga paydo bo'ladi", rigOn !== undefined && arriveOn !== undefined && Math.abs(rigOn - arriveOn) < 150, `rig-on ${rel(rigOn, A.tClick)}`);
  const dur = A.standby.dur * 1000;
  ok("salom videosi klip TUGAGACH boshlanadi (audio klip paytida kelsa ham)", greetOn !== undefined && arriveOn !== undefined && greetOn - arriveOn >= dur - 150 && greetOn - arriveOn <= dur + 450,
    `klip boshidan ${rel(greetOn, arriveOn)} (kutilgan ~${(dur / 1000).toFixed(2)} s)`);
  ok("salom OVOZI klip tugaguncha chalinmaydi", audio1 !== undefined && arriveOn !== undefined && audio1 - arriveOn >= dur, `audio klip boshidan ${rel(audio1, arriveOn)}`);
  ok(`salom ovozi salom videosidan ~${GREET_DELAY_S.toFixed(2)} s keyin (sinxron)`, greetOn !== undefined && audio1 !== undefined && Math.abs(audio1 - greetOn - GREET_DELAY_S * 1000) <= 180,
    `video→ovoz ${((audio1 - greetOn) / 1000).toFixed(2)} s`);
  ok("salom paytida avatar ko'rinib turadi", A.beforeStop.off === false);
  ok("tugatilgach avatar yana yo'qoladi (rig .off, qora ekran)", A.afterStop.off === true && Number(A.afterStop.opacity) < 0.05, `opacity=${A.afterStop.opacity}`);
  ok("JS xato yo'q", A.errors.length === 0, A.errors.join(" | ").slice(0, 200));

  // ---------- B) o'chirilgan ----------
  const B = await scenario("B) ?arrive=0 (eski ko'rinish)", "?manual=1&arrive=0");
  const evB = B.ev;
  const greetB = first(evB, "greeting-on", B.tClick);
  ok("klip DOMda yo'q", B.standby.hasArrive === false);
  ok("avatar kutishda ham ko'rinadi (rig .off yo'q)", B.standby.off === false && first(evB, "rig-off") === undefined);
  ok("salom birinchi ovozdan keyin darhol (<2.3 s)", greetB !== undefined && greetB - B.tClick < 2300, "greeting-on " + rel(greetB, B.tClick));
  ok("tugatilgach ham avatar ko'rinib turadi", B.afterStop.off === false);
  ok("JS xato yo'q", B.errors.length === 0, B.errors.join(" | ").slice(0, 200));

  // ---------- C) klip yuklanmaydi ----------
  const C = await scenario("C) klip yuklanmaydi (so'rov bloklangan)", "?manual=1", { blockArrive: true });
  const evC = C.ev;
  const rigC = first(evC, "rig-on", C.tClick), greetC = first(evC, "greeting-on", C.tClick);
  ok("klip ko'rinmaydi (arrive-on yo'q)", first(evC, "arrive-on") === undefined);
  ok("avatar 2 s ichida ko'rinadi (eski tartibga qaytdi)", rigC !== undefined && rigC - C.tClick < 2000, "rig-on " + rel(rigC, C.tClick));
  ok("salom boshlanadi (suhbat qotib qolmaydi, <3.5 s)", greetC !== undefined && greetC - C.tClick < 3500, "greeting-on " + rel(greetC, C.tClick));
  ok("JS xato yo'q", C.errors.length === 0, C.errors.join(" | ").slice(0, 200));

  // ---------- D) tayyor javob klipi yurib kelish paytida keladi ----------
  const D = await scenario("D) tayyor javob klipi (o'z ovozi bilan) yurib kelish davomida keladi", "?manual=1", { clip: true });
  const evD = D.ev;
  const arriveD = first(evD, "arrive-on", D.tClick), answerD = first(evD, "answer-on", D.tClick);
  const durD = D.standby.dur * 1000;
  ok("yurib kelish boshlandi", arriveD !== undefined && arriveD - D.tClick < 800, "arrive-on " + rel(arriveD, D.tClick));
  ok("javob klipi yurib kelish TUGAGACH boshlanadi (klip davomida emas)", answerD !== undefined && arriveD !== undefined && answerD - arriveD >= durD - 150 && answerD - arriveD <= durD + 900,
    `klip boshidan ${rel(answerD, arriveD)} (kutilgan ~${(durD / 1000).toFixed(2)} s)`);
  ok("JS xato yo'q", D.errors.length === 0, D.errors.join(" | ").slice(0, 200));
} finally {
  await server?.close?.();
}
console.log(failed ? `\n${failed} ta tekshiruv O'TMADI` : "\nhamma tekshiruv o'tdi");
process.exit(failed ? 1 : 0);
