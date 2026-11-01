// Avatarni videoga yozib olish — vaqt chizig'i. HAMMASI deterministik (seed): bir xil kadr har safar bir xil chiqadi.
//
// Uch klip:
//   greeting — salom (Salute); og'iz harakati Gemini Live salomining HAQIQIY ovoz balandligidan (greeting-envelope.json),
//              BIR MARTA ijro etiladi. Salom tugagach sayt speaking/idle'ga o'tadi (salom ovozi davom etsa ham).
//   speaking — uzluksiz gapirayotgan avatar, loop. Sayt uni FAQAT ovoz eshitilayotganda ko'rsatadi (jim paytda idle) —
//              shuning uchun videoning o'zida pauza/yopilish yo'q.
//   idle     — og'iz yopiq, ko'z pirpiraydi, loop.
//
// Loop klipning boshi va oxiri bir xil bo'lishi kerak: nafas fazasi (sin(t*1.4)) va og'iz holati (yumshatish) mos.
// Nafas: uzunliklar davrga (2π/1.4 ≈ 4.488 s) yaqin — idle 4.5 s (1 davr), speaking 9 s (2 davr).
// Og'iz: loop ikki marta chiziladi (birinchisi — qizdirish), ikkinchisi yoziladi — yumshatish holati davr oxiridagiga teng.
import envelope from "./greeting-envelope.json";

export const FPS = 30;

export type ClipName = "greeting" | "speaking" | "idle";
export const CLIP_NAMES: readonly ClipName[] = ["greeting", "speaking", "idle"];

// Salute klipi o'zi qo'lni ko'taradi va tushiradi (≈4 s); oxirida idle pozasiga silliq qaytish uchun vazn 0 ga tushadi.
export const SALUTE_FADE_IN = 0.2;
export const SALUTE_FADE_OUT = 0.3;
const GREETING_TAIL = 0.2; // klip tugagach tinch holat
/** Sayt salomni ovoz eshitilgandan keyin boshlaydi: o'lchash + kadr kechikishi */
const GREETING_LEAD = 0.03;

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
  /** haqiqiy ovoz balandligi (30 kadr/s, t=0 — ovoz boshlanishi); bo'lsa, syllables o'rniga shu ishlatiladi */
  envelope: number[] | null;
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

/** Uzluksiz nutqqa o'xshash og'iz harakati: so'zlar (2–5 hece), orasida qisqa tushish (jumla pauzasi yo'q). */
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
  }
  return out;
}

function make(name: ClipName, duration: number, loop: boolean, syllables: Syllable[], blinks: number[], env: number[] | null = null): ClipSpec {
  return { name, duration, frames: Math.round(duration * FPS), loop, syllables, envelope: env, blinks };
}

/** greeting uzunligi Salute klipiga bog'liq (saluteDuration — klip davomiyligi, s). */
export function buildSpec(name: ClipName, saluteDuration: number): ClipSpec {
  switch (name) {
    case "idle":
      return make("idle", 4.5, true, [], [1.2, 3.3]);
    case "speaking":
      return make("speaking", 9.0, true, buildSyllables(0, 9.0, 7), [2.1, 5.4, 7.7]);
    case "greeting": {
      const duration = Math.ceil((saluteDuration + GREETING_TAIL) * FPS) / FPS;
      const blinks = [1.0, 2.9].filter((b) => b < duration - 0.4);
      return make("greeting", duration, false, [], blinks, envelope.levels);
    }
  }
}

/** Og'iz ochilish darajasi 0..1 (jonli ilovada bu — ijro etilayotgan audio balandligi). */
export function mouthLevel(spec: ClipSpec, t: number): number {
  if (spec.envelope) {
    const k = (t - GREETING_LEAD) * FPS;
    if (k < 0) return 0;
    const i = Math.floor(k);
    const a = spec.envelope[i] ?? 0;
    const b = spec.envelope[i + 1] ?? a;
    return a + (b - a) * (k - i);
  }
  const tt = spec.loop ? t % spec.duration : t;
  let v = 0;
  for (const s of spec.syllables) {
    const u = (tt - s.t) / s.d;
    if (u > 0 && u < 1) v = Math.max(v, s.a * Math.pow(Math.sin(Math.PI * u), 0.7));
  }
  return v;
}

/** Ko'z yumilishi 0..1 (to'liq yumilib-ochilish ~0.18 s — avvalgi Avatar.tsx dagidek). */
export function blinkValue(spec: ClipSpec, t: number): number {
  const tt = spec.loop ? t % spec.duration : t;
  for (const start of spec.blinks) {
    const b = tt - start;
    if (b < 0 || b >= 0.18) continue;
    return b < 0.08 ? b / 0.08 : 1 - (b - 0.08) / 0.1;
  }
  return 0;
}

/** Salute: klip vaqti va vazni. fadeIn → klip (o'zi ko'tarib-tushiradi) → oxirida vazn 0 (idle pozasi). */
export function saluteState(t: number, saluteDuration: number): { time: number; weight: number } {
  const time = Math.min(Math.max(t, 0), saluteDuration);
  const fadeIn = Math.min(1, Math.max(0, t / SALUTE_FADE_IN));
  const fadeOut = Math.min(1, Math.max(0, (saluteDuration - t) / SALUTE_FADE_OUT));
  return { time, weight: Math.min(fadeIn, fadeOut) };
}
