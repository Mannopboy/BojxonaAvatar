// Avatar kliplari. Videolar — AI yaratgan XOM videolar: piksellarga hech qanday ishlov berilmagan, faqat qirqilgan (ffmpeg, README).
// Gapirish — bir nechta XIL variant: og'iz harakati har safar bir xil takrorlanmasin deb pleyer ularni tasodifiy tanlaydi. Har variantning
// boshi va oxiri bir xil uy kadri (og'iz yopiq, bosh o'z joyida) — shuning uchun variantlar ketma-ket ulanganda uzilish bilinmaydi.
import clips from "./avatarClips.json";

/**
 * Avatar fayllari manzili. nginx /avatar/ ni keshlaydi: fayl nomi o'zgarmay mazmuni o'zgarsa, kesh eski faylni yangi kod bilan
 * aralashtirib yuborardi. Avatar fayllari qayta tayyorlanganda ASSET_V ni oshiring.
 */
export const ASSET_V = "13";
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
}

export const SPEAKING_VARIANTS: readonly SpeakingVariant[] = clips.speaking.variants.map((v) => ({
  file: v.file,
  duration: v.duration,
  exits: v.exits.map(([a, b]) => [a, b] as const),
}));

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
