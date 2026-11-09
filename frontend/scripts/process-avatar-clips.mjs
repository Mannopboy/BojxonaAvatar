// Yig'ilgan avatar kliplarini (build-avatar-clips.py natijasi: fon va kontur tayyor) sayt uchun kodlaydi:
//   - mp4 (H.264, asosiy) + webm (VP9, zaxira) + idle-poster.jpg;
//   - loop kliplarning (idle, speaking) oxirgi kadri tashlanadi: u birinchi kadrning o'zi, loopda ikki marta ko'rinardi;
//   - rang BT.709 teglari saqlanadi (brauzer shu matritsa bilan o'qiydi).
//
//   node scripts/process-avatar-clips.mjs <yig'ilgan-papka> [chiqish-papka]
//
// Papkada: idle_raw.mp4, speaking_raw.mp4, greeting_raw.mp4 (uchalasi ham start kadrdan boshlanib, shu kadrga qaytadi).
// ffmpeg: PATH'da yoki FFMPEG_PATH (libx264 va libvpx-vp9 bilan).
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
for (const name of CLIPS) {
  const src = path.join(RAW, `${name}_raw.mp4`);
  if (!fs.existsSync(src)) {
    console.log(`o'tkazildi (yo'q): ${src}`);
    continue;
  }
  const info = ffmpegInfo(src);
  const frames = info.frames - (LOOPS.has(name) ? 1 : 0);
  const out = (opts, file) => ["-vf", "format=yuv420p", ...TAGS, "-an", ...opts, "-y", path.join(OUT, file)];
  run([
    "-i", src, "-frames:v", String(frames),
    ...out(["-c:v", "libx264", "-preset", "slow", "-crf", "22", "-g", "24", "-movflags", "+faststart"], `${name}.mp4`),
    ...out(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1", "-cpu-used", "2"], `${name}.webm`),
  ]);
  if (name === "idle") run(["-i", path.join(OUT, "idle.mp4"), "-frames:v", "1", "-q:v", "3", "-y", path.join(OUT, "idle-poster.jpg")]);
  console.log(`${name}: ${frames} kadr, ${info.width}×${info.height} → ${OUT}`);
}
