// Avatar kliplari. Videolar — AI yaratgan XOM videolar: piksellarga hech qanday ishlov berilmagan, faqat qirqilgan (ffmpeg, README).
// Qo'shimcha harakat, qatlam yoki yumshatish yo'q. Klipdan klipga o'tish nuqtalari `avatarClips.json` da (kadrlar o'lchangan).
import clips from "./avatarClips.json";

/**
 * Avatar fayllari manzili. nginx /avatar/ ni keshlaydi: fayl nomi o'zgarmay mazmuni o'zgarsa, kesh eski faylni yangi kod bilan
 * aralashtirib yuborardi. Avatar fayllari qayta tayyorlanganda ASSET_V ni oshiring.
 */
export const ASSET_V = "7";
export const assetUrl = (file: string) => `/avatar/${file}?v=${ASSET_V}`;

/** Video kadri (xom klip o'lchami 720x1280, 9:16). */
export const FRAME_W = 720;
export const FRAME_H = 1280;

type Interval = readonly [number, number];

/**
 * Gapirish klipidan kutish klipiga SEZILMAY o'tish mumkin bo'lgan oraliqlar (soniya, klip boshidan): shu oraliqlarda
 * boshning o'rni kutish holatidagi bosh o'rniga ≤ 3 px (xom piksel) yaqin, shuning uchun xira-o'tishda "ikki bosh" ko'rinmaydi.
 */
export const SPEAKING_EXITS: readonly Interval[] = clips.speaking.exits.map(([a, b]) => [a, b] as const);

/**
 * Klip `t` soniyada turganda, o'tish oralig'iga yetguncha necha soniya kutish kerak (0 — hozir o'tsa bo'ladi).
 * Klip takrorlanadi, shuning uchun oxiridan keyin keyingi oraliq boshidan hisoblanadi. duration noma'lum bo'lsa — kutmaydi.
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
