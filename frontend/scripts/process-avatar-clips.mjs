// Tashqi (AI) video xizmatidan olingan xom avatar kliplarini sayt uchun tayyorlaydi:
//   - fon sayt foniga (#05070d) almashtiriladi — video chetlari sezilmaydi (styles.css dagi --bg bilan bir xil bo'lishi SHART;
//     galogramma ekranida bu deyarli qora). AI videoda fon to'q kulrang (~10–25) va rangsiz; avatar (forma, yuz, qo'l) esa
//     yoki yorqinroq, yoki rangli. Shuning uchun faqat to'q VA rangsiz piksellar fonga almashadi, qolgani o'zgarmaydi
//     (butun kadrga qora nuqta qo'llash formani qoraytirib, ranglarini buzardi);
//   - loop kliplarning (idle, speaking) oxirgi kadri tashlanadi: u birinchi kadrning o'zi, loopda ikki marta ko'rinardi;
//   - chiqish papkasiga mp4 (H.264) + webm (VP9) + idle-poster.jpg yoziladi (odatda frontend/public/avatar/).
//
//   node scripts/process-avatar-clips.mjs <xom-papka> [chiqish-papka]
//
// Xom papkada: idle_raw.mp4, speaking_raw.mp4, greeting_raw.mp4 (uchalasi ham start kadrdan boshlanib, shu kadrga qaytadi).
// ffmpeg: PATH'da yoki FFMPEG_PATH (libx264 va libvpx-vp9 bilan).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [RAW, OUT = "public/avatar"] = process.argv.slice(2);
if (!RAW) {
  console.error("Ishlatish: node scripts/process-avatar-clips.mjs <xom-papka> [chiqish-papka]");
  process.exit(1);
}
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const BG = [0x05, 0x07, 0x0d]; // styles.css :root --bg
// Fon belgisi m (0 = fon, 1 = avatar) = max(yorqinlik, rang): yorqinlik LUMA0 dan LUMA0+LUMA_W gacha, rang CHROMA0 dan
// CHROMA0+CHROMA_W gacha o'sadi. Natija = m·piksel + (1−m)·BG. O'lchangan: fon yorqinligi p99 ≈ 25, rang farqi ≤ 7, lekin
// avatar atrofida yorug'lik tushgan "tutun" ~30 gacha. LUMA0 24 → fonda dog' qoladi, 38+ → yubkaning soyalari (rangsiz,
// to'q) ham fonga o'tib dog'-dog' bo'lib qoladi; 30 shu ikkisining o'rtasi (4 ta variant bir xil kadrda ko'zdan kechirilgan).
const LUMA0 = 30, LUMA_W = 14, CHROMA0 = 7, CHROMA_W = 6;
// Pol (kadr pastki qismi): to'q to'qima gilam, yorqinligi 19–31 va ozgina ko'kish — chegaraga yaqin bo'lgani uchun fonda
// dog'-dog' qoldiradi. FLOOR_FROM (kadr balandligining ulushi) dan pastga qarab chegaralar tobora oshadi; oyoq (rangli)
// va tufli yaltirog'i (yorqin) baribir qoladi.
const FLOOR_FROM = 0.86, FLOOR_LUMA_BOOST = 26, FLOOR_CHROMA_BOOST = 6;
const LOOPS = new Set(["idle", "speaking"]);
const CLIPS = ["idle", "speaking", "greeting"];
const TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const TO_YUV = "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p";

const ffmpegInfo = (file) => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const info = r.stderr || "";
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  const size = /Video:.*?, (\d{2,5})x(\d{2,5})[ ,]/.exec(info);
  const fps = /, ([\d.]+) fps/.exec(info);
  if (!dur || !size || !fps) throw new Error(`videoni o'qib bo'lmadi: ${file}\n${info}`);
  const seconds = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  return { width: +size[1], height: +size[2], fps: +fps[1], frames: Math.round(seconds * +fps[1]) };
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** RGB kadrda (o'z joyida) fonni BG ga almashtiradi. */
const keyFrame = (buf, width, height) => {
  const stride = width * 3;
  for (let y = 0; y < height; y++) {
    const floor = clamp01((y / height - FLOOR_FROM) / (1 - FLOOR_FROM));
    const luma0 = LUMA0 + floor * FLOOR_LUMA_BOOST;
    const chroma0 = CHROMA0 + floor * FLOOR_CHROMA_BOOST;
    for (let i = y * stride, end = i + stride; i < end; i += 3) {
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const hi = Math.max(r, g, b);
      const lo = Math.min(r, g, b);
      const m = Math.max(clamp01(((r + g + b) / 3 - luma0) / LUMA_W), clamp01((hi - lo - chroma0) / CHROMA_W));
      if (m >= 1) continue;
      buf[i] = r * m + BG[0] * (1 - m) + 0.5;
      buf[i + 1] = g * m + BG[1] * (1 - m) + 0.5;
      buf[i + 2] = b * m + BG[2] * (1 - m) + 0.5;
    }
  }
};

/** src → (fon almashtirilgan) mp4 + webm. ffmpeg dekoder → JS → ffmpeg enkoder (rawvideo quvuri). */
const convert = (src, outBase, frames, { width, height, fps }) =>
  new Promise((resolve, reject) => {
    const dec = spawn(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-i", src, "-vf", "scale=in_range=tv:in_color_matrix=bt709:out_range=pc,format=rgb24", "-frames:v", String(frames), "-f", "rawvideo", "-"],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const out = (codec) => ["-vf", TO_YUV, ...TAGS, "-an", ...codec];
    const enc = spawn(
      FFMPEG,
      [
        "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-",
        ...out(["-c:v", "libx264", "-preset", "slow", "-crf", "20", "-g", "24", "-movflags", "+faststart", "-y", `${outBase}.mp4`]),
        ...out(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "33", "-row-mt", "1", "-cpu-used", "2", "-y", `${outBase}.webm`]),
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    const frame = Buffer.alloc(width * height * 3);
    let filled = 0;
    dec.stdout.on("data", (chunk) => {
      for (let off = 0; off < chunk.length; ) {
        const n = Math.min(chunk.length - off, frame.length - filled);
        chunk.copy(frame, filled, off, off + n);
        filled += n;
        off += n;
        if (filled === frame.length) {
          keyFrame(frame, width, height);
          if (!enc.stdin.write(Buffer.from(frame))) {
            dec.stdout.pause();
            enc.stdin.once("drain", () => dec.stdout.resume());
          }
          filled = 0;
        }
      }
    });
    dec.stdout.on("end", () => enc.stdin.end());
    dec.on("error", reject);
    enc.on("error", reject);
    enc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg enkoder xatosi (${code}): ${src}`))));
  });

fs.mkdirSync(OUT, { recursive: true });
for (const name of CLIPS) {
  const src = path.join(RAW, `${name}_raw.mp4`);
  if (!fs.existsSync(src)) {
    console.log(`o'tkazildi (yo'q): ${src}`);
    continue;
  }
  const info = ffmpegInfo(src);
  const frames = info.frames - (LOOPS.has(name) ? 1 : 0);
  await convert(src, path.join(OUT, name), frames, info);
  if (name === "idle") {
    const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", path.join(OUT, "idle.mp4"), "-frames:v", "1", "-q:v", "3", "-y", path.join(OUT, "idle-poster.jpg")]);
    if (r.status !== 0) throw new Error(`poster yozilmadi: ${r.stderr}`);
  }
  console.log(`${name}: ${frames} kadr, ${info.width}×${info.height} → ${OUT}`);
}
