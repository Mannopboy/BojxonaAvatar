// Yig'ilgan avatar qatlamlarini (build-avatar-clips.py natijasi) sayt uchun kodlaydi:
//   - base.jpg (tana, boshsiz) va head.webp (bosh, alfa kanalli) — rasmlar;
//   - idle, speaking: yuz qirqimi videolari; greeting: to'liq kadrli salom — har biri mp4 (H.264, asosiy) + webm (VP9, zaxira);
//   - loop kliplarning (idle, speaking) oxirgi kadri tashlanadi: u birinchi kadrning o'zi, loopda ikki marta ko'rinardi;
//   - rang BT.709 teglari saqlanadi (brauzer shu matritsa bilan o'qiydi); rig.json — qatlamlar joylashuvi (avatarRig.ts bilan bir xil).
//
//   node scripts/process-avatar-clips.mjs <yig'ilgan-papka> [chiqish-papka]
//
// Papkada: base.png, head.png, rig.json, idle_raw.mp4, speaking_raw.mp4, greeting_raw.mp4.
// ffmpeg: PATH'da yoki FFMPEG_PATH (libx264, libvpx-vp9 va libwebp bilan).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [RAW, OUT = "public/avatar"] = process.argv.slice(2);
if (!RAW) {
  console.error("Ishlatish: node scripts/process-avatar-clips.mjs <yig'ilgan-papka> [chiqish-papka]");
  process.exit(1);
}
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const LOOPS = new Set(["idle", "speaking"]);
const CLIPS = ["idle", "speaking", "greeting"];
const FACE_CLIPS = LOOPS; // yuz qirqimlari kichik: yuqori sifat deyarli bepul (to'liq kadrli salom ancha o'tkirroq siqiladi)
const TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

const ffmpegInfo = (file) => {
  const info = spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr || "";
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  const size = /Video:.*?, (\d{2,5})x(\d{2,5})[ ,]/.exec(info);
  const fps = /, ([\d.]+) fps/.exec(info);
  if (!dur || !size || !fps) throw new Error(`videoni o'qib bo'lmadi: ${file}\n${info}`);
  const seconds = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  return { width: +size[1], height: +size[2], frames: Math.round(seconds * +fps[1]) };
};

const run = (args) => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg xatosi: ${r.stderr || r.error}`);
};

fs.mkdirSync(OUT, { recursive: true });

// Rasmlar: tana (JPEG, alfa kerak emas) va bosh (WebP, alfa bilan). Bosh o'tkir qolishi kerak: yuqori sifat.
const base = path.join(RAW, "base.png");
const head = path.join(RAW, "head.png");
if (!fs.existsSync(base) || !fs.existsSync(head)) throw new Error(`${base} yoki ${head} yo'q: avval build-avatar-clips.py ni ishga tushiring`);
run(["-i", base, "-q:v", "2", "-pix_fmt", "yuvj444p", "-y", path.join(OUT, "base.jpg")]);
run(["-i", head, "-c:v", "libwebp", "-quality", "95", "-compression_level", "6", "-y", path.join(OUT, "head.webp")]);
fs.copyFileSync(path.join(RAW, "rig.json"), path.join(OUT, "rig.json"));
console.log(`rasmlar: base.jpg ${fs.statSync(path.join(OUT, "base.jpg")).size} bayt, head.webp ${fs.statSync(path.join(OUT, "head.webp")).size} bayt`);

for (const name of CLIPS) {
  const src = path.join(RAW, `${name}_raw.mp4`);
  if (!fs.existsSync(src)) {
    console.log(`o'tkazildi (yo'q): ${src}`);
    continue;
  }
  const info = ffmpegInfo(src);
  const frames = info.frames - (LOOPS.has(name) ? 1 : 0);
  const crf = FACE_CLIPS.has(name) ? { x264: "16", vp9: "26" } : { x264: "22", vp9: "34" };
  const out = (opts, file) => ["-vf", "format=yuv420p", ...TAGS, "-an", ...opts, "-y", path.join(OUT, file)];
  run([
    "-i", src, "-frames:v", String(frames),
    ...out(["-c:v", "libx264", "-preset", "slow", "-crf", crf.x264, "-g", "24", "-movflags", "+faststart"], `${name}.mp4`),
    ...out(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", crf.vp9, "-row-mt", "1", "-cpu-used", "2"], `${name}.webm`),
  ]);
  console.log(`${name}: ${frames} kadr, ${info.width}×${info.height} → ${OUT}`);
}
