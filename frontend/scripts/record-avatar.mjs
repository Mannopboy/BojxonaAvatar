// Avatarni videoga yozib olish: 3D avatar → public/avatar/{greeting,speaking,idle}.{mp4,webm}
//
//   npm run record:avatar                              # hamma klip, mp4 + webm
//   npm run record:avatar -- --clips=speaking          # faqat bittasi
//   npm run record:avatar -- --formats=mp4
//   npm run record:avatar -- --clips=idle --poster-only   # faqat idle-poster.jpg
//   npm run record:avatar -- --preview=../.tmp/prev    # video o'rniga PNG kadrlar (ko'zdan kechirish)
//   npm run record:avatar -- --width=1080 --height=1440   # boshqa o'lcham (standart 1440x1440)
//
// Qanday ishlaydi: Vite dev serveri recorder/ sahifasini beradi, o'rnatilgan Chrome uni ochadi (headless),
// sahna `advance(t)` bilan kadrma-kadr (deterministik) chiziladi va brauzerning o'zida WebCodecs bilan kodlanadi.
// ffmpeg kerak emas. Chrome yo'li topilmasa: CHROME_PATH=... muhit o'zgaruvchisi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v = "true"] = a.slice(2).split("=");
      return [k, v];
    }),
);
const clips = (args.clips || "greeting,speaking,idle").split(",");
const formats = (args.formats || "mp4,webm").split(",");
const bitrate = Number(args.bitrate) || 4_000_000;
const outDir = path.resolve(root, args.out || "public/avatar");
const width = Number(args.width) || 1440;
const height = Number(args.height) || 1440;
const previewDir = args.preview ? path.resolve(root, args.preview) : null;
const previewTimes = (args["preview-times"] || "0,1,2,3,4,5").split(",").map(Number);

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Chrome topilmadi. CHROME_PATH=... bilan yo'lini bering.");
  return found;
}

const port = 5199;
const server = await createServer({
  root,
  logLevel: "warn",
  server: { port, strictPort: true, host: "127.0.0.1" },
  // recorder/ sahifasi bog'liqliklarini boshidanoq skanerlash — aks holda birinchi ochishda qayta yuklanadi
  optimizeDeps: { entries: ["recorder/index.html"] },
});
await server.listen();

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    defaultViewport: { width, height, deviceScaleFactor: 1 },
    args: [
      "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", // GPU bo'lmasa dasturiy WebGL
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("[sahifa xatosi]", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.error("[konsol]", m.text());
  });

  await page.goto(`http://127.0.0.1:${port}/recorder/index.html?w=${width}&h=${height}`, { waitUntil: "domcontentloaded" });
  console.log("Model yuklanmoqda (49 MB)…");
  await page.waitForFunction("window.recorder && window.recorder.isReady()", { timeout: 240_000, polling: 500 });

  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "noma'lum";
  });
  const info = await page.evaluate(() => window.recorder.info());
  console.log(`Render: ${gpu}`);
  console.log(`Salute klipi: ${info.saluteDuration.toFixed(2)} s · o'lcham: ${width}x${height}`);

  if (args.debug) {
    // --debug=greeting:2,speaking:3  → shu vaqtdagi og'iz/morph qiymatlari
    for (const item of args.debug.split(",")) {
      const [n, t] = item.split(":");
      console.log(n, t, JSON.stringify(await page.evaluate((n, t) => window.recorder.debug(n, t), n, Number(t))));
    }
  } else if (previewDir) {
    fs.mkdirSync(previewDir, { recursive: true });
    for (const name of clips) {
      const frames = await page.evaluate((n, t) => window.recorder.preview(n, t), name, previewTimes);
      frames.forEach((b64, i) => {
        const file = path.join(previewDir, `${name}-${String(previewTimes[i]).replace(".", "_")}s.png`);
        fs.writeFileSync(file, Buffer.from(b64, "base64"));
      });
      console.log(`✓ ${name}: ${frames.length} kadr → ${previewDir}`);
    }
  } else {
    console.log("Codec:", JSON.stringify(await page.evaluate(() => window.recorder.codecs())));
    fs.mkdirSync(outDir, { recursive: true });
    if (!args["poster-only"]) {
      for (const name of clips) {
        const spec = info.clips[name];
        if (!spec) throw new Error(`Noma'lum klip: ${name}`);
        for (const format of formats) {
          const t0 = Date.now();
          process.stdout.write(`  ${name}.${format} (${spec.frames} kadr, ${spec.duration.toFixed(2)} s) … `);
          const b64 = await page.evaluate((n, f, b) => window.recorder.record(n, f, b), name, format, bitrate);
          const file = path.join(outDir, `${name}.${format}`);
          fs.writeFileSync(file, Buffer.from(b64, "base64"));
          console.log(`${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        }
      }
    }
    if (clips.includes("idle")) {
      // Poster: kutish videosining birinchi kadri — video yuklanguncha ko'rinadi (qora yaltirash bo'lmasin)
      const [b64] = await page.evaluate(() => window.recorder.preview("idle", [0]));
      const { default: sharp } = await import("sharp");
      const file = path.join(outDir, "idle-poster.jpg");
      await sharp(Buffer.from(b64, "base64")).jpeg({ quality: 82 }).toFile(file);
      console.log(`  idle-poster.jpg ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    }
    console.log(`Tayyor → ${outDir}`);
  }
} finally {
  await browser?.close();
  await server.close();
}
