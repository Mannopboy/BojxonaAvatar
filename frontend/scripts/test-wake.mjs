// "Salom bilan boshlash" (kutish rejimi) brauzer testi — haqiqiy backend + Chrome soxta mikrofon (WAV fayl):
//   TARGET=http://127.0.0.1:5173/ SCEN="nom|fayl.wav|kutilgan,..." node scripts/test-wake.mjs
// Kutilgan: uz_greeting (o'zbekcha salom → salom videosi + tayyor salom audio) · ru_greeting (ruscha salom → rus tilida javob, salom videosi YO'Q) ·
//           question (salomsiz/salomli savol → javob: tayyor klip yoki TTS) · ignored (shovqin → wake_ignored, kutishga qaytadi) · nothing (jimlik → hech narsa)
// Har sahnada alohida Chrome (soxta mikrofon fayli har safar boshidan). AUTOPLAY=0 — autoplay flagsiz (brauzer AudioContext ni to'xtatib qo'yishini tekshirish).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(FRONT, "package.json"));
const puppeteer = require("puppeteer-core");
const TARGET = process.env.TARGET || "http://127.0.0.1:5173/";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SCEN = (process.env.SCEN || "").split(",").filter(Boolean).map((x) => { const [name, wav, expect] = x.split("|"); return { name, wav, expect }; });
const WAIT_S = Number(process.env.WAIT_S || 30);

let failed = 0;
const ok = (name, cond, extra = "") => { if (!cond) failed++; console.log(`  ${cond ? "O'TDI  " : "O'TMADI"} ${name}${extra ? "  — " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scenario({ name, wav, expect }) {
  console.log(`\n=== ${name} (${expect}) — ${path.basename(wav)}`);
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`, "--mute-audio"];
  if (process.env.AUTOPLAY !== "0") args.push("--autoplay-policy=no-user-gesture-required");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1280, height: 800 }, args });
  try {
    const origin = new URL(TARGET).origin;
    await browser.defaultBrowserContext().overridePermissions(origin, ["microphone"]);
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    const t0 = Date.now();
    const rel = (t = Date.now()) => ((t - t0) / 1000).toFixed(1);
    const ws = { urls: [], text: [], bin: 0, closed: false };
    const live = new Set(); // faqat /ws/live (Vite HMR websocket'i hisobga olinmaydi)
    cdp.on("Network.webSocketCreated", (e) => { if (e.url.includes("/ws/live")) { live.add(e.requestId); ws.urls.push({ url: e.url, t: Date.now() }); } });
    cdp.on("Network.webSocketClosed", (e) => { if (live.has(e.requestId)) ws.closed = true; });
    cdp.on("Network.webSocketFrameReceived", (e) => {
      if (!live.has(e.requestId)) return;
      const r = e.response;
      if (r.opcode === 1) { try { ws.text.push({ t: Date.now(), m: JSON.parse(r.payloadData) }); } catch { /* */ } } else ws.bin += Math.floor((r.payloadData.length * 3) / 4);
    });
    await page.evaluateOnNewDocument(() => {
      window.__ev = [];
      const seen = { g: false, a: false };
      const tick = () => {
        const g = document.querySelector(".rig-greeting"), a = document.querySelector(".rig-answer");
        if (g && g.classList.contains("on") && !seen.g) { seen.g = true; window.__ev.push(["greeting-video", Date.now()]); }
        if (a && a.classList.contains("on") && !seen.a) { seen.a = true; window.__ev.push(["answer-video", Date.now()]); }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto(TARGET, { waitUntil: "load" });

    const done = () => {
      const types = ws.text.map((x) => x.m.type);
      if (expect === "nothing") return false;
      if (expect === "ignored") return types.includes("wake_ignored");
      if (expect === "uz_greeting") return types.filter((t) => t === "turn_complete").length >= 1;
      return types.includes("turn_complete") || types.includes("clip");
    };
    const started = Date.now();
    while ((Date.now() - started) / 1000 < (expect === "nothing" ? 18 : WAIT_S) && !done()) await sleep(500);
    await sleep(expect === "ignored" ? 2500 : 1500);

    const types = ws.text.map((x) => x.m.type);
    const ready = ws.text.find((x) => x.m.type === "ready");
    const transcript = ws.text.filter((x) => x.m.type === "transcript").map((x) => x.m.text).join(" ");
    const ev = await page.evaluate(() => window.__ev);
    const btn = await page.evaluate(() => ({ stop: !!document.querySelector(".talk.stop"), label: document.querySelector(".talk")?.textContent?.trim(), status: document.querySelector(".status")?.textContent || "", hint: document.querySelector(".hint")?.textContent || "" }));
    const sec = ws.bin / 48000;
    console.log(`  vaqt ${rel()} s | ws: ${ws.urls.map((u) => u.url.replace(/^wss?:\/\/[^/]+/, "") + "@" + rel(u.t) + "s").join(", ") || "yo'q"} | xabarlar: ${types.join(",")} | audio ${sec.toFixed(1)} s | video: ${ev.map((e) => e[0] + "@" + rel(e[1]) + "s").join(", ") || "-"}`);
    console.log(`  xabar vaqtlari: ${ws.text.map((x) => x.m.type + "@" + rel(x.t) + "s").join(" ")}`);
    if (transcript) console.log(`  matn: ${transcript.slice(0, 150)}`);
    console.log(`  tugma: "${btn.label}"${btn.stop ? " (suhbat ketyapti)" : ""} | holat: ${btn.status} | maslahat: ${btn.hint.slice(0, 60)}`);

    if (expect === "uz_greeting") {
      ok("kutish rejimi: ws ?wake=1 bilan ochildi", ws.urls.some((u) => u.url.includes("wake=1")));
      ok("ready.wake = true", ready?.m.wake === true);
      ok("backend 'greeting' belgisini yubordi", types.includes("greeting"));
      ok("tayyor salom matni va audio (~6 s)", /Assalomu alaykum/.test(transcript) && sec >= 4.5, `${sec.toFixed(1)} s`);
      ok("salom videosi ijro etildi", ev.some((e) => e[0] === "greeting-video"));
      ok("suhbat ketyapti (Tugatish tugmasi)", btn.stop);
    } else if (expect === "ru_greeting") {
      ok("ws ?wake=1", ws.urls.some((u) => u.url.includes("wake=1")));
      ok("'greeting' belgisi YO'Q (o'zbekcha tayyor salom emas)", !types.includes("greeting"));
      ok("javob matni rus tilida (kirill)", /[А-Яа-я]{4}/.test(transcript), transcript.slice(0, 60));
      ok("rus tilida ovozli javob keldi (TTS)", sec >= 2, `${sec.toFixed(1)} s`);
      ok("o'zbekcha salom videosi ijro etilmadi", !ev.some((e) => e[0] === "greeting-video"));
      ok("suhbat ketyapti", btn.stop);
    } else if (expect === "question") {
      ok("ws ?wake=1", ws.urls.some((u) => u.url.includes("wake=1")));
      ok("'greeting' belgisi yo'q (savolga to'g'ridan-to'g'ri javob)", !types.includes("greeting"));
      ok("javob keldi (tayyor klip yoki ovoz)", types.includes("clip") || sec >= 2, types.includes("clip") ? "tayyor klip" : `${sec.toFixed(1)} s audio`);
      ok("suhbat ketyapti", btn.stop);
    } else if (expect === "ignored") {
      ok("ws ochildi va backend wake_ignored dedi", types.includes("wake_ignored"));
      ok("javob audiosi yo'q", ws.bin === 0);
      ok("salom videosi yo'q", !ev.some((e) => e[0] === "greeting-video"));
      ok("kutish rejimiga qaytdi (Tugatish tugmasi yo'q)", !btn.stop, btn.label);
    } else if (expect === "nothing") {
      ok("jimlikda hech qanday ws ochilmadi", ws.urls.length === 0);
      ok("kutish rejimi yoqilgan (holat yozuvi)", /deng/.test(btn.status), btn.status);
    }
    ok("sahifa xatolari yo'q", errors.length === 0, errors.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
}

if (!SCEN.length) { console.log("SCEN bo'sh"); process.exit(2); }
for (const s of SCEN) await scenario(s);
console.log(`\nJAMI: ${failed ? failed + " ta tekshiruv O'TMADI" : "hammasi o'tdi"}`);
process.exitCode = failed ? 1 : 0;
