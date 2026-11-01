// Avatarni videoga yozib olish — vaqt chizig'i. HAMMASI deterministik (seed): bir xil kadr har safar bir xil chiqadi.
//
// Uch klip:
//   greeting — salom (Salute) + gapirayotgan og'iz, BIR MARTA ijro etiladi
//   speaking — gapirayotgan avatar, uzluksiz takrorlanadi (loop)
//   idle     — tinglayotgan avatar (og'iz yopiq, ko'z pirpiraydi), uzluksiz takrorlanadi (loop)
//
// Takrorlanadigan klipning boshi va oxiri bir xil bo'lishi kerak: og'iz yopiq, nafas fazasi (sin(t*1.4)) mos.
// Shuning uchun uzunliklar nafas davriga (2π/1.4 ≈ 4.488 s) juda yaqin: idle 4.5 s (1 davr), speaking 9 s (2 davr).

export const FPS = 30;

export type ClipName = "greeting" | "speaking" | "idle";
export const CLIP_NAMES: readonly ClipName[] = ["greeting", "speaking", "idle"];

// Salute: avvalgi Avatar.tsx dagi qiymatlar — fadeIn → klip → ushlab turish → fadeOut
export const SALUTE_FADE_IN = 0.2;
export const SALUTE_HOLD = 1.5;
export const SALUTE_FADE_OUT = 0.5;
const GREETING_TAIL = 0.3; // salomdan keyin tinch holat — idle/speaking'ga silliq o'tish uchun

export interface Syllable {
  t: number; // boshlanishi (s)
  d: number; // davomiyligi (s)
  a: number; // balandligi 0..1 (jonli ilovadagi audio level shkalasi)
}

export interface ClipSpec {
  name: ClipName;
  duration: number; // soniya
  frames: number;
  loop: boolean;
  syllables: Syllable[];
  blinks: number[]; // pirpirash boshlanish vaqtlari (s)
}

// mulberry32 — kichik seedli PRNG
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nutqqa o'xshash og'iz harakati: so'zlar (2–5 hece), orasida qisqa tushish, ba'zan ibora pauzasi. */
export function buildSyllables(from: number, to: number, seed: number): Syllable[] {
  const rand = rng(seed);
  const out: Syllable[] = [];
  let t = from;
  while (t < to - 0.2) {
    const count = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < count && t < to - 0.15; i++) {
      const d = 0.13 + rand() * 0.1;
      out.push({ t, d, a: 0.35 + rand() * 0.45 }); // jonli nutqda audio level ≈ 0.3–0.8
      t += d * 0.9; // heceler biroz qoplanadi — og'iz so'z ichida to'liq yopilmaydi
    }
    t += 0.04 + rand() * 0.08; // so'zlar orasida qisqa tushish
    if (rand() < 0.18) t += 0.25 + rand() * 0.2; // ibora oxiridagi pauza
  }
  return out;
}

function make(name: ClipName, duration: number, loop: boolean, syllables: Syllable[], blinks: number[]): ClipSpec {
  return { name, duration, frames: Math.round(duration * FPS), loop, syllables, blinks };
}

/** greeting uzunligi Salute klipiga bog'liq (saluteDuration — klip davomiyligi, s). */
export function buildSpec(name: ClipName, saluteDuration: number): ClipSpec {
  switch (name) {
    case "idle":
      return make("idle", 4.5, true, [], [1.2, 3.3]);
    case "speaking":
      return make("speaking", 9.0, true, buildSyllables(0.3, 8.4, 7), [2.1, 5.4, 7.7]);
    case "greeting": {
      const raw = saluteDuration + SALUTE_HOLD + SALUTE_FADE_OUT + GREETING_TAIL;
      const duration = Math.ceil(raw * FPS) / FPS;
      const blinks = [1.0, 2.9, 4.6].filter((b) => b < duration - 0.4);
      return make("greeting", duration, false, buildSyllables(0.5, duration - 0.8, 11), blinks);
    }
  }
}

/** Og'iz ochilish darajasi 0..1 (jonli ilovada bu — ijro etilayotgan audio balandligi). */
export function mouthLevel(spec: ClipSpec, t: number): number {
  let v = 0;
  for (const s of spec.syllables) {
    const u = (t - s.t) / s.d;
    if (u > 0 && u < 1) v = Math.max(v, s.a * Math.pow(Math.sin(Math.PI * u), 0.7));
  }
  return v;
}

/** Ko'z yumilishi 0..1 (to'liq yumilib-ochilish ~0.18 s — avvalgi Avatar.tsx dagidek). */
export function blinkValue(spec: ClipSpec, t: number): number {
  for (const start of spec.blinks) {
    const b = t - start;
    if (b < 0 || b >= 0.18) continue;
    return b < 0.08 ? b / 0.08 : 1 - (b - 0.08) / 0.1;
  }
  return 0;
}

/** Salute: klip vaqti va vazni. fadeIn → klip → HOLD (oxirgi kadrda) → fadeOut. */
export function saluteState(t: number, saluteDuration: number): { time: number; weight: number } {
  const time = Math.min(Math.max(t, 0), saluteDuration);
  let weight = Math.min(1, Math.max(0, t / SALUTE_FADE_IN));
  const fadeOutAt = saluteDuration + SALUTE_HOLD;
  if (t > fadeOutAt) weight = Math.max(0, 1 - (t - fadeOutAt) / SALUTE_FADE_OUT);
  return { time, weight };
}
