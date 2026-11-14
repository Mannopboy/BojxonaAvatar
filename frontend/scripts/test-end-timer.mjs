// Klavishlar paneli va suhbatni tugatish taymeri brauzer testi (haqiqiy Chrome + haqiqiy backend, soxta mikrofon = jimlik WAV):
//   TARGET=http://127.0.0.1:5173/ SILENCE_WAV=<18 s jimlik.wav> node scripts/test-end-timer.mjs
// Tekshiradi: panel o'ng chetda doim ko'rinadi (matnlar, joriy qiymat jonli), sichqonchani to'smaydi, avatarni (keng ekranda) to'smaydi · `[`/`]` qadam 5 s, 10 → «o'chiq», saqlanadi ·
// jimlikda suhbat `endSec` dan keyin o'zi tugaydi va salom kutish rejimiga qaytadi · avatar gapirayotganda (salom) taymer tugatmaydi · «o'chiq» da tugatmaydi ·
// suhbat ketayotganda sozlama o'zgarsa darhol kuchga kiradi. Tugma bilan boshlangan suhbat (salom — tayyor audio, TTS kvotasi sarflanmaydi).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(FRONT, "package.json"));
const puppeteer = require("puppeteer-core");
const TARGET = process.env.TARGET || "http://127.0.0.1:5173/";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WAV = process.env.SILENCE_WAV;
if (!WAV) { console.log("SILENCE_WAV kerak (jim WAV fayl)"); process.exit(2); }
const KEY = "bojxona.avatarView.v1";

let failed = 0;
const ok = (name, cond, extra = "") => { if (!cond) failed++; console.log(`${cond ? "O'TDI  " : "O'TMADI"} ${name}${extra ? "  — " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 800 },
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}%noloop`, "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});
try {
  const origin = new URL(TARGET).origin;
  await browser.defaultBrowserContext().overridePermissions(origin, ["microphone"]);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(k); };
  const panelValue = () => page.evaluate(() => document.querySelector("[data-testid=end-value]")?.textContent);
  const stored = () => page.evaluate((k) => localStorage.getItem(k), KEY);
  const state = () => page.evaluate(() => ({ active: !!document.querySelector(".talk.stop"), label: document.querySelector(".talk")?.textContent?.trim(), status: document.querySelector(".status")?.textContent || "" }));
  const waitFor = async (fn, ms, step = 400) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return Date.now() - t; await sleep(step); } return -1; };

  await page.goto(TARGET, { waitUntil: "load" });
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".controls-panel");
  await sleep(600);

  // ---- PANEL ----
  console.log("\n=== klavishlar paneli");
  const geo = await page.evaluate(() => {
    const p = document.querySelector(".controls-panel").getBoundingClientRect(), r = document.querySelector(".avatar-rig").getBoundingClientRect(), sc = document.querySelector(".scene").getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector(".controls-panel"));
    const el = document.elementFromPoint(p.x + p.width / 2, p.y + p.height / 2);
    return { p: { x: p.x, y: p.y, w: p.width, h: p.height }, rigRight: r.right, scene: { right: sc.right, top: sc.top, h: sc.height }, pe: cs.pointerEvents, under: el && el.closest(".controls-panel") ? "panel" : el?.className || el?.tagName, text: document.querySelector(".controls-panel").textContent };
  });
  ok("panel o'ng chetda, sahna balandligining hammasida", Math.abs(geo.p.x + geo.p.w - geo.scene.right) < 1.5 && Math.abs(geo.p.h - geo.scene.h) < 2, `x=${geo.p.x.toFixed(0)} w=${geo.p.w.toFixed(0)} h=${geo.p.h.toFixed(0)} sahna h=${geo.scene.h.toFixed(0)}`);
  ok("panelda: BOSHQARUV, Surish, Zoom, Suhbat taymeri, avtomatik saqlanadi", ["BOSHQARUV", "Surish", "Zoom", "Suhbat taymeri", "avtomatik saqlanadi"].every((t) => geo.text.includes(t)), geo.text.replace(/\s+/g, " ").slice(0, 90));
  ok("panelda W/S/A/D, R, Ctrl+R qatorlari yo'q", !/\bW\b|\bR\b|Ctrl|burish/i.test(geo.text.replace(/BOSHQARUV/g, "")));
  ok("pointer-events: none (sichqoncha ishiga xalaqit bermaydi)", geo.pe === "none" && geo.under !== "panel", `${geo.pe}, ostida: ${geo.under}`);
  ok("keng ekranda avatarni to'smaydi", geo.rigRight <= geo.p.x + 0.5, `avatar o'ng chegarasi ${geo.rigRight.toFixed(0)}, panel ${geo.p.x.toFixed(0)}`);
  ok("boshlang'ich qiymat 30 s", (await panValue()) === "30 s", await panelValue());

  async function panValue() { return panelValue(); }

  // ---- SOZLASH: [ ] ----
  console.log("\n=== sozlash");
  await press("BracketRight");
  ok("] +5 s → 35 s (panel jonli yangilanadi)", (await panelValue()) === "35 s");
  await press("BracketLeft", 2);
  ok("[ ×2 → 25 s", (await panelValue()) === "25 s");
  await press("BracketLeft", 3);
  ok("[ ×3 → 10 s", (await panelValue()) === "10 s");
  await press("BracketLeft");
  ok("10 s da [ → o'chiq", (await panelValue()) === "o'chiq");
  await press("BracketRight");
  ok("o'chiq da ] → 10 s", (await panelValue()) === "10 s");
  await press("BracketRight", 100);
  ok("180 s dan oshmaydi", (await panelValue()) === "180 s");
  await press("BracketLeft", 200);
  ok("pastga: o'chiqda to'xtaydi", (await panelValue()) === "o'chiq");
  await sleep(700);
  const st = JSON.parse(await stored());
  ok("saqlandi: endSec = 0", st.v === 1 && st.endSec === 0, JSON.stringify(st));
  await press("BracketRight"); await press("ArrowRight", 2); await press("Equal");
  await sleep(700);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".controls-panel");
  ok("qayta ochilgach panelda saqlangan qiymat (10 s) ko'rinadi", (await panelValue()) === "10 s", await panelValue());

  // ---- TAYMER: jimlikda o'zi tugaydi (endSec = 10) ----
  console.log("\n=== suhbat taymeri (endSec = 10 s, jimlik)");
  await waitFor(async () => /deng/.test((await state()).status), 6000); // kutish rejimi (mikrofon) yoqilishini kutamiz
  const before = await state();
  ok("boshida kutish rejimi (suhbat yo'q)", !before.active && /deng/.test(before.status), before.status);
  const t0 = Date.now();
  await page.click(".talk");
  ok("suhbat boshlandi", (await waitFor(async () => (await state()).active, 8000)) >= 0);
  await sleep(10_000); // salom (~6-8 s) davom etyapti: avatar gapirayotganda taymer tugatmaydi
  const mid = await state();
  ok("avatar gapirayotganda/undan keyingi 10 s ichida suhbat tugamadi (≈10 s, salom 6 s)", mid.active, `${((Date.now() - t0) / 1000).toFixed(1)} s da faol: ${mid.active}`);
  const endMs = await waitFor(async () => !(await state()).active, 30_000);
  const total = (Date.now() - t0) / 1000;
  ok("jimlik 10 s dan keyin suhbat o'zi tugadi (salom + 10 s + 1.2 s kutish ≈ 17–21 s)", endMs >= 0 && total >= 15 && total <= 26, `${total.toFixed(1)} s`);
  const after = await state();
  ok("tugagach kutish rejimi (tugma «Suhbatni boshlash», holat «deng»)", !after.active && /Suhbatni boshlash/.test(after.label) && /deng/.test(after.status), `${after.label} | ${after.status}`);

  // ---- «o'chiq»: tugatmaydi; suhbat ketayotganda sozlama darhol kuchga kiradi ----
  console.log("\n=== o'chiq va jonli o'zgarish");
  await press("BracketLeft"); // 10 → o'chiq
  ok("taymer o'chiq", (await panelValue()) === "o'chiq");
  await page.click(".talk");
  ok("suhbat boshlandi", (await waitFor(async () => (await state()).active, 8000)) >= 0);
  await sleep(24_000);
  ok("o'chiq: 24 s jimlikdan keyin ham suhbat ochiq", (await state()).active);
  const t1 = Date.now();
  await press("BracketRight"); // o'chiq → 10 s: darhol kuchga kiradi (jimlik sanog'i shu paytdan)
  const endMs2 = await waitFor(async () => !(await state()).active, 25_000);
  const dt = (Date.now() - t1) / 1000;
  ok("suhbat ketayotganda ] bilan 10 s qo'yildi → ~10 s + 1.2 s dan keyin tugadi", endMs2 >= 0 && dt >= 9 && dt <= 16, `${dt.toFixed(1)} s`);
  ok("yana kutish rejimi", /deng/.test((await state()).status));

  ok("konsol/sahifa xatolari yo'q", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(`\nJAMI: ${failed ? failed + " ta tekshiruv O'TMADI" : "hammasi o'tdi"}`);
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
}
