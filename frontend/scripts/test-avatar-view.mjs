// Avatar surish + zoom brauzer testi (haqiqiy Chrome, spec «Tekshiruv» ro'yxati):
//   TARGET=http://127.0.0.1:5173/ node scripts/test-avatar-view.mjs          (dev server ishlab turishi kerak)
// Tekshiradi: hech narsa bosmasdan klavishlar ishlaydi · 4 yo'nalish · ushlab turish (repeat) · chegara · zoom min/max · hamma video qatlam birga suriladi ·
// 400 ms debounce va saqlash · qayta ochganda BIRINCHI kadrdan joyida · buzuq qiymat → default · oyna o'lchami o'zgarsa nisbat · matn maydoni va Ctrl/boshqa klavishlar ushlanmaydi.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(FRONT, "package.json"));
const puppeteer = require("puppeteer-core");
const TARGET = process.env.TARGET || "http://127.0.0.1:5173/";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const KEY = "bojxona.avatarView.v1";
const PAN = 0.02, ZSTEP = 0.08, ZMIN = 0.4, ZMAX = 2.5;

let failed = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "O'TDI  " : "O'TMADI"} ${name}${extra ? "  — " + extra : ""}`);
};
const near = (a, b, tol = 1.0) => Math.abs(a - b) <= tol;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 800 },
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text()) && errors.push(m.text()));

  // birinchi chizilgan kadrdagi transform (qayta ochganda sakramasligini tekshirish uchun)
  await page.evaluateOnNewDocument(() => {
    window.__firstRigTransform = null;
    const tick = () => {
      const r = document.querySelector(".avatar-rig");
      if (r && window.__firstRigTransform === null) window.__firstRigTransform = r.style.transform || "(inline yo'q)";
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const geo = () =>
    page.evaluate(() => {
      const r = document.querySelector(".avatar-rig");
      const b = r.getBoundingClientRect();
      return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height, offH: r.offsetHeight, offW: r.offsetWidth, t: r.style.transform };
    });
  const stored = () => page.evaluate((k) => localStorage.getItem(k), KEY);
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(k); };
  // avval kutilayotgan (debounce) saqlash tugasin — aks holda qayta yuklashdagi pagehide uni kalit o'chirilgandan keyin qayta yozadi (ilovaning to'g'ri xatti-harakati)
  const reset = async () => { await new Promise((r) => setTimeout(r, 600)); await page.evaluate((k) => localStorage.removeItem(k), KEY); await page.reload({ waitUntil: "load" }); await page.waitForSelector(".avatar-rig"); await new Promise((r) => setTimeout(r, 400)); };

  await page.goto(TARGET, { waitUntil: "load" });
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".avatar-rig");
  await new Promise((r) => setTimeout(r, 600));

  // 0) boshlang'ich holat: hech narsa bosilmagan, asl joy (transform markazda, masshtab 1)
  const g0 = await geo();
  ok("boshlang'ich: markazda, masshtab 1", /scale\(1\)/.test(g0.t) && near(g0.w, g0.offW) && near(g0.h, g0.offH), g0.t);

  // 1) 4 yo'nalish — hech narsa bosmasdan (sahifa ochilishi bilan) ishlaydi; qadam = rig balandligining 2% i
  await press("ArrowRight", 5);
  let g = await geo();
  ok("→ 5 marta: o'ngga 5×2% balandlik", near(g.cx - g0.cx, 5 * PAN * g0.offH) && near(g.cy, g0.cy), `dx=${(g.cx - g0.cx).toFixed(1)} kutilgan=${(5 * PAN * g0.offH).toFixed(1)}`);
  await press("ArrowLeft", 10);
  g = await geo();
  ok("← 10 marta: chapga (net −5 qadam)", near(g.cx - g0.cx, -5 * PAN * g0.offH), `dx=${(g.cx - g0.cx).toFixed(1)}`);
  await press("ArrowRight", 5);
  await press("ArrowUp", 4);
  g = await geo();
  ok("↑ 4 marta: tepaga (y kamayadi)", near(g.cy - g0.cy, -4 * PAN * g0.offH) && near(g.cx, g0.cx), `dy=${(g.cy - g0.cy).toFixed(1)}`);
  await press("ArrowDown", 6);
  g = await geo();
  ok("↓ 6 marta: pastga (net +2 qadam)", near(g.cy - g0.cy, 2 * PAN * g0.offH), `dy=${(g.cy - g0.cy).toFixed(1)}`);

  // 2) ushlab turish: bir xil klavish qayta-qayta keydown (repeat) — ravon takrorlanadi
  await reset();
  const g1 = await geo();
  await page.keyboard.down("ArrowRight");
  for (let i = 0; i < 9; i++) await page.keyboard.down("ArrowRight"); // ikkinchi va undan keyingi down — repeat:true
  await page.keyboard.up("ArrowRight");
  g = await geo();
  ok("ushlab turish (10 keydown, repeat): 10 qadam", near(g.cx - g1.cx, 10 * PAN * g1.offH), `dx=${(g.cx - g1.cx).toFixed(1)}`);

  // 3) chegara: avatar ekrandan butunlay chiqib ketmaydi |x|,|y| <= 0.5 + zoom/2
  await press("ArrowRight", 120);
  await press("ArrowUp", 120);
  g = await geo();
  const lim = 0.5 + 1 / 2;
  ok("chegara: 120 bosishdan keyin x = +limit, y = −limit", near(g.cx - g1.cx, lim * g1.offH, 1.5) && near(g.cy - g1.cy, -lim * g1.offH, 1.5), `dx/H=${((g.cx - g1.cx) / g1.offH).toFixed(3)} dy/H=${((g.cy - g1.cy) / g1.offH).toFixed(3)}`);

  // 4) zoom: yaqin/uzoq (+, =, Numpad+ / −, _, Numpad−), min/max da to'xtaydi
  await reset();
  const z0 = await geo();
  await page.keyboard.down("Shift"); await page.keyboard.press("Equal"); await page.keyboard.up("Shift"); // '+'
  g = await geo();
  ok("'+' (Shift+=): zoom ×1.08", near(g.h / z0.h, 1 + ZSTEP, 0.003), `h×${(g.h / z0.h).toFixed(4)}`);
  await press("Equal");
  await press("NumpadAdd");
  g = await geo();
  ok("'=' va Numpad+ ham yaqinlashtiradi (3 qadam)", near(g.h / z0.h, Math.pow(1 + ZSTEP, 3), 0.01), `h×${(g.h / z0.h).toFixed(4)}`);
  await press("Minus"); await press("NumpadSubtract");
  await page.keyboard.down("Shift"); await page.keyboard.press("Minus"); await page.keyboard.up("Shift"); // '_'
  g = await geo();
  ok("'−', Numpad− va '_' uzoqlashtiradi", near(g.h / z0.h, Math.pow(1 + ZSTEP, 3) * Math.pow(1 - ZSTEP, 3), 0.01), `h×${(g.h / z0.h).toFixed(4)}`);
  await press("Equal", 60);
  g = await geo();
  ok(`zoom max ${ZMAX} da to'xtaydi`, near(g.h / z0.h, ZMAX, 0.01), `h×${(g.h / z0.h).toFixed(3)}`);
  await page.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, "zoom_max.png") : undefined, type: "png" }).catch(() => {});
  await press("Minus", 80);
  g = await geo();
  ok(`zoom min ${ZMIN} da to'xtaydi`, near(g.h / z0.h, ZMIN, 0.01), `h×${(g.h / z0.h).toFixed(3)}`);

  // 5) hamma video qatlam bitta rig ichida va aynan bir xil joyda (klip almashganda joy sakramaydi)
  await reset();
  await press("ArrowLeft", 7); await press("ArrowDown", 3); await press("Equal", 4);
  const same = await page.evaluate(() => {
    const rig = document.querySelector(".avatar-rig").getBoundingClientRect();
    const vids = [...document.querySelectorAll(".avatar-rig video")];
    return { n: vids.length, allIn: vids.length === document.querySelectorAll("video").length, maxDiff: Math.max(...vids.map((v) => { const b = v.getBoundingClientRect(); return Math.max(Math.abs(b.x - rig.x), Math.abs(b.y - rig.y), Math.abs(b.width - rig.width), Math.abs(b.height - rig.height)); })) };
  });
  ok(`hamma ${same.n} ta video qatlam rig ichida, rig bilan bir joyda`, same.allIn && same.maxDiff < 0.6, `eng katta farq ${same.maxDiff.toFixed(2)} px`);

  // 6) saqlash: 400 ms debounce, so'ng localStorage da {v:1,x,y,zoom}
  await reset();
  await press("ArrowRight", 3);
  const early = await stored();
  await new Promise((r) => setTimeout(r, 700));
  const late = await stored();
  ok("debounce: bosishdan darrov yozilmaydi, 400 ms dan keyin yoziladi", early === null && late !== null, `darrov=${early} keyin=${late}`);
  let saved = {};
  try { saved = JSON.parse(late); } catch { /* */ }
  ok("saqlangan format {v:1, x, y, zoom}", saved.v === 1 && near(saved.x, 3 * PAN, 1e-6) && saved.y === 0 && saved.zoom === 1, late);

  // 7) qayta ochish: joy birinchi kadrdan saqlangan holatda (sakramaydi)
  await press("Equal", 2); await press("ArrowUp", 2);
  await new Promise((r) => setTimeout(r, 700));
  const before = await geo();
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".avatar-rig");
  await new Promise((r) => setTimeout(r, 500));
  const after = await geo();
  const first = await page.evaluate(() => window.__firstRigTransform);
  ok("qayta ochilgach joy va zoom saqlangan", near(after.cx, before.cx) && near(after.cy, before.cy) && near(after.h, before.h), `oldin (${before.cx.toFixed(1)}, ${before.cy.toFixed(1)}, h ${before.h.toFixed(1)}) keyin (${after.cx.toFixed(1)}, ${after.cy.toFixed(1)}, h ${after.h.toFixed(1)})`);
  ok("birinchi chizilgan kadrdayoq saqlangan joyda (asl joydan sakramaydi)", first === after.t && !/scale\(1\)$/.test(first), first);

  // 8) oxirgi bosishdan so'ng 400 ms o'tmay sahifa yopilsa ham saqlanadi (pagehide)
  await reset();
  await press("ArrowLeft", 2);
  await page.reload({ waitUntil: "load" });
  const flushed = await stored();
  ok("tez qayta yuklanganda ham (pagehide) saqlanadi", flushed !== null && near(JSON.parse(flushed).x, -2 * PAN, 1e-6), flushed);

  // 9) buzuq saqlangan qiymat → default, xato yo'q
  for (const bad of ['"abc"', "{", '{"v":1,"x":"abc","y":0,"zoom":1}', '{"v":1,"x":0,"y":0,"zoom":99}', '{"v":1,"x":1e999,"y":0,"zoom":1}', '{"v":2,"x":0.1,"y":0,"zoom":1}']) {
    await page.evaluate((k, v) => localStorage.setItem(k, v), KEY, bad);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".avatar-rig");
    const gb = await geo();
    ok(`buzuq qiymat ${bad.slice(0, 34)} → default`, /scale\(1\)/.test(gb.t) && near(gb.cx, g0.cx) && near(gb.cy, g0.cy), gb.t);
  }

  // 10) oyna o'lchami o'zgarsa nisbat saqlanadi (X, Y — rig balandligi ulushida)
  await reset();
  await press("ArrowRight", 8); await press("ArrowDown", 5);
  const ratio = async () => { const gg = await geo(); const sc = await page.evaluate(() => { const c = document.querySelector(".avatar-video").getBoundingClientRect(); return { cx: c.x + c.width / 2, cy: c.y + c.height / 2 }; }); return { rx: (gg.cx - sc.cx) / gg.offH, ry: (gg.cy - sc.cy) / gg.offH }; };
  const r1 = await ratio();
  await page.setViewport({ width: 800, height: 1280 }); // vertikal ekran
  await new Promise((r) => setTimeout(r, 400));
  const r2 = await ratio();
  ok("vertikal ekranda ham surish nisbati (balandlik ulushi) bir xil", near(r1.rx, r2.rx, 0.004) && near(r1.ry, r2.ry, 0.004), `1280×800: (${r1.rx.toFixed(3)}, ${r1.ry.toFixed(3)}) 800×1280: (${r2.rx.toFixed(3)}, ${r2.ry.toFixed(3)})`);
  await page.setViewport({ width: 1280, height: 800 });

  // 11) ushlanmaydigan holatlar: matn maydoni, Ctrl/Alt bilan, boshqa klavishlar (burish W/S/A/D, R)
  await reset();
  const base = await geo();
  await page.evaluate(() => { const i = document.createElement("input"); i.id = "__t"; document.body.appendChild(i); i.focus(); });
  await press("ArrowLeft", 3); await press("Equal", 3);
  let gt = await geo();
  ok("matn maydonida fokus: klavishlar ushlanmaydi", near(gt.cx, base.cx) && near(gt.h, base.h));
  await page.evaluate(() => { document.getElementById("__t").remove(); document.body.focus(); });
  await page.keyboard.down("Control"); await press("Equal", 3); await press("ArrowLeft", 3); await page.keyboard.up("Control");
  await page.keyboard.down("Alt"); await press("ArrowLeft", 3); await page.keyboard.up("Alt");
  for (const k of ["KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "Space", "Enter", "Digit0"]) await press(k);
  gt = await geo();
  ok("Ctrl/Alt bilan va boshqa klavishlar (W/A/S/D/R/Space/Enter/0) hech narsani o'zgartirmaydi", near(gt.cx, base.cx) && near(gt.cy, base.cy) && near(gt.h, base.h), gt.t);

  // 12) ushlangan klavishda sahifa skroll bo'lmasin (preventDefault)
  const prevented = await page.evaluate(() => { const e = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true, bubbles: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  ok("strelka klavishida preventDefault (sahifa skroll bo'lmaydi)", prevented === true);

  ok("konsol/sahifa xatolari yo'q", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(`\nJAMI: ${failed ? failed + " ta tekshiruv O'TMADI" : "hammasi o'tdi"}`);
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
}
