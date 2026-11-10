// Avatar kliplari. Videolar — AI yaratgan XOM videolar: piksellarga hech qanday ishlov berilmagan, faqat qirqilgan (ffmpeg, README).
// Gapirish — bir nechta XIL variant: og'iz harakati har safar bir xil takrorlanmasin deb pleyer ularni tasodifiy tanlaydi. Har variantning
// boshi va oxiri bir xil uy kadri (og'iz yopiq, bosh o'z joyida) — shuning uchun variantlar ketma-ket ulanganda uzilish bilinmaydi.
import clips from "./avatarClips.json";

/**
 * Avatar fayllari manzili. nginx /avatar/ ni keshlaydi: fayl nomi o'zgarmay mazmuni o'zgarsa, kesh eski faylni yangi kod bilan
 * aralashtirib yuborardi. Avatar fayllari qayta tayyorlanganda ASSET_V ni oshiring.
 */
export const ASSET_V = "24";
export const assetUrl = (file: string) => `/avatar/${file}?v=${ASSET_V}`;

/** Video kadri (xom klip o'lchami 720x1280, 9:16). */
export const FRAME_W = 720;
export const FRAME_H = 1280;

type Interval = readonly [number, number];

export interface SpeakingVariant {
  file: string;
  /** soniya */
  duration: number;
  /**
   * Gapirishdan kutishga SEZILMAY o'tish mumkin bo'lgan oraliqlar (soniya, variant boshidan): og'iz yopiq VA bosh kutish holatidagi
   * o'rnida. Oxirgi oraliq variant oxirigacha boradi (variant uy kadrida tugaydi).
   */
  exits: readonly Interval[];
  /**
   * Lablar ANIQ yopiq kadrlar vaqti (har chiqish oynasida og'iz farqi eng kichik kadr, soniya). Ovoz tugaganda klip shu kadrda to'xtatiladi/chiqiladi: oyna chetida lablar hali
   * to'liq yopilmagan (tishlar ko'rinadi) bo'lishi mumkin.
   */
  holds: readonly number[];
}

export const SPEAKING_VARIANTS: readonly SpeakingVariant[] = clips.speaking.variants.map((v) => ({
  file: v.file,
  duration: v.duration,
  exits: v.exits.map(([a, b]) => [a, b] as const),
  holds: (v as { holds?: number[] }).holds ?? [],
}));

/**
 * Salom videosida og'iz birinchi harakatlanadigan payt (soniya, video boshidan). Salom ovozi shu paytga kechiktiriladi: video birinchi audio
 * kelishi bilan boshlanadi, qo'l boshga yetib borguncha ovoz chalinmaydi (liveAudio greetDelayS).
 */
export const GREETING_SPEECH_START_S: number = clips.greeting?.speechStart ?? 0;

type GraphEntry = readonly [number, number, number]; // [A kadri, B kadri, narx]
const GRAPH: Record<string, readonly GraphEntry[]> = (clips as unknown as { graph?: { pairs?: Record<string, GraphEntry[]> } }).graph?.pairs ?? {};
const FPS: number = (clips as unknown as { fps?: number }).fps ?? 24;

export interface Transition {
  /** A varianti shu soniyada (A vaqti) */
  t: number;
  /** B variantini shu soniyadan (B vaqti) boshlash kerak */
  u: number;
  cost: number;
}

/**
 * Gap o'rtasida A varianti `t` soniyada o'ynayotganda B variantiga OG'IZ YOPILMASDAN o'tish nuqtasi: A ning (t+minAhead .. t+maxAhead) oralig'idagi kadri B ning
 * qaysidir kadriga yuzi (og'iz shakli, ko'z, bosh) bo'yicha o'xshash (build_assets.py `build_graph`). Eng arzoni; bo'lmasa null (variant oxirigacha o'ynaydi).
 */
export function pickTransition(a: number, b: number, t: number, minAhead: number, maxAhead: number): Transition | null {
  const list = GRAPH[`${a}-${b}`];
  if (!list) return null;
  let best: Transition | null = null;
  for (const [i, u, c] of list) {
    const ts = i / FPS;
    if (ts < t + minAhead || ts > t + maxAhead) continue;
    if (!best || c < best.cost - 1e-9) best = { t: ts, u: u / FPS, cost: c };
  }
  return best;
}

/**
 * `a` variantidan keyin zaxira bufer uchun variant tanlaydi: kadr-mos o'tish nuqtalari bor (>= 3) variantlardan tasodifiy — gap o'rtasida og'iz yopilmasdan
 * almashinish mumkin bo'lsin. Bunday variant bo'lmasa — oddiy tasodifiy (a dan farqli).
 */
export function pickLinked(a: number, count: number, rnd: () => number = Math.random): number {
  const linked: number[] = [];
  for (let b = 0; b < count; b++) if (b !== a && (GRAPH[`${a}-${b}`]?.length ?? 0) >= 3) linked.push(b);
  if (linked.length) return linked[Math.min(linked.length - 1, Math.floor(rnd() * linked.length))];
  return pickVariant(count, a, rnd);
}

/** A variantining `iA`-kadri (soniya) bilan B varianti orasidagi barcha kadr-mos o'tish nuqtalari (har A ushlab turish kadri uchun eng yaxshi B kadrlari). */
export function transitionsFor(a: number, b: number): readonly Transition[] {
  return (GRAPH[`${a}-${b}`] ?? []).map(([i, u, c]) => ({ t: i / FPS, u: u / FPS, cost: c }));
}

export interface ExitPlan {
  /** o'ynash tezligi (1 = asl) */
  rate: number;
  /** ushlab turish kadri (soniya, klip vaqti): lablar aniq yopiq */
  target: number;
}

export const PLAN_MIN_RATE = 0.7;
export const PLAN_MAX_RATE = 1.4;
/**
 * Ovoz tugashiga `remaining` soniya qolganini oldindan bilgan holda (TTS audiosi hammasi kelib bo'lgan), klipning lablar aniq yopiq kadrlaridan (`targets`) birini aynan ovoz
 * tugagan paytga to'g'rilaydi: o'ynash tezligi minRate..maxRate (0.7..1.4) ichida o'zgartiriladi (lab harakati biroz sekin/tez — jim holda qimirlab turishdan yaxshi).
 * tezlik = (kadrgacha klip vaqti) / remaining; 1 ga eng yaqini tanlanadi. Mos kadr bo'lmasa null.
 */
export function planExit(targets: readonly number[], t: number, remaining: number, duration: number, minRate = PLAN_MIN_RATE, maxRate = PLAN_MAX_RATE): ExitPlan | null {
  if (!(remaining > 0.05)) return null;
  let best: (ExitPlan & { err: number }) | null = null;
  for (const target of targets) {
    if (target > duration + 0.01) continue;
    const dt = target - t;
    if (dt < 0.05) continue;
    const rate = dt / remaining;
    if (rate < minRate || rate > maxRate) continue;
    const err = Math.abs(rate - 1);
    if (!best || err < best.err) best = { rate, target, err };
  }
  return best ? { rate: best.rate, target: best.target } : null;
}

/** Klip `t` soniyada ushlab turish kadriga (lablar aniq yopiq) yaqinmi? (±tol soniya) */
export const isHoldTime = (holds: readonly number[], t: number, tol = 0.04): boolean => holds.some((h) => Math.abs(h - t) <= tol);

/** Tasodifiy variant tanlaydi; `avoid` (oldingi variant) dan farqli (variant bittadan ko'p bo'lsa). avoid < 0 — cheklovsiz. */
export function pickVariant(count: number, avoid: number, rnd: () => number = Math.random): number {
  if (count <= 1) return 0;
  if (avoid < 0 || avoid >= count) return Math.min(count - 1, Math.floor(rnd() * count));
  const i = Math.min(count - 2, Math.floor(rnd() * (count - 1)));
  return i >= avoid ? i + 1 : i;
}

/**
 * Klip `t` soniyada turganda, o'tish oralig'iga yetguncha necha soniya kutish kerak (0 — hozir o'tsa bo'ladi).
 * Oxiridan keyin keyingi takror boshidan hisoblanadi. duration noma'lum bo'lsa — kutmaydi.
 */
export function nextExitDelay(exits: readonly Interval[], t: number, duration: number): number {
  if (exits.length === 0 || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(t)) return 0;
  const tt = ((t % duration) + duration) % duration;
  let best = Infinity;
  for (const [a, b] of exits) {
    if (tt >= a && tt < b) return 0;
    const wait = a > tt ? a - tt : duration - tt + a;
    if (wait < best) best = wait;
  }
  return best;
}

/** Klip `t` soniyada o'tish oralig'ida turibdimi (og'iz yopiq va bosh kutish o'rnida)? */
export const isExitTime = (exits: readonly Interval[], t: number, duration: number): boolean => nextExitDelay(exits, t, duration) === 0;
